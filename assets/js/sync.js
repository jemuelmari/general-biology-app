/* ============================================================
   sync.js — Sync Code + JSON payload + Unlock + Lock system
   Version: 1.7.2
   ------------------------------------------------------------
   v1.7.2:
   - NEW: pushLock, pullLocks, deleteLock methods for
     backend-authoritative lock management.
   v1.7.1:
   - applyPendingUnlocks now sets a retake flag.
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

  // ... [buildPayload, generateSyncCode, lookupSyncCode, etc. unchanged] ...

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
    // ... [unchanged] ...
  }

  async function pushProgressToBackend(lrn, subject) {
    // ... [unchanged] ...
  }

  /* ============================================================
     UNLOCK SYSTEM
     ============================================================ */

  async function pushUnlock(lrn, assessmentId, token, reason) {
    // ... [unchanged] ...
  }

  async function pullUnlocks(lrn) {
    // ... [unchanged] ...
  }

  async function markUnlockApplied(unlockId) {
    // ... [unchanged] ...
  }

  async function applyPendingUnlocks(lrn) {
    // ... [unchanged] ...
  }

  function getRetakeUnlock(lrn, assessmentId) {
    // ... [unchanged] ...
  }

  function clearRetakeUnlock(lrn, assessmentId) {
    // ... [unchanged] ...
  }

  async function getAllUnlocks(token) {
    // ... [unchanged] ...
  }

  /* ============================================================
     NEW: LOCK MANAGEMENT SYSTEM
     ============================================================ */

  /**
   * Student: push a lock to the backend when an assessment fails.
   */
  async function pushLock(lrn, assessmentId, lockData) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    const user = Store.getUser(lrn);
    if (!user) return { ok: false, error: 'User not found' };

    const payload = {
      action: 'pushLock',
      lrn,
      student: {
        lastName: user.lastName,
        firstName: user.firstName,
        section: user.section
      },
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

  /**
   * Teacher: pull all locks from the backend.
   */
  async function pullLocks(filter) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    try {
      const res = await backendPost({ action: 'pullLocks', ...filter });
      return res;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Teacher: delete a lock from the backend (after unlock).
   */
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

  /* ... [Failed-push queue unchanged] ... */

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
    pushLock,      // ← NEW
    pullLocks,     // ← NEW
    deleteLock,    // ← NEW
    flushQueue,
    getQueueStatus,
    clearQueue,
    pingBackend
  };
})();
