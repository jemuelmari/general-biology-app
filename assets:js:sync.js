/* ============================================================
   sync.js — Sync Code + JSON payload generation & verification
   Version: 1.0.0
   ============================================================ */

const Sync = (() => {
  'use strict';

  const NS = 'gba_v1_';

  /* ---------- Payload Builder ---------- */
  async function buildPayload(lrn, subject) {
    const user = Store.getUser(lrn);
    if (!user) throw new Error('User not found');

    const progress = Store.getProgress(lrn);
    const scores = Store.getScores(lrn);
    const badges = Store.getBadges(lrn);

    const payload = {
      version: '1.0.0',
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
    const compressed = _compress(json);
    const signatureShort = signature.slice(0, 8).toUpperCase();

    // Format: GB12-XXXX-XXXX-SIG
    const hash = _shortHash(json).toUpperCase();
    const code = `GB12-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${signatureShort}`;

    // Store locally (student can retrieve later)
    _saveLocalCode(code, { payload, signature });

    return {
      code,
      payload,
      signature,
      createdAt: new Date().toISOString()
    };
  }

  /* ---------- Sync Code Lookup ---------- */
  function lookupSyncCode(code) {
    const record = _getLocalCode(code);
    return record || null;
  }

  /* ---------- Local code storage (temp) ---------- */
  function _saveLocalCode(code, data) {
    const codes = JSON.parse(localStorage.getItem(`${NS}sync_codes`) || '{}');
    codes[code] = { ...data, savedAt: new Date().toISOString() };
    // Keep only last 10
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

  /* ---------- JSON File Import (Teacher) ---------- */
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
          resolve({ payload, signature, valid });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('File read error'));
      reader.readAsText(file);
    });
  }

  /* ---------- Import Sync Code (Teacher) ---------- */
  async function importFromCode(code) {
    const record = lookupSyncCode(code);
    if (!record) {
      return { valid: false, error: 'Code not found on this device' };
    }
    const valid = await Security.verify(record.payload, record.signature);
    return { payload: record.payload, signature: record.signature, valid };
  }

  /* ---------- Helpers ---------- */
  function _compress(str) {
    // Simple placeholder; can be swapped for LZ-string later
    return str;
  }

  function _shortHash(str) {
    // FNV-1a 32-bit
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
    buildPayload,
    generateSyncCode,
    lookupSyncCode,
    exportAsFile,
    importFromFile,
    importFromCode
  };
})();