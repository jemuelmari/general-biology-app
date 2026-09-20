/* ============================================================
   teacher-auth.js — Password gate for teacher/gradebook pages
   Version: 1.0.1
   ------------------------------------------------------------
   Includes auto-guard on teacher pages. Works from root or /teacher/.
   ============================================================ */

const TeacherAuth = (() => {
  'use strict';

  const SESSION_KEY = 'gba_teacher_session';
  const ATTEMPTS_KEY = 'gba_teacher_attempts';
  const LOCKOUT_KEY = 'gba_teacher_lockout';

  /* ---------- Hash helper (SHA-256) ---------- */
  async function hash(text) {
    const enc = new TextEncoder();
    const data = enc.encode(text);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /* ---------- Session ---------- */
  function isLoggedIn() {
    const s = sessionStorage.getItem(SESSION_KEY);
    if (!s) return false;
    try {
      const data = JSON.parse(s);
      if (Date.now() - data.lastActivity > CONFIG.TEACHER_SESSION_TIMEOUT) {
        sessionStorage.removeItem(SESSION_KEY);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  function login() {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      loggedInAt: Date.now(),
      lastActivity: Date.now()
    }));
    sessionStorage.removeItem(ATTEMPTS_KEY);
    sessionStorage.removeItem(LOCKOUT_KEY);
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.replace(getRootPath() + 'teacher-login.html');
  }

  function touch() {
    if (!isLoggedIn()) return;
    const data = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    data.lastActivity = Date.now();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  }

  /* ---------- Attempts & Lockout ---------- */
  function getAttempts() {
    return parseInt(sessionStorage.getItem(ATTEMPTS_KEY) || '0', 10);
  }

  function isLockedOut() {
    const until = parseInt(sessionStorage.getItem(LOCKOUT_KEY) || '0', 10);
    return until > Date.now();
  }

  function lockoutRemaining() {
    const until = parseInt(sessionStorage.getItem(LOCKOUT_KEY) || '0', 10);
    return Math.max(0, until - Date.now());
  }

  function recordFailedAttempt() {
    const attempts = getAttempts() + 1;
    sessionStorage.setItem(ATTEMPTS_KEY, attempts);
    if (attempts >= CONFIG.TEACHER_MAX_ATTEMPTS) {
      sessionStorage.setItem(LOCKOUT_KEY, Date.now() + CONFIG.TEACHER_LOCKOUT_TIME);
    }
    return attempts;
  }

  /* ---------- Verify password ---------- */
  async function verify(password) {
    const h = await hash(password);
    return h === CONFIG.TEACHER_PASSWORD_HASH;
  }

  /* ---------- Root path detection ---------- */
  function getRootPath() {
    const path = window.location.pathname;
    if (path.includes('/teacher/') || path.includes('/classrecord/')) {
      return '../';
    }
    return '';
  }

  /* ---------- Guard ---------- */
  function guard() {
    if (!isLoggedIn()) {
      const here = window.location.pathname + window.location.search;
      sessionStorage.setItem('gba_teacher_return', here);
      window.location.replace(getRootPath() + 'teacher-login.html');
      return false;
    }
    return true;
  }

  /* ---------- Public API ---------- */
  return {
    hash, verify, guard,
    isLoggedIn, login, logout, touch,
    getAttempts, isLockedOut, lockoutRemaining, recordFailedAttempt
  };
})();

/* ---------- Auto-guard on load (skips login page + student pages) ---------- */
(function autoGuard() {
  const filename = window.location.pathname.split('/').pop();
  const path = window.location.pathname;

  // Skip the login page — otherwise infinite redirect loop
  if (filename === 'teacher-login.html') return;

  // Only guard teacher/classrecord pages
  const isTeacherPage =
    filename === 'instructor.html' ||
    filename === 'classrecord.html' ||
    path.includes('/teacher/') ||
    path.includes('/classrecord/');

  if (!isTeacherPage) return;

  document.addEventListener('DOMContentLoaded', () => {
    if (!TeacherAuth.guard()) return;
    ['click', 'keydown', 'mousemove', 'scroll'].forEach((evt) => {
      document.addEventListener(evt, TeacherAuth.touch, { passive: true });
    });
  });
})();
