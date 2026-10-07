/* ============================================================
   sync.js — Sync Code + Unlock Request System
   Version: 2.0.0
   ------------------------------------------------------------
   NEW in v2.0.0:
   - Retake request/approve/redeem system.
   - Replaced old pushUnlock/pullUnlocks with code-based flow.
   - Removed lock push (no longer needed in new architecture).
   ============================================================ */

const Sync = (() => {
  'use strict';

  const NS = 'gba_v1_';
  const QUEUE_KEY = `${NS}push_queue`;
  const MAX_QUEUE_SIZE = 100;
  const MAX_RETRIES = 5;
  const AUTO_FLUSH_INTERVAL = 5 * 60 * 1000;

  function backendEnabled() {
    return typeof CONFIG !== 'undefined' && CONFIG.backendEnabled;
  }

  async function backendPost(body) {
    const res = await fetch(CONFIG.BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
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

  /* ============================================================
     Core sync code generation & import
     ============================================================ */

  async function buildPayload(lrn, subject) {
    const user = Store.getUser(lrn);
    if (!user) throw new Error('User not found');
    const progress = Store.getProgress(lrn);
    const scores = Store.getScores(lrn);
    const badges = Store.getBadges(lrn);
    const payload = {
      version: '1.3.0',
      generatedAt: new Date().toISOString(),
      student: {
        lrn: user.lrn, lastName: user.lastName, firstName: user.firstName,
        middleName: user.middleName || '',
        gradeLevel: user.gradeLevel, section: user.section
      },
      subject: subject || 'both',
      progress: subject ? { [subject]: progress[subject] } : progress,
      scores: subject ? { [subject]: scores[subject] } : scores,
      badges: subject ? { [subject]: badges[subject] } : badges
    };
    const signature = await Security.sign(payload);
    return { payload, signature };
  }

  async function generateSyncCode(lrn, subject) {
    const { payload, signature } = await buildPayload(lrn, subject);
    const json = JSON.stringify(payload);
    const hash = _shortHash(json).toUpperCase();
    const code = `GB12-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${signature.slice(0, 8).toUpperCase()}`;
    let mode = 'local';
    if (backendEnabled()) {
      try {
        const res = await backendPost({ action: 'registerSyncCode', code, lrn, payload, signature });
        if (res.ok) mode = 'backend';
      } catch (e) { /* silent */ }
    }
    _saveLocalCode(code, { payload, signature });
    return { code, payload, signature, mode, createdAt: new Date().toISOString() };
  }

  async function lookupSyncCode(code) {
    if (backendEnabled()) {
      try {
        const res = await backendPost({ action: 'resolveSyncCode', code });
        if (res.ok) return { payload: res.payload, signature: res.signature, source: 'backend' };
      } catch (e) { /* silent */ }
    }
    const local = _getLocalCode(code);
    if (local) return { ...local, source: 'local' };
    return null;
  }

  function _saveLocalCode(code, data) {
    const codes = JSON.parse(localStorage.getItem(`${NS}sync_codes`) || '{}');
    codes[code] = { ...data, savedAt: new Date().toISOString() };
    const sorted = Object.entries(codes).sort((a, b) => new Date(b[1].savedAt) - new Date(a[1].savedAt));
    localStorage.setItem(`${NS}sync_codes`, JSON.stringify(Object.fromEntries(sorted.slice(0, 10))));
  }

  function _getLocalCode(code) {
    const codes = JSON.parse(localStorage.getItem(`${NS}sync_codes`) || '{}');
    return codes[code] || null;
  }

  async function exportAsFile(lrn, subject) {
    const { payload, signature } = await buildPayload(lrn, subject);
    const json = JSON.stringify({ payload, signature }, null, 2);
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

  async function importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          if (parsed.payload && parsed.payload.student && parsed.payload.student.lrn) {
            let verified = false;
            if (parsed.signature && Security && typeof Security.verify === 'function') {
              try { verified = await Security.verify(parsed.payload, parsed.signature); }
              catch (err) { verified = false; }
            }
            return resolve({
              payload: parsed.payload, signature: parsed.signature || null,
              valid: true, verified, source: 'file'
            });
          }
          if (parsed.user && parsed.user.lrn) {
            return resolve({
              payload: {
                version: parsed.version || '1.0.0',
                generatedAt: parsed.exportedAt || new Date().toISOString(),
                student: parsed.user, subject: 'both',
                progress: parsed.progress || {},
                scores: parsed.scores || {},
                badges: parsed.badges || {}
              },
              signature: null, valid: true, verified: false, source: 'file'
            });
          }
          return reject(new Error('Unrecognized backup file.'));
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('File read error'));
      reader.readAsText(file);
    });
  }

  async function importFromCode(code) {
    const record = await lookupSyncCode(code);
    if (!record) return { valid: false, error: 'Code not found' };
    let verified = false;
    try { verified = await Security.verify(record.payload, record.signature); }
    catch (e) { verified = false; }
    return { payload: record.payload, signature: record.signature, valid: true, verified, source: record.source };
  }

  async function fetchAllStudentsFromBackend(token) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    if (!token) return { ok: false, error: 'Teacher token required' };
    try {
      const res = await backendPost({ action: 'getAllStudentsAggregated', token });
      if (!res.ok) return { ok: false, error: res.error || 'Backend error' };
      return { ok: true, count: res.count || 0, students: res.students || [] };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /* ============================================================
     Auto-push: score & progress only (no more lock push)
     ============================================================ */

  async function pushScoreToBackend(lrn, subject, type, assessmentId, scoreData) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    const user = Store.getUser(lrn);
    if (!user) return { ok: false, error: 'User not found' };

    const payload = {
      lrn,
      student: {
        lrn: user.lrn, lastName: user.lastName, firstName: user.firstName,
        middleName: user.middleName || '',
        gradeLevel: user.gradeLevel, section: user.section
      },
      subject, type, assessmentId,
      score: scoreData.score, total: scoreData.total, percent: scoreData.percent,
      passed: scoreData.passed, autoSubmitted: scoreData.autoSubmitted || false,
      tabViolations: scoreData.tabViolations || 0,
      breakdown: scoreData.breakdown || [],
      timestamp: new Date().toISOString()
    };

    try {
      const res = await backendPost({ action: 'saveScore', ...payload });
      if (res.ok) console.log('[Sync] ✅ Score pushed:', assessmentId);
      else _queueFailedPush('saveScore', payload);
      return res;
    } catch (err) {
      _queueFailedPush('saveScore', payload);
      return { ok: false, error: err.message };
    }
  }

  async function pushProgressToBackend(lrn, subject) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    const user = Store.getUser(lrn);
    if (!user) return { ok: false, error: 'User not found' };
    const progress = Store.getProgress(lrn);

    const payload = {
      lrn,
      student: {
        lrn: user.lrn, lastName: user.lastName, firstName: user.firstName,
        middleName: user.middleName || '',
        gradeLevel: user.gradeLevel, section: user.section
      },
      progress: subject ? { [subject]: progress[subject] } : progress,
      subject: subject || 'both'
    };

    try {
      const res = await backendPost({ action: 'saveProgress', ...payload });
      if (res.ok) console.log('[Sync] ✅ Progress pushed:', subject || 'both');
      else _queueFailedPush('saveProgress', payload);
      return res;
    } catch (err) {
      _queueFailedPush('saveProgress', payload);
      return { ok: false, error: err.message };
    }
  }

  /* ============================================================
     NEW: RETAKE REQUEST SYSTEM
     ============================================================ */

  /**
   * Student: request a retake for a specific assessment.
   */
  async function requestRetake(lrn, assessmentId, reason, score, total) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    const user = Store.getUser(lrn);
    if (!user) return { ok: false, error: 'User not found' };

    try {
      const res = await backendPost({
        action: 'requestRetake',
        lrn,
        student: {
          lastName: user.lastName, firstName: user.firstName,
          section: user.section
        },
        assessmentId,
        reason: reason || 'failed-attempt',
        score: score || 0,
        total: total || 0
      });
      if (res.ok) console.log('[Sync] 📝 Retake request created:', assessmentId);
      else console.warn('[Sync] Retake request failed:', res.error);
      return res;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Student: get their own requests.
   */
  async function getStudentRequests(lrn) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    try {
      const res = await backendPost({ action: 'getStudentRequests', lrn });
      return res;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Student: redeem a retake code from the teacher.
   */
  async function redeemUnlockCode(lrn, code) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    if (!lrn || !code) return { ok: false, error: 'Missing lrn or code' };

    try {
      const res = await backendPost({ action: 'redeemUnlockCode', lrn, code });

      if (res.ok && res.assessmentId) {
        // Apply locally
        Store.unlockAssessment(lrn, res.assessmentId);
        try {
          localStorage.setItem(
            `${NS}unlocked_${lrn}_${res.assessmentId}`,
            JSON.stringify({
              unlockedAt: res.appliedAt,
              requestId: res.requestId,
              source: 'code-redeem',
              code: code
            })
          );
        } catch (e) { /* silent */ }
        console.log('[Sync] 🔓 Unlock applied:', res.assessmentId);
      }

      return res;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Teacher: fetch all requests (with optional filter).
   */
  async function getUnlockRequests(token, filter) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    if (!token) return { ok: false, error: 'Teacher token required' };
    try {
      const res = await backendPost({
        action: 'getUnlockRequests',
        token, filter: filter || 'all'
      });
      return res;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Teacher: approve a request, generating a code.
   */
  async function approveRetake(token, requestId) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    if (!token || !requestId) return { ok: false, error: 'Missing token or requestId' };
    try {
      const res = await backendPost({ action: 'approveRetake', token, requestId });
      return res;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Teacher: cancel a request.
   */
  async function cancelRequest(token, requestId) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    try {
      const res = await backendPost({ action: 'cancelRequest', token, requestId });
      return res;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /* ============================================================
     Local retake flag helpers (for UI to check)
     ============================================================ */

  function getRetakeUnlock(lrn, assessmentId) {
    try {
      const raw = localStorage.getItem(`${NS}unlocked_${lrn}_${assessmentId}`);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function clearRetakeUnlock(lrn, assessmentId) {
    try { localStorage.removeItem(`${NS}unlocked_${lrn}_${assessmentId}`); }
    catch (e) { /* silent */ }
  }

  /* ============================================================
     Failed-push queue
     ============================================================ */

  function _queueFailedPush(action, body) {
    try {
      const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      const fp = `${action}|${body.lrn || ''}|${body.subject || 'both'}|${body.assessmentId || 'progress'}`;
      if (queue.some((item) => item.fingerprint === fp)) return;
      queue.push({ action, body, fingerprint: fp, queuedAt: new Date().toISOString(), attempts: 0 });
      while (queue.length > MAX_QUEUE_SIZE) queue.shift();
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch (e) { /* silent */ }
  }

  async function flushQueue() {
    if (!backendEnabled()) return { ok: false, flushed: 0 };
    let queue;
    try { queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
    catch (e) { return { ok: false, flushed: 0 }; }
    if (!queue.length) return { ok: true, flushed: 0 };

    const remaining = [];
    let flushed = 0;
    for (const item of queue) {
      try {
        const res = await backendPost({ action: item.action, ...item.body });
        if (res.ok) flushed++;
        else {
          item.attempts = (item.attempts || 0) + 1;
          if (item.attempts < MAX_RETRIES) remaining.push(item);
        }
      } catch (e) {
        item.attempts = (item.attempts || 0) + 1;
        if (item.attempts < MAX_RETRIES) remaining.push(item);
      }
    }
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining)); } catch (e) {}
    return { ok: true, flushed, remaining: remaining.length };
  }

  function getQueueStatus() {
    try {
      const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      return { count: queue.length, items: queue.map((q) => ({ action: q.action, ...q.body })) };
    } catch (e) { return { count: 0, items: [] }; }
  }

  function clearQueue() {
    try { localStorage.setItem(QUEUE_KEY, '[]'); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('load', () => setTimeout(flushQueue, 3000));
    window.addEventListener('online', () => setTimeout(flushQueue, 1000));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) setTimeout(flushQueue, 500);
    });
    setInterval(() => { if (getQueueStatus().count > 0) flushQueue(); }, AUTO_FLUSH_INTERVAL);
  }

  async function pingBackend() {
    if (!backendEnabled()) return { ok: false, error: 'No backend URL configured' };
    try { return await backendGet({ action: 'ping' }); }
    catch (err) { return { ok: false, error: err.message }; }
  }

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

  /* ============================================================
     Public API
     ============================================================ */
  return {
    backendEnabled,
    buildPayload,
    generateSyncCode,
    lookupSyncCode,
    exportAsFile,
    importFromFile,
    importFromCode,
    fetchAllStudentsFromBackend,
    pushScoreToBackend,
    pushProgressToBackend,
    requestRetake,
    getStudentRequests,
    redeemUnlockCode,
    getUnlockRequests,
    approveRetake,
    cancelRequest,
    getRetakeUnlock,
    clearRetakeUnlock,
    flushQueue,
    getQueueStatus,
    clearQueue,
    pingBackend
  };
})();
