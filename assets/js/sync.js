/* ============================================================
   sync.js — Sync Code + Retake Request System
   Version: 2.2.0  (sync-complete)
   ------------------------------------------------------------
   v2.2.0:
   - pushScoreToBackend gumagamit ng PAREHONG timestamp ng lokal na score (dati: bago, kaya hindi nagtutugma).
   - Ang pumalyang push ay pinapalitan ng mas bago (dati: itinatapon ang bago kapag may lumang naka-queue)
     at HINDI na binubura pagkatapos ng 5 try.
   - pushProgressToBackend ay nagpapadala na ng KUMPLETONG snapshot (progress + scores + badges + points)
     sa pamamagitan ng SyncMaster (kusang nilo-load kung wala pa).
   - Bagong pushActivityToBackend.
   - Sinusuri na ang response ng backend (ok:false -> naka-queue, hindi "success").
   v2.1.0:
   - Added retake counter awareness.
   - Cleaned up: removed pushLock/pullLocks/deleteLock
     (no longer needed in new architecture).
   - Removed applyPendingUnlocks (replaced by code redemption).
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

  // Base URL ng folder na ito (para ma-load ang sync-master.js mula sa kahit anong page)
  const _BASE = (() => {
    try { return document.currentScript && document.currentScript.src ? document.currentScript.src.replace(/[^/]*$/, '') : ''; }
    catch (e) { return ''; }
  })();

  let _masterLoading = null;
  function ensureSyncMaster() {
    if (window.SyncMaster) return Promise.resolve(window.SyncMaster);
    if (_masterLoading) return _masterLoading;
    _masterLoading = new Promise((resolve) => {
      if (!_BASE) return resolve(null);
      const s = document.createElement('script');
      s.src = _BASE + 'sync-master.js';
      s.onload = () => resolve(window.SyncMaster || null);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
    return _masterLoading;
  }

  async function backendPost(body) {
    const res = await fetch(CONFIG.BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    if (text.trim().startsWith('<')) throw new Error('ERR_HTML_RESPONSE (check Apps Script deployment)');
    return JSON.parse(text);
  }

  async function backendGet(params) {
    const url = new URL(CONFIG.BACKEND_URL);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString());
    return res.json();
  }

  /* ---------- Sync Code ---------- */

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

  /* ---------- Auto-push scores/progress ---------- */

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
      score: scoreData.score === undefined ? null : scoreData.score,
      total: scoreData.total === undefined ? null : scoreData.total,
      percent: scoreData.percent === undefined ? null : scoreData.percent,
      passed: !!scoreData.passed, autoSubmitted: scoreData.autoSubmitted || false,
      tabViolations: scoreData.tabViolations || 0,
      durationSec: scoreData.durationSec || 0,
      breakdown: scoreData.breakdown || [],
      // PAREHONG timestamp ng lokal na score para magtugma sa merge ng backend at ng ibang device
      timestamp: scoreData.timestamp || new Date().toISOString(),
      deviceId: (window.SyncMaster && SyncMaster.getDeviceId) ? SyncMaster.getDeviceId() : undefined
    };
    // PT / ibang uri: ipasa ang dagdag na fields (option, status, maxScore...)
    ['status', 'maxScore', 'option', 'optionLabel'].forEach((k) => { if (scoreData[k] !== undefined) payload[k] = scoreData[k]; });

    try {
      const res = await backendPost({ action: 'saveScore', ...payload });
      if (res && res.ok) {
        localStorage.setItem(`${NS}last_push_at`, new Date().toISOString());
        console.log('[Sync] ✅ Score pushed:', assessmentId);
        window.dispatchEvent(new Event('sync-queue-changed'));
      } else {
        _queueFailedPush('saveScore', payload);
      }
      return res || { ok: false, error: 'No response' };
    } catch (err) {
      _queueFailedPush('saveScore', payload);
      return { ok: false, error: err.message };
    }
  }

  /* ---------- Lesson activity result ---------- */
  async function pushActivityToBackend(lrn, subject, activity) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    const user = Store.getUser(lrn);
    if (!user) return { ok: false, error: 'User not found' };
    const payload = {
      lrn,
      student: { lastName: user.lastName, firstName: user.firstName, middleName: user.middleName || '', gradeLevel: user.gradeLevel, section: user.section },
      subject, week: activity.week, day: activity.day, activity: activity.activity,
      percent: activity.percent, passed: !!activity.passed, attempts: activity.attempts || 1,
      timestamp: activity.timestamp || new Date().toISOString()
    };
    try {
      const res = await backendPost({ action: 'saveActivity', ...payload });
      if (!(res && res.ok)) _queueFailedPush('saveActivity', payload);
      return res || { ok: false, error: 'No response' };
    } catch (err) {
      _queueFailedPush('saveActivity', payload);
      return { ok: false, error: err.message };
    }
  }

  async function pushProgressToBackend(lrn, subject) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    // Kumpletong snapshot (progress + scores + badges + points) sa pamamagitan ng SyncMaster
    const master = await ensureSyncMaster();
    if (master && typeof master.pushMasterUpdate === 'function') {
      return master.pushMasterUpdate(lrn, subject || 'both', 'progress');
    }
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

  /* ---------- Retake Request System ---------- */

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

  async function getStudentRequests(lrn) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    try {
      const res = await backendPost({ action: 'getStudentRequests', lrn });
      return res;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function redeemUnlockCode(lrn, code) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    if (!lrn || !code) return { ok: false, error: 'Missing lrn or code' };

    try {
      const res = await backendPost({ action: 'redeemUnlockCode', lrn, code });

      if (res.ok && res.assessmentId) {
        Store.unlockAssessment(lrn, res.assessmentId);
        try {
          localStorage.setItem(
            `${NS}unlocked_${lrn}_${res.assessmentId}`,
            JSON.stringify({
              unlockedAt: res.appliedAt,
              requestId: res.requestId,
              source: 'code-redeem',
              code: code,
              retakeNumber: res.retakeNumber || 0,
              isFinalAttempt: res.isFinalAttempt || false
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

  async function cancelRequest(token, requestId) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    try {
      const res = await backendPost({ action: 'cancelRequest', token, requestId });
      return res;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /* ---------- Local retake flag helpers ---------- */

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

  /* ---------- Failed-push queue ---------- */

  function _queueFailedPush(action, body) {
    try {
      const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      const fp = `${action}|${body.lrn || ''}|${body.subject || 'both'}|${body.assessmentId || body.activity || 'progress'}|${body.week || ''}|${body.day || ''}`;
      // Palitan ng MAS BAGONG data ang lumang naka-queue (dati: itinatapon ang bago)
      const idx = queue.findIndex((item) => item.fingerprint === fp);
      const item = { action, body, fingerprint: fp, queuedAt: new Date().toISOString(), attempts: 0 };
      if (idx >= 0) {
        const old = queue[idx];
        if (action === 'saveScore' && old.body && old.body.timestamp && body.timestamp && old.body.timestamp > body.timestamp) return; // mas luma ang bago; huwag palitan
        queue[idx] = item;
      } else queue.push(item);
      while (queue.length > MAX_QUEUE_SIZE) queue.shift();
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      window.dispatchEvent(new Event('sync-queue-changed'));
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
        if (res && res.ok) flushed++;
        else {
          item.attempts = (item.attempts || 0) + 1;
          item.lastError = res && res.error;
          remaining.push(item);          // HINDI na binubura; uulitin hanggang pumasok
        }
      } catch (e) {
        item.attempts = (item.attempts || 0) + 1;
        item.lastError = e && e.message;
        remaining.push(item);
      }
    }
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining)); } catch (e) {}
    if (flushed) { try { localStorage.setItem(`${NS}last_push_at`, new Date().toISOString()); } catch (e) {} }
    // kasama rin ang queue ng SyncMaster
    try {
      if (window.SyncMaster && typeof SyncMaster.flushQueue === 'function') {
        const m = await SyncMaster.flushQueue();
        flushed += (m && m.flushed) || 0;
      }
    } catch (e) { /* ignore */ }
    window.dispatchEvent(new Event('sync-queue-changed'));
    return { ok: true, flushed, remaining: remaining.length };
  }

  function getQueueStatus() {
    try {
      const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      let masterCount = 0;
      try { masterCount = JSON.parse(localStorage.getItem(`${NS}master_queue`) || '[]').length; } catch (e) { /* ignore */ }
      return { count: queue.length + masterCount, items: queue.map((q) => ({ action: q.action, ...q.body })) };
    } catch (e) { return { count: 0, items: [] }; }
  }

  function clearQueue() {
    try { localStorage.setItem(QUEUE_KEY, '[]'); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  if (typeof window !== 'undefined') {
    // Student pages: siguraduhing tumatakbo ang SyncMaster (auto push/pull)
    window.addEventListener('DOMContentLoaded', () => {
      try {
        const sess = JSON.parse(localStorage.getItem(`${NS}session`) || 'null');
        const isTeacher = typeof TeacherAuth !== 'undefined';
        if (sess && sess.lrn && !isTeacher && backendEnabled()) ensureSyncMaster();
      } catch (e) { /* ignore */ }
    });
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
    pushScoreToBackend,
    pushProgressToBackend,
    pushActivityToBackend,
    ensureSyncMaster,
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
