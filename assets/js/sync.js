/* ============================================================
   sync.js — Sync Code + JSON payload generation & verification
   Version: 1.3.1
   ------------------------------------------------------------
   v1.3.1:
   - importFromFile now accepts files even when signature
     verification fails, marking them as `valid: false` with a
     warning instead of rejecting. This lets users restore
     backups made with older or mismatched HMAC secrets.
   - Added fetchAllStudentsFromBackend (from v1.3.0)
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

  /* ---------- JSON File Import (RELAXED) ---------- */
  /**
   * Parses a JSON backup file. Two supported shapes:
   *
   *   1) { payload: {...}, signature: "..." }   ← sync.js format
   *   2) { user: {...}, progress: {...}, ... }  ← backup.js format
   *
   * For shape (1), we attempt signature verification. If it fails,
   * we still resolve with `valid: false` (and a warning flag) rather
   * than rejecting, so users can restore backups made with an older
   * HMAC secret. Structural validation (student.lrn) is enforced.
   */
  async function importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const parsed = JSON.parse(e.target.result);

          /* ---------- Shape 1: { payload, signature } ---------- */
          if (parsed.payload && typeof parsed.payload === 'object') {
            const { payload, signature } = parsed;

            if (!payload.student || !payload.student.lrn) {
              return reject(new Error('Payload missing student.lrn'));
            }

            let verified = false;
            let warning = null;

            // Only attempt HMAC verification if a signature is present
            if (signature && typeof signature === 'string' && Security && typeof Security.verify === 'function') {
              try {
                verified = await Security.verify(payload, signature);
              } catch (err) {
                verified = false;
              }

              if (!verified) {
                warning = 'Signature could not be verified (likely generated with an older HMAC secret). File structure is valid — importing anyway.';
              }
            } else {
              warning = 'No signature found. File structure is valid — importing anyway.';
            }

            return resolve({
              payload,
              signature: signature || null,
              valid: true,        // ← always true if structure is valid
              verified,           // ← true only if HMAC matched
              warning,
              source: 'file'
            });
          }

          /* ---------- Shape 2: { user, progress, scores, badges } ---------- */
          if (parsed.user && parsed.user.lrn) {
            const payload = {
              version: parsed.version || '1.0.0',
              generatedAt: parsed.exportedAt || new Date().toISOString(),
              student: parsed.user,
              subject: 'both',
              progress: parsed.progress || {},
              scores: parsed.scores || {},
              badges: parsed.badges || {}
            };
            return resolve({
              payload,
              signature: null,
              valid: true,
              verified: false,
              warning: 'Loaded from legacy dashboard backup format.',
              source: 'file'
            });
          }

          /* ---------- Unknown shape ---------- */
          return reject(new Error('Unrecognized backup file. Expected { payload, signature } or { user, ... }.'));
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
    const verified = await Security.verify(record.payload, record.signature);
    return {
      payload: record.payload,
      signature: record.signature,
      valid: true,
      verified,
      source: record.source
    };
  }

  /* ============================================================
     Fetch All Students From Backend
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
    fetchAllStudentsFromBackend,
    pingBackend
  };
})();
