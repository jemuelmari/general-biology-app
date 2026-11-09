/* ============================================================
   store.js — localStorage persistence with Normalization
   Version: 2.1.0  (activities + points + TE shape repair)
   ============================================================ */

const Store = (() => {
  'use strict';

  const NS = 'gba_v1_'; 
  const USERS_KEY = `${NS}users`;
  const SESSION_KEY = `${NS}session`;

  function normalizeLRN(lrn) {
    if (lrn === null || lrn === undefined) return '';
    let s = String(lrn).trim();
    if (s.endsWith('.0')) s = s.slice(0, -2);
    const digits = s.replace(/\D/g, '');
    if (digits.length > 12) return digits.slice(0, 12);
    if (digits.length < 12) return digits.padStart(12, '0');
    return digits;
  }

  function _get(key, fallback = null) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { console.error('[Store] get error', key, e); return fallback; }
  }

  function _set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.error('[Store] set error', key, e); return false; }
  }

  function _remove(key) { try { localStorage.removeItem(key); } catch (e) {} }

  function getAllUsers() {
    let users = _get(USERS_KEY, []);
    let repaired = false;
    users = users.map(u => {
      const fixedLrn = normalizeLRN(u.lrn);
      if (u.lrn !== fixedLrn) { repaired = true; return { ...u, lrn: fixedLrn }; }
      return u;
    });
    if (repaired) _set(USERS_KEY, users);
    return users;
  }

  function saveUser(user) {
    if (!user || !user.lrn) throw new Error('ERR_BAD_USER: User or LRN missing');
    const lrn = normalizeLRN(user.lrn);
    const cleanUser = { ...user, lrn };
    const users = getAllUsers();
    const idx = users.findIndex((u) => u.lrn === lrn);
    if (idx >= 0) users[idx] = { ...users[idx], ...cleanUser };
    else users.push(cleanUser);
    _set(USERS_KEY, users);
    return cleanUser;
  }

  function getUser(lrn) {
    const normalized = normalizeLRN(lrn);
    return getAllUsers().find((u) => u.lrn === normalized) || null;
  }

  function deleteUser(lrn) {
    const normalized = normalizeLRN(lrn);
    const users = getAllUsers().filter((u) => u.lrn !== normalized);
    _set(USERS_KEY, users);
    _remove(`${NS}progress_${normalized}`);
    _remove(`${NS}scores_${normalized}`);
    _remove(`${NS}badges_${normalized}`);
    Object.keys(getPoints(normalized)).forEach((k) => _remove(`${NS}points_${normalized}_${k}`));
  }

  function setSession(lrn) { const normalized = normalizeLRN(lrn); _set(SESSION_KEY, { lrn: normalized, startedAt: Date.now() }); }
  function getSession() { const sess = _get(SESSION_KEY, null); if (sess && sess.lrn) sess.lrn = normalizeLRN(sess.lrn); return sess; }
  function clearSession() { _remove(SESSION_KEY); }
  function getCurrentUser() { const session = getSession(); if (!session) return null; return getUser(session.lrn); }

  function getProgress(lrn) {
    const normalized = normalizeLRN(lrn);
    return _get(`${NS}progress_${normalized}`, { biol1: { weeks: {}, completed: [] }, biol2: { weeks: {}, completed: [] } });
  }

  function saveProgress(lrn, progress) {
    const normalized = normalizeLRN(lrn);
    _set(`${NS}progress_${normalized}`, progress);
  }

  function markDayComplete(lrn, subject, week, day) {
    const normalized = normalizeLRN(lrn);
    const p = getProgress(normalized);
    if (!p[subject]) p[subject] = { weeks: {}, completed: [] };
    if (!p[subject].weeks[week]) p[subject].weeks[week] = {};
    p[subject].weeks[week][day] = { completed: true, completedAt: new Date().toISOString() };
    const key = `${subject}-w${week}-d${day}`;
    if (!p[subject].completed.includes(key)) p[subject].completed.push(key);
    saveProgress(normalized, p);
  }

  // Term Exam ay dapat NESTED: te = { 'biol1-te': {...} }. Ang lumang flat na te ({score,total,...}) ay inaayos dito.
  function _repairScores(scores) {
    if (!scores || typeof scores !== 'object') return scores;
    ['biol1', 'biol2'].forEach((subj) => {
      const s = scores[subj];
      if (!s) return;
      const te = s.te;
      if (te && typeof te === 'object' && ['score', 'percent', 'total', 'passed'].some((k) => te[k] !== undefined && typeof te[k] !== 'object')) {
        s.te = { [`${subj}-te`]: te };
      }
      if (te === null) s.te = {};
      if (!s.activities) s.activities = {};
    });
    return scores;
  }

  function getScores(lrn) {
    const normalized = normalizeLRN(lrn);
    const scores = _get(`${NS}scores_${normalized}`, { biol1: { quizzes: {}, st: {}, pt: {}, te: {}, activities: {} }, biol2: { quizzes: {}, st: {}, pt: {}, te: {}, activities: {} } });
    return _repairScores(scores);
  }

  function saveScore(lrn, subject, type, id, data) {
    const normalized = normalizeLRN(lrn);
    const scores = getScores(normalized);
    if (!scores[subject]) scores[subject] = {};
    if (!scores[subject][type]) scores[subject][type] = {};
    scores[subject][type][id] = { ...data, timestamp: new Date().toISOString() };
    _set(`${NS}scores_${normalized}`, scores);
    return scores[subject][type][id];
  }

  function deleteScore(lrn, subject, type, id) {
    const normalized = normalizeLRN(lrn);
    const scores = getScores(normalized);
    if (scores[subject] && scores[subject][type] && scores[subject][type][id] !== undefined) {
      delete scores[subject][type][id];
      _set(`${NS}scores_${normalized}`, scores);
      return true;
    }
    return false;
  }

  /* ---------- Lesson activity results (Activity 1 / Activity 2 / Formative) ---------- */
  // Pinapanatili ang pinakamataas na percent (ang "Practice Again" ay hindi dapat magpababa ng pasadong score).
  function saveActivity(lrn, subject, id, data) {
    const normalized = normalizeLRN(lrn);
    const scores = getScores(normalized);
    if (!scores[subject]) scores[subject] = {};
    if (!scores[subject].activities) scores[subject].activities = {};
    const prev = scores[subject].activities[id];
    const next = { ...data, timestamp: new Date().toISOString() };
    if (prev) {
      next.attempts = Math.max(Number(prev.attempts) || 0, Number(data.attempts) || 0);
      if ((Number(prev.percent) || 0) > (Number(next.percent) || 0)) {
        next.percent = prev.percent; next.score = prev.score; next.passed = prev.passed;
      }
    }
    scores[subject].activities[id] = next;
    _set(`${NS}scores_${normalized}`, scores);
    return next;
  }

  /* ---------- Daily points: { 'biol1_w1_d2': 40 } ---------- */
  function getPoints(lrn) {
    const normalized = normalizeLRN(lrn);
    const prefix = `${NS}points_${normalized}_`;
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        try { out[k.slice(prefix.length)] = Number(JSON.parse(localStorage.getItem(k))) || 0; } catch (e) { /* skip */ }
      }
    }
    return out;
  }

  function mergePoints(lrn, incoming) {
    const normalized = normalizeLRN(lrn);
    let changed = false;
    Object.keys(incoming || {}).forEach((k) => {
      const key = `${NS}points_${normalized}_${k}`;
      const cur = _get(key, 0) || 0;
      const inc = Number(incoming[k]) || 0;
      if (inc > cur) { _set(key, inc); changed = true; }
    });
    return changed;
  }

  function getBadges(lrn) {
    const normalized = normalizeLRN(lrn);
    return _get(`${NS}badges_${normalized}`, { biol1: [], biol2: [] });
  }

  function awardBadge(lrn, subject, badgeId) {
    const normalized = normalizeLRN(lrn);
    const badges = getBadges(normalized);
    if (!badges[subject]) badges[subject] = [];
    if (!badges[subject].includes(badgeId)) {
      badges[subject].push(badgeId);
      _set(`${NS}badges_${normalized}`, badges);
      return true;
    }
    return false;
  }

  function getDailyPoints(lrn, subject, week, day) {
    const normalized = normalizeLRN(lrn);
    return _get(`${NS}points_${normalized}_${subject}_w${week}_d${day}`, 0);
  }

  function addDailyPoints(lrn, subject, week, day, points) {
    const normalized = normalizeLRN(lrn);
    const key = `${NS}points_${normalized}_${subject}_w${week}_d${day}`;
    const current = _get(key, 0);
    const updated = current + points;
    _set(key, updated);
    return updated;
  }

  function getAttempts(lrn, assessmentId) {
    const normalized = normalizeLRN(lrn);
    return _get(`${NS}attempts_${normalized}_${assessmentId}`, 0);
  }

  function incrementAttempts(lrn, assessmentId) {
    const normalized = normalizeLRN(lrn);
    const key = `${NS}attempts_${normalized}_${assessmentId}`;
    const n = _get(key, 0) + 1;
    _set(key, n);
    return n;
  }

  function lockAssessment(lrn, assessmentId, lockData) {
    const normalized = normalizeLRN(lrn);
    _set(`${NS}lock_${normalized}_${assessmentId}`, { locked: true, ...lockData, lockedAt: new Date().toISOString() });
  }

  function isAssessmentLocked(lrn, assessmentId) {
    const normalized = normalizeLRN(lrn);
    const lock = _get(`${NS}lock_${normalized}_${assessmentId}`, null);
    return lock && lock.locked;
  }

  function unlockAssessment(lrn, assessmentId) {
    const normalized = normalizeLRN(lrn);
    _remove(`${NS}lock_${normalized}_${assessmentId}`);
  }

  function exportAll(lrn) {
    const normalized = normalizeLRN(lrn);
    const user = getUser(normalized);
    if (!user) return null;
    return { version: '1.1.0', exportedAt: new Date().toISOString(), user, progress: getProgress(normalized), scores: getScores(normalized), badges: getBadges(normalized), points: getPoints(normalized) };
  }

  function importAll(payload) {
    if (!payload || !payload.user) throw new Error('Invalid backup payload');
    saveUser(payload.user);
    if (payload.progress) saveProgress(payload.user.lrn, payload.progress);
    if (payload.scores) _set(`${NS}scores_${normalizeLRN(payload.user.lrn)}`, payload.scores);
    if (payload.badges) _set(`${NS}badges_${normalizeLRN(payload.user.lrn)}`, payload.badges);
    if (payload.points) mergePoints(payload.user.lrn, payload.points);
    return true;
  }

  function clearAll() {
    Object.keys(localStorage).filter((k) => k.startsWith(NS)).forEach((k) => localStorage.removeItem(k));
  }

  return {
    normalizeLRN,
    getAllUsers, saveUser, getUser, deleteUser,
    setSession, getSession, clearSession, getCurrentUser,
    getProgress, saveProgress, markDayComplete,
    getScores, saveScore, deleteScore, saveActivity,
    getPoints, mergePoints,
    getBadges, awardBadge,
    getDailyPoints, addDailyPoints,
    getAttempts, incrementAttempts,
    lockAssessment, isAssessmentLocked, unlockAssessment,
    exportAll, importAll,
    clearAll
  };
})();
