/* ============================================================
   sync.js — Sync Code + JSON payload generation & verification
   Version: 1.3.0
   ------------------------------------------------------------
   v1.3.0:
   - Added fetchAllStudentsFromBackend(token) to pull every
     student record from the Google Sheet backend in one call.
   ============================================================ */

const Sync = (() => {
  'use strict';

  const NS = 'gba_v1_';

  /* ---------- Backend helpers ---------- */
  function backendEnabled() {
    return typeof CONFIG !== 'undefined' && CONFIG.backendEnabled;
  }

  async function backendPost(body) {
    const res = await fetch(CONFIG.BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    return res.json();
  }

  async function backendGet(params) {
    const url = new URL(CONFIG.BACKEND_URL);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString());
    return res.json();
  }

  /* ---------- Payload Builder ---------- */
  async function buildPayload(lrn, subject) {
    const user = Store.getUser(lrn);
    if (!user) throw new Error('User not found');

    const progress = Store.getProgress(lrn);
    const scores = Store.getScores(lrn);
    const badges = Store.getBadges(lrn);

    const payload = {
      version: '1.2.0',
      generatedAt: new Date().toISOString(),
      student: {
        lrn: user.lrn,
        lastName: user.lastName,
        firstName: user.firstName,
        middleName: user.middleName || '',
        gradeLevel: user.gradeLevel,
        section: user.section
      },
      subject: subject || 'both',
      progress: subject ? { [subject]: progress[subject] } : progress,
      scores: subject ? { [subject]: scores[subject] } : scores,
      badges: subject ? { [subject]: badges[subject] } : badges
    };

    const signature = await Security.sign(payload);
    return { payload, signature };
  }

  /* ---------- Sync Code ---------- */
  async function generateSyncCode(lrn, subject) {
    const { payload, signature } = await buildPayload(lrn, subject);
    const json = JSON.stringify(payload);
    const signatureShort = signature.slice(0, 8).toUpperCase();
    const hash = _shortHash(json).toUpperCase();
    const code = `GB12-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${signatureShort}`;

    let mode = 'local';

    if (backendEnabled()) {
      try {
        const res = await backendPost({
          action: 'registerSyncCode',
          code,
          lrn,
          payload,
          signature
        });
        if (res.ok) mode = 'backend';
        else console.warn('[Sync] Backend register failed:', res.error);
      } catch (err) {
        console.warn('[Sync] Backend unreachable, saving locally:', err);
      }
    }

    _saveLocalCode(code, { payload, signature });

    return {
      code,
      payload,
      signature,
      mode,
      createdAt: new Date().toISOString()
    };
  }

  /* ---------- Sync Code Lookup ---------- */
  async function lookupSyncCode(code) {
    if (backendEnabled()) {
      try {
        const res = await backendPost({
          action: 'resolveSyncCode',
          code
        });
        if (res.ok) {
          return {
            payload: res.payload,
            signature: res.signature,
            source: 'backend',
            createdAt: res.createdAt
          };
        }
      } catch (err) {
        console.warn('[Sync] Backend lookup failed, trying local:', err);
      }
    }

    const local = _getLocalCode(code);
    if (local) {
      return { ...local, source: 'local' };
    }

    return null;
  }

  /* ---------- Local code storage ---------- */
  function _saveLocalCode(code, data) {
    const codes = JSON.parse(localStorage.getItem(`${NS}sync_codes`) || '{}');
    codes[code] = { ...data, savedAt: new Date().toISOString() };
    const entries = Object.entries(codes).sort(
      (a, b) => new Date(b[1].savedAt) - new Date(a[1].savedAt)
    );
    const trimmed = Object.fromEntries(entries.slice(0, 10));
    localStorage.setItem(`${NS}sync_codes`, JSON.stringify(trimmed));
  }

  function _getLocalCode(code) {
    const codes = JSON.parse(localStorage.getItem(`${NS}sync_codes`) || '{}');
    return codes[code] || null;
  }

  /* ---------- JSON File Export ---------- */
  async function exportAsFile(lrn, subject) {
    const { payload, signature } = await buildPayload(lrn, subject);
    const envelope = { payload, signature };
    const json = JSON.stringify(envelope, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const filename = `${payload.student.lrn}_${subject || 'all'}_${_dateStamp()}.json`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    return filename;
  }

  /* ---------- JSON File Import ---------- */
  async function importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const envelope = JSON.parse(e.target.result);
          const { payload, signature } = envelope;
          if (!payload || !signature) {
            throw new Error('Missing payload or signature');
          }
          const valid = await Security.verify(payload, signature);
          resolve({ payload, signature, valid, source: 'file' });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('File read error'));
      reader.readAsText(file);
    });
  }

  /* ---------- Import Sync Code ---------- */
  async function importFromCode(code) {
    const record = await lookupSyncCode(code);
    if (!record) {
      return {
        valid: false,
        error: backendEnabled()
          ? 'Code not found (checked backend and this device)'
          : 'Code not found on this device. Enable the backend for cross-device sync.'
      };
    }
    const valid = await Security.verify(record.payload, record.signature);
    return {
      payload: record.payload,
      signature: record.signature,
      valid,
      source: record.source
    };
  }

  /* ============================================================
     NEW: Fetch All Students From Backend
     ------------------------------------------------------------
     Calls the Apps Script endpoint `getAllStudentsAggregated`
     which returns a compact array of { lrn, student, progress,
     scores, badges, summary, lastUpdated } — one entry per student.
     ============================================================ */
  async function fetchAllStudentsFromBackend(token) {
    if (!backendEnabled()) {
      return { ok: false, error: 'Backend not configured' };
    }
    if (!token) {
      return { ok: false, error: 'Teacher token required' };
    }

    try {
      const res = await backendPost({
        action: 'getAllStudentsAggregated',
        token
      });

      if (!res.ok) {
        return { ok: false, error: res.error || 'Backend returned error' };
      }

      return {
        ok: true,
        count: res.count || (res.students || []).length,
        students: res.students || []
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /* ---------- Health Check ---------- */
  async function pingBackend() {
    if (!backendEnabled()) return { ok: false, error: 'No backend URL configured' };
    try {
      const res = await backendGet({ action: 'ping' });
      return res;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /* ---------- Helpers ---------- */
  function _shortHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  function _dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  /* ---------- Public API ---------- */
  return {
    backendEnabled,
    buildPayload,
    generateSyncCode,
    lookupSyncCode,
    exportAsFile,
    importFromFile,
    importFromCode,
    fetchAllStudentsFromBackend,   // ← NEW
    pingBackend
  };
})();
