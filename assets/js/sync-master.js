/* ============================================================
   sync-master.js — Master Sync Engine with Merge
   Version: 2.0.0
   ============================================================ */

const SyncMaster = (() => {
  'use strict';

  const NS = 'gba_v1_';
  const QUEUE_KEY = `${NS}master_queue`;

  function backendEnabled() {
    return typeof CONFIG !== 'undefined' && CONFIG.backendEnabled;
  }

  async function backendPost(body, retries = 2) {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(CONFIG.BACKEND_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(body)
        });
        const text = await res.text();
        if (text.startsWith('<')) throw new Error('ERR_HTML_RESPONSE');
        return JSON.parse(text);
      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      }
    }
  }

  async function pullFromBackend(lrn) {
    if (!backendEnabled()) return { ok: false, error: 'ERR_BACKEND_DISABLED', code: 'BACKEND_DISABLED' };
    const normalized = Store.normalizeLRN(lrn);
    
    try {
      const res = await backendPost({ action: 'getStudentByLRN', lrn: normalized });
      if (!res.ok) return res;

      const student = res.student;
      
      // Save via Store (which handles merging? For now, Store.saveUser handles the profile)
      Store.saveUser({ ...student, lrn: normalized });
      
      // Merge progress and scores manually
      const localProgress = Store.getProgress(normalized);
      const localScores = Store.getScores(normalized);
      const localBadges = Store.getBadges(normalized);

      Store.saveProgress(normalized, mergeProgress(localProgress, student.ProgressObj));
      localStorage.setItem(`${NS}scores_${normalized}`, JSON.stringify(mergeScores(localScores, student.ScoresObj)));
      localStorage.setItem(`${NS}badges_${normalized}`, JSON.stringify(mergeBadges(localBadges, student.BadgesObj)));
      
      return { ok: true, user: Store.getUser(normalized), migrated: res.migrated || false };
    } catch (err) {
      console.warn('[SyncMaster] Pull failed:', err.message);
      return { ok: false, error: err.message, code: 'NETWORK_ERROR' };
    }
  }

  function mergeProgress(existing, incoming) {
    if (!incoming) return existing || {};
    if (!existing) return incoming;
    const merged = JSON.parse(JSON.stringify(existing));
    for (const subj in incoming) {
      if (!merged[subj]) merged[subj] = { completed: [], weeks: {} };
      merged[subj].completed = Array.from(new Set([...(merged[subj].completed || []), ...(incoming[subj].completed || [])]));
      const incWeeks = incoming[subj].weeks || {};
      if (!merged[subj].weeks) merged[subj].weeks = {};
      for (const w in incWeeks) { if (!merged[subj].weeks[w]) merged[subj].weeks[w] = {}; Object.assign(merged[subj].weeks[w], incWeeks[w]); }
    }
    return merged;
  }

  function mergeScores(existing, incoming) {
    if (!incoming) return existing || {};
    if (!existing) return incoming;
    const merged = JSON.parse(JSON.stringify(existing));
    for (const subj in incoming) {
      if (!merged[subj]) merged[subj] = {};
      for (const type in incoming[subj]) {
        if (!merged[subj][type]) merged[subj][type] = {};
        if (type === 'te') { if (incoming[subj][type]) merged[subj][type] = incoming[subj][type]; }
        else {
          const incItems = incoming[subj][type] || {};
          for (const id in incItems) {
            const incItem = incItems[id], extItem = merged[subj][type][id];
            if (!extItem) merged[subj][type][id] = incItem;
            else {
              const incTime = new Date(incItem.timestamp || 0).getTime(), extTime = new Date(extItem.timestamp || 0).getTime();
              if (incTime > extTime || (incTime === extTime && (incItem.score || 0) > (extItem.score || 0))) merged[subj][type][id] = incItem;
            }
          }
        }
      }
    }
    return merged;
  }

  function mergeBadges(existing, incoming) {
    if (!incoming) return existing || {};
    if (!existing) return incoming;
    const merged = JSON.parse(JSON.stringify(existing));
    for (const subj in incoming) merged[subj] = Array.from(new Set([...(merged[subj] || []), ...(incoming[subj] || [])]));
    return merged;
  }

  // (Push and queue logic kept from previous version)
  async function pushMasterUpdate(lrn, subject, type, payloadData) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    const normalized = Store.normalizeLRN(lrn);
    const user = Store.getUser(normalized);
    if (!user) return { ok: false, error: 'User not found' };

    const progress = Store.getProgress(normalized);
    const scores = Store.getScores(normalized);
    const badges = Store.getBadges(normalized);

    const body = {
      action: 'upsertStudentMaster', lrn: normalized,
      student: { lastName: user.lastName, firstName: user.firstName, middleName: user.middleName || '', gradeLevel: user.gradeLevel, section: user.section, sex: user.sex || '' },
      progress: progress, scores: scores, badges: badges, deviceId: getDeviceId()
    };

    try {
      const res = await backendPost(body);
      if (res.ok) {
        localStorage.setItem(`${NS}last_push_at`, new Date().toISOString());
        window.dispatchEvent(new Event('sync-queue-changed'));
      } else { _queueFailedPush(body); }
      return res;
    } catch (err) { _queueFailedPush(body); return { ok: false, error: err.message }; }
  }

  function _queueFailedPush(body) {
    try {
      const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      const existingIdx = queue.findIndex(q => q.lrn === body.lrn);
      if (existingIdx >= 0) queue[existingIdx] = { body, queuedAt: new Date().toISOString(), attempts: 0 };
      else queue.push({ body, queuedAt: new Date().toISOString(), attempts: 0 });
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-50)));
      window.dispatchEvent(new Event('sync-queue-changed'));
    } catch (e) {}
  }

  async function flushQueue() {
    if (!backendEnabled() || !navigator.onLine) return { ok: false, flushed: 0 };
    let queue;
    try { queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (e) { return { ok: false, flushed: 0 }; }
    if (!queue.length) return { ok: true, flushed: 0 };
    const remaining = []; let flushed = 0;
    for (const item of queue) {
      try {
        const res = await backendPost(item.body);
        if (res.ok) { flushed++; localStorage.setItem(`${NS}last_push_at`, new Date().toISOString()); }
        else { item.attempts = (item.attempts || 0) + 1; if (item.attempts < 5) remaining.push(item); }
      } catch (e) { item.attempts = (item.attempts || 0) + 1; if (item.attempts < 5) remaining.push(item); }
    }
    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    window.dispatchEvent(new Event('sync-queue-changed'));
    return { ok: true, flushed, remaining: remaining.length };
  }

  function getQueueStatus() {
    try { const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); return { count: queue.length }; }
    catch (e) { return { count: 0 }; }
  }

  function getDeviceId() {
    let devId = localStorage.getItem(`${NS}device_id`);
    if (!devId) { devId = 'DEV-' + Math.random().toString(36).substr(2, 9); localStorage.setItem(`${NS}device_id`, devId); }
    return devId;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('load', () => setTimeout(flushQueue, 3000));
    window.addEventListener('online', () => setTimeout(flushQueue, 1000));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(flushQueue, 500); });
    setInterval(() => { if (getQueueStatus().count > 0) flushQueue(); }, 60000);
  }

  return { backendEnabled, pullFromBackend, pushMasterUpdate, flushQueue, getQueueStatus, getDeviceId };
})();

window.SyncMaster = SyncMaster;
