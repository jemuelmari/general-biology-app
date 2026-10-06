/* ============================================================
   sync.js — Sync Code + JSON payload + Unlock + Lock system
   Version: 1.7.3
   ------------------------------------------------------------
   v1.7.3:
   - FIX: Changed fetch Content-Type to 'text/plain' to bypass
     CORS preflight (OPTIONS) requests that Apps Script does not
     handle. This resolves the "Backend unreachable" error.
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
      // ✅ THE FIX: 'text/plain' avoids CORS preflight.
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

  async function generateSyncCode(lrn, subject) {
    const { payload, signature } = await buildPayload(lrn, subject);
    const json = JSON.stringify(payload);
    const signatureShort = signature.slice(0, 8).toUpperCase();
    const hash = _shortHash(json).toUpperCase();
    const code = `GB12-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${signatureShort}`;
    let mode = 'local';
    if (backendEnabled()) {
      try {
        const res = await backendPost({ action: 'registerSyncCode', code, lrn, payload, signature });
        if (res.ok) mode = 'backend';
      } catch (err) { /* silent */ }
    }
    _saveLocalCode(code, { payload, signature });
    return { code, payload, signature, mode, createdAt: new Date().toISOString() };
  }

  async function lookupSyncCode(code) {
    if (backendEnabled()) {
      try {
        const res = await backendPost({ action: 'resolveSyncCode', code });
        if (res.ok) return { payload: res.payload, signature: res.signature, source: 'backend', createdAt: res.createdAt };
      } catch (err) { /* silent */ }
    }
    const local = _getLocalCode(code);
    if (local) return { ...local, source: 'local' };
    return null;
  }

  function _saveLocalCode(code, data) {
    const codes = JSON.parse(localStorage.getItem(`${NS}sync_codes`) || '{}');
    codes[code] = { ...data, savedAt: new Date().toISOString() };
    const entries = Object.entries(codes).sort((a, b) => new Date(b[1].savedAt) - new Date(a[1].savedAt));
    localStorage.setItem(`${NS}sync_codes`, JSON.stringify(Object.fromEntries(entries.slice(0, 10))));
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

          if (parsed.payload && typeof parsed.payload === 'object') {
            const { payload, signature } = parsed;
            if (!payload.student || !payload.student.lrn) return reject(new Error('Payload missing student.lrn'));
            let verified = false;
            let warning = null;
            if (signature && typeof signature === 'string' && Security && typeof Security.verify === 'function') {
              try { verified = await Security.verify(payload, signature); } catch (err) { verified = false; }
              if (!verified) warning = 'Signature could not be verified. File structure is valid — importing anyway.';
            } else {
              warning = 'No signature found. File structure is valid — importing anyway.';
            }
            return resolve({ payload, signature: signature || null, valid: true, verified, warning, source: 'file' });
          }

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
            return resolve({ payload, signature: null, valid: true, verified: false, warning: 'Loaded from legacy dashboard backup format.', source: 'file' });
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
    if (!record) {
      return {
        valid: false,
        error: backendEnabled() ? 'Code not found (checked backend and this device)' : 'Code not found on this device.'
      };
    }
    const verified = await Security.verify(record.payload, record.signature);
    return { payload: record.payload, signature: record.signature, valid: true, verified, source: record.source };
  }

  async function fetchAllStudentsFromBackend(token) {
    if (!backendEnabled()) return { ok: false, error: 'Backend not configured' };
    if (!token) return { ok: false, error: 'Teacher token required' };
    try {
      const res = await backendPost({ action: 'getAllStudentsAggregated', token });
      if (!res.ok) return { ok: false, error: res.error || 'Backend returned error' };
      return { ok: true, count: res.count || (res.students || []).length, students: res.students || [] };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /* ============================================================
     Auto-push methods
     ============================================================ */

  async function pushScoreToBackend(lrn, subject, type, assessmentId, scoreData) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    const user = Store.getUser(lrn);
    if (!user) return { ok: false, error: 'User not found' };

    const payload = {
      lrn,
      student: {
        lrn: user.lrn, lastName: user.lastName, firstName: user.firstName,
        middleName: user.middleName || '', gradeLevel: user.gradeLevel, section: user.section
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
      if (res.ok) console.log('[Sync] ✅ Score pushed to backend:', assessmentId);
      else console.warn('[Sync] Score push rejected:', res.error);
      return res;
    } catch (err) {
      console.warn('[Sync] Score push failed:', err.message);
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
        middleName: user.middleName || '', gradeLevel: user.gradeLevel, section: user.section
      },
      progress: subject ? { [subject]: progress[subject] } : progress,
      subject: subject || 'both'
    };

    try {
      const res = await backendPost({ action: 'saveProgress', ...payload });
      if (res.ok) console.log('[Sync] ✅ Progress pushed to backend:', subject || 'both');
      else console.warn('[Sync] Progress push rejected:', res.error);
      return res;
    } catch (err) {
      console.warn('[Sync] Progress push failed:', err.message);
      return { ok: false, error: err.message };
    }
  }

  /* ============================================================
     UNLOCK SYSTEM
     ============================================================ */

  async function pushUnlock(lrn, assessmentId, token, reason) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    if (!lrn || !assessmentId) return { ok: false, error: 'Missing lrn or assessmentId' };
    if (!token) return { ok: false, error: 'Teacher token required' };

    try {
      const res = await backendPost({
        action: 'pushUnlock',
        token,
        lrn,
        assessmentId,
        reason: reason || 'retake-approved',
        pushedBy: 'teacher'
      });
      if (res.ok) console.log('[Sync] 🔓 Unlock pushed:', lrn, assessmentId);
      else console.warn('[Sync] Unlock push failed:', res.error);
      return res;
    } catch (err) {
      console.warn('[Sync] Unlock push threw:', err.message);
      return { ok: false, error: err.message };
    }
  }

  async function pullUnlocks(lrn) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    if (!lrn) return { ok: false, error: 'Missing lrn' };
    try {
      const res = await backendPost({ action: 'pullUnlocks', lrn });
      return res;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function markUnlockApplied(unlockId) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    if (!unlockId) return { ok: false, error: 'Missing unlockId' };
    try {
      const res = await backendPost({ action: 'markUnlockApplied', unlockId });
      return res;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function applyPendingUnlocks(lrn) {
    if (!backendEnabled()) return [];
    if (!lrn) return [];

    try {
      const res = await pullUnlocks(lrn);
      if (!res.ok || !res.records || !res.records.length) return [];

      const applied = [];
      for (const unlock of res.records) {
        const aid = unlock.assessmentId;
        if (!aid) continue;

        const hadLocalLock = Store.isAssessmentLocked(lrn, aid);
        Store.unlockAssessment(lrn, aid);

        try {
          localStorage.setItem(
            `${NS}unlocked_${lrn}_${aid}`,
            JSON.stringify({
              unlockedAt: new Date().toISOString(),
              unlockId: unlock.unlockId,
              reason: unlock.reason || 'retake-approved',
              pushedAt: unlock.pushedAt
            })
          );
        } catch (e) { /* silent */ }

        try {
          await markUnlockApplied(unlock.unlockId);
        } catch (e) { /* silent */ }

        applied.push({
          unlockId: unlock.unlockId,
          assessmentId: aid,
          reason: unlock.reason || 'retake-approved',
          pushedAt: unlock.pushedAt,
          hadLocalLock
        });
      }

      if (applied.length) {
        console.log('[Sync] 🔓 Applied', applied.length, 'pending unlock(s):', applied.map((a) => a.assessmentId).join(', '));
      }
      return applied;
    } catch (err) {
      console.warn('[Sync] applyPendingUnlocks failed:', err.message);
      return [];
    }
  }

  function getRetakeUnlock(lrn, assessmentId) {
    try {
      const raw = localStorage.getItem(`${NS}unlocked_${lrn}_${assessmentId}`);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearRetakeUnlock(lrn, assessmentId) {
    try {
      localStorage.removeItem(`${NS}unlocked_${lrn}_${assessmentId}`);
    } catch (e) { /* silent */ }
  }

  async function getAllUnlocks(token) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    if (!token) return { ok: false, error: 'Teacher token required' };
    try {
      const res = await backendPost({ action: 'getAllUnlocks', token });
      return res;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /* ============================================================
     LOCK MANAGEMENT SYSTEM
     ============================================================ */

  async function pushLock(lrn, assessmentId, lockData) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    const user = Store.getUser(lrn);
    if (!user) return { ok: false, error: 'User not found' };

    const payload = {
      action: 'pushLock',
      lrn,
      student: { lastName: user.lastName, firstName: user.firstName, section: user.section },
      assessmentId,
      reason: lockData.reason || 'failed',
      score: lockData.score,
      total: lockData.total,
      lockedAt: lockData.lockedAt || new Date().toISOString()
    };

    try {
      const res = await backendPost(payload);
      if (res.ok) console.log('[Sync] 🔒 Lock pushed to backend:', assessmentId);
      else console.warn('[Sync] Lock push failed:', res.error);
      return res;
    } catch (err) {
      console.warn('[Sync] Lock push threw:', err.message);
      return { ok: false, error: err.message };
    }
  }

  async function pullLocks(filter) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    try {
      const res = await backendPost({ action: 'pullLocks', ...filter });
      return res;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function deleteLock(lockId) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    if (!lockId) return { ok: false, error: 'Missing lockId' };
    try {
      const res = await backendPost({ action: 'deleteLock', lockId });
      return res;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /* ============================================================
     Failed-push queue
     ============================================================ */
  function _queueFailedPush(action, body) {
    // Note: This queue is now less critical but still useful for offline resilience.
    try {
      const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      const fingerprint = _queueFingerprint(action, body);
      if (queue.some((item) => item.fingerprint === fingerprint)) return;

      queue.push({ action, body, fingerprint, queuedAt: new Date().toISOString(), attempts: 0 });
      while (queue.length > MAX_QUEUE_SIZE) queue.shift();
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      console.log(`[Sync] Queued failed ${action}. Queue size: ${queue.length}`);
      _notifyQueueChange();
    } catch (e) {
      console.warn('[Sync] Could not queue failed push:', e);
    }
  }

  function _queueFingerprint(action, body) {
    return `${action}|${body.lrn || ''}|${body.subject || 'both'}|${body.assessmentId || 'progress'}`;
  }

  async function flushQueue() {
    if (!backendEnabled()) return { ok: false, flushed: 0, remaining: 0 };
    let queue;
    try { queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
    catch (e) { return { ok: false, flushed: 0, remaining: 0 }; }

    if (!queue.length) return { ok: true, flushed: 0, remaining: 0 };

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

    if (flushed > 0 || remaining.length !== queue.length) {
      console.log(`[Sync] ✅ Flushed ${flushed}. Remaining: ${remaining.length}`);
      _notifyQueueChange();
    }
    return { ok: true, flushed, remaining: remaining.length };
  }

  function getQueueStatus() {
    try {
      const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      return {
        count: queue.length,
        items: queue.map((q) => ({
          action: q.action, lrn: q.body.lrn,
          assessmentId: q.body.assessmentId, subject: q.body.subject,
          queuedAt: q.queuedAt, attempts: q.attempts
        }))
      };
    } catch (e) {
      return { count: 0, items: [] };
    }
  }

  function clearQueue() {
    try {
      localStorage.setItem(QUEUE_KEY, '[]');
      _notifyQueueChange();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function _notifyQueueChange() {
    try {
      window.dispatchEvent(new CustomEvent('sync-queue-changed', { detail: getQueueStatus() }));
    } catch (e) { /* silent */ }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('load', () => setTimeout(flushQueue, 3000));
    window.addEventListener('online', () => setTimeout(flushQueue, 1000));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(flushQueue, 500); });
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
    pushUnlock,
    pullUnlocks,
    markUnlockApplied,
    applyPendingUnlocks,
    getRetakeUnlock,
    clearRetakeUnlock,
    getAllUnlocks,
    pushLock,
    pullLocks,
    deleteLock,
    flushQueue,
    getQueueStatus,
    clearQueue,
    pingBackend
  };
})();
