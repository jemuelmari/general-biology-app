/* ============================================================
   sync-master.js — Master Sync Engine for Auto-Sync Architecture
   Version: 1.0.0
   ============================================================ */

const SyncMaster = (() => {
  'use strict';

  const NS = 'gba_v1_';
  const QUEUE_KEY = `${NS}master_queue`;
  const LAST_PULL_KEY = `${NS}last_pull_at`;

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

  async function pullFromBackend(lrn) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    
    try {
      const res = await backendPost({ action: 'getStudentByLRN', lrn });
      if (!res.ok) return res;

      const student = res.student;
      
      // Save profile
      Store.saveUser({
        lrn: student.LRN,
        lastName: student.LastName,
        firstName: student.FirstName,
        middleName: student.MiddleName,
        gradeLevel: student.GradeLevel,
        section: student.Section,
        sex: student.Sex
      });

      // Save progress, scores, badges from backend objects
      Store.saveProgress(lrn, student.ProgressObj || {});
      localStorage.setItem(`${NS}scores_${lrn}`, JSON.stringify(student.ScoresObj || {}));
      localStorage.setItem(`${NS}badges_${lrn}`, JSON.stringify(student.BadgesObj || {}));

      localStorage.setItem(LAST_PULL_KEY, new Date().toISOString());
      return { ok: true, migrated: res.migrated || false };
    } catch (err) {
      console.warn('[SyncMaster] Pull failed:', err.message);
      return { ok: false, error: err.message };
    }
  }

  async function pushMasterUpdate(lrn, subject, type, payloadData) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    
    const user = Store.getUser(lrn);
    if (!user) return { ok: false, error: 'User not found' };

    const progress = Store.getProgress(lrn);
    const scores = Store.getScores(lrn);
    const badges = Store.getBadges(lrn);

    const body = {
      action: 'upsertStudentMaster',
      lrn,
      student: {
        lastName: user.lastName,
        firstName: user.firstName,
        middleName: user.middleName || '',
        gradeLevel: user.gradeLevel,
        section: user.section,
        sex: user.sex || ''
      },
      progress: progress,
      scores: scores,
      badges: badges,
      deviceId: getDeviceId()
    };

    try {
      const res = await backendPost(body);
      if (res.ok) {
        localStorage.setItem(`${NS}last_push_at`, new Date().toISOString());
        window.dispatchEvent(new Event('sync-queue-changed'));
      } else {
        _queueFailedPush(body);
      }
      return res;
    } catch (err) {
      _queueFailedPush(body);
      return { ok: false, error: err.message };
    }
  }

  function _queueFailedPush(body) {
    try {
      const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      const existingIdx = queue.findIndex(q => q.lrn === body.lrn);
      if (existingIdx >= 0) {
        queue[existingIdx] = { body, queuedAt: new Date().toISOString(), attempts: 0 };
      } else {
        queue.push({ body, queuedAt: new Date().toISOString(), attempts: 0 });
      }
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-50)));
      window.dispatchEvent(new Event('sync-queue-changed'));
    } catch (e) { /* silent */ }
  }

  async function flushQueue() {
    if (!backendEnabled() || !navigator.onLine) return { ok: false, flushed: 0 };
    let queue;
    try { queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
    catch (e) { return { ok: false, flushed: 0 }; }
    if (!queue.length) return { ok: true, flushed: 0 };

    const remaining = [];
    let flushed = 0;

    for (const item of queue) {
      try {
        const res = await backendPost(item.body);
        if (res.ok) {
          flushed++;
          localStorage.setItem(`${NS}last_push_at`, new Date().toISOString());
        } else {
          item.attempts = (item.attempts || 0) + 1;
          if (item.attempts < 5) remaining.push(item);
        }
      } catch (e) {
        item.attempts = (item.attempts || 0) + 1;
        if (item.attempts < 5) remaining.push(item);
      }
    }
    
    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    window.dispatchEvent(new Event('sync-queue-changed'));
    return { ok: true, flushed, remaining: remaining.length };
  }

  function getQueueStatus() {
    try {
      const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      return { count: queue.length };
    } catch (e) { return { count: 0 }; }
  }

  function getDeviceId() {
    let devId = localStorage.getItem(`${NS}device_id`);
    if (!devId) {
      devId = 'DEV-' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem(`${NS}device_id`, devId);
    }
    return devId;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('load', () => setTimeout(flushQueue, 3000));
    window.addEventListener('online', () => setTimeout(flushQueue, 1000));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) setTimeout(flushQueue, 500);
    });
    setInterval(() => { if (getQueueStatus().count > 0) flushQueue(); }, 60000);
  }

  return {
    backendEnabled,
    pullFromBackend,
    pushMasterUpdate,
    flushQueue,
    getQueueStatus,
    getDeviceId
  };
})();

window.SyncMaster = SyncMaster;
