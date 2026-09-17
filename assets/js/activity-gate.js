/* ============================================================
   activity-gate.js — Sequential activity locking
   Version: 1.4.2
   ------------------------------------------------------------
   Ensures that Activity 2 does not start until Activity 1 is
   complete, and that the Formative Check is not available
   until Activity 2 is complete.

   Auto-initializes itself when loaded on a lesson page.
   ============================================================ */

const ActivityGate = (() => {
  'use strict';

  const STORAGE_KEY_PREFIX = 'gba_gate_';

  let session = null;

  /* ---------- Init with config ---------- */
  function init(config) {
    session = {
      key: `${STORAGE_KEY_PREFIX}${config.subject}_w${config.week}_d${config.day}`,
      states: { 1: 'unlocked', 2: 'locked', formative: 'locked' }
    };

    // Restore from sessionStorage if re-entering the page
    const saved = sessionStorage.getItem(session.key);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        Object.assign(session.states, parsed);
      } catch (e) { /* ignore */ }
    }

    // Apply locks immediately AND on a slight delay (in case activities render late)
    applyLocks();
    setTimeout(applyLocks, 50);
    setTimeout(applyLocks, 300);
    setTimeout(applyLocks, 1000);
    setTimeout(applyLocks, 2000);

    console.log('[ActivityGate] Initialized:', session.key, session.states);
  }

  /* ---------- Auto-detect config from page ---------- */
  function autoDetectConfig() {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);

    // Detect subject from path
    let subject = null;
    if (path.includes('/biol1/')) subject = 'biol1';
    else if (path.includes('/biol2/')) subject = 'biol2';

    // Detect week from path (e.g., /week1/, /week2/)
    const weekMatch = path.match(/week(\d+)/i);
    const week = weekMatch ? parseInt(weekMatch[1]) : null;

    // Detect day from query (?day=N)
    const day = parseInt(params.get('day') || '0');

    if (subject && week && day) {
      return { subject, week, day };
    }

    // Fallback: read from the score bar (Week X · Day Y)
    const label = document.querySelector('.score-bar-label');
    if (label) {
      const m = label.textContent.match(/Week\s+(\d+)\s*·\s*Day\s+(\d+)/i);
      if (m && subject) {
        return { subject, week: parseInt(m[1]), day: parseInt(m[2]) };
      }
    }

    return null;
  }

  /* ---------- Persist state ---------- */
  function save() {
    if (!session) return;
    sessionStorage.setItem(session.key, JSON.stringify(session.states));
  }

  /* ---------- Public: mark activity complete ---------- */
  function complete(activityId) {
    if (!session) return;

    if (activityId === 1 || activityId === '1') {
      if (session.states[1] === 'completed') return;
      session.states[1] = 'completed';
      session.states[2] = 'unlocked';
      if (window.APP) APP.toast('🔓 Activity 2 unlocked!', 'success', 2500);
    } else if (activityId === 2 || activityId === '2') {
      if (session.states[2] === 'completed') return;
      session.states[2] = 'completed';
      session.states.formative = 'unlocked';
      if (window.APP) APP.toast('🔓 Formative Check unlocked!', 'success', 2500);
    } else if (activityId === 'formative') {
      session.states.formative = 'completed';
    }

    save();
    applyLocks();
  }

  /* ---------- Apply lock overlays ---------- */
  function applyLocks() {
    if (!session) return;
    applyLock('activity-1', session.states[1]);
    applyLock('activity-2', session.states[2]);
    applyLock('formative', session.states.formative);
  }

  function applyLock(containerId, state) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const parentCard = container.closest('.activity-card') || container.parentElement;
    if (!parentCard) return;

    if (state === 'locked') {
      container.style.display = 'none';

      let lockMsg = parentCard.querySelector('.gate-lock-msg');
      if (!lockMsg) {
        lockMsg = document.createElement('div');
        lockMsg.className = 'gate-lock-msg';
        lockMsg.style.cssText = `
          padding:32px 24px;text-align:center;
          background:#f8f9fa;
          border:2px dashed #dadce0;
          border-radius:8px;
          color:#5f6368;
        `;
        lockMsg.innerHTML = `
          <div style="font-size:2rem;">🔒</div>
          <div style="font-weight:600;margin-top:8px;color:#1b7a3d;">Locked</div>
          <div style="font-size:0.85rem;margin-top:4px;">
            Complete the previous activity to unlock this one.
          </div>
        `;
        parentCard.appendChild(lockMsg);
      }
      lockMsg.style.display = 'block';
    } else {
      container.style.display = '';
      const lockMsg = parentCard.querySelector('.gate-lock-msg');
      if (lockMsg) lockMsg.style.display = 'none';
    }
  }

  /* ---------- Reset ---------- */
  function reset() {
    if (!session) return;
    sessionStorage.removeItem(session.key);
    session.states = { 1: 'unlocked', 2: 'locked', formative: 'locked' };
    applyLocks();
  }

  /* ---------- Public API ---------- */
  return { init, complete, reset, applyLocks, autoDetectConfig };
})();

/* ============================================================
   Auto-initialize when loaded on a lesson page
   ============================================================ */
(function autoInit() {
  const tryInit = () => {
    const config = ActivityGate.autoDetectConfig();
    if (config) {
      ActivityGate.init(config);
      return true;
    }
    return false;
  };

  // Try immediately
  if (!tryInit()) {
    // If page isn't ready yet, retry on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', tryInit);
    // And one more retry after activities render
    setTimeout(tryInit, 500);
    setTimeout(tryInit, 1500);
  }
})();

/* ============================================================
   Wrap Lesson render functions to detect completion.
   ============================================================ */
(function wrapLessonRenderers() {
  if (typeof Lesson === 'undefined') {
    console.warn('[ActivityGate] Lesson engine not found.');
    return;
  }

  const originalMatch = Lesson.renderMatchGame.bind(Lesson);
  Lesson.renderMatchGame = function (containerId, config) {
    startCompletionWatch(containerId, 'match', config);
    const result = originalMatch(containerId, config);
    setTimeout(() => ActivityGate.applyLocks(), 50);
    return result;
  };

  const originalScenario = Lesson.renderScenarioGame.bind(Lesson);
  Lesson.renderScenarioGame = function (containerId, config) {
    startCompletionWatch(containerId, 'scenario', config);
    const result = originalScenario(containerId, config);
    setTimeout(() => ActivityGate.applyLocks(), 50);
    return result;
  };

  const originalEscape = Lesson.renderEscapeRoom.bind(Lesson);
  Lesson.renderEscapeRoom = function (containerId, config) {
    startCompletionWatch(containerId, 'escape', config);
    const result = originalEscape(containerId, config);
    setTimeout(() => ActivityGate.applyLocks(), 50);
    return result;
  };

  /* ---------- Completion watcher ---------- */
  function startCompletionWatch(containerId, type, config) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const activityNumber = containerId === 'activity-1' ? 1
                        : containerId === 'activity-2' ? 2
                        : containerId === 'formative' ? 'formative'
                        : null;
    if (!activityNumber) return;

    const checkInterval = setInterval(() => {
      if (isComplete(container, type)) {
        clearInterval(checkInterval);
        if (window.ActivityGate) ActivityGate.complete(activityNumber);
      }
    }, 600);

    setTimeout(() => clearInterval(checkInterval), 20 * 60 * 1000);
  }

  function isComplete(container, type) {
    if (type === 'match') {
      const items = container.querySelectorAll('.match-item');
      if (!items.length) return false;
      const correct = container.querySelectorAll('.match-item.correct').length;
      const pairs = items.length / 2;
      return correct >= pairs * 2;
    }

    if (type === 'scenario') {
      const hasChoiceRow = !!container.querySelector('.choice-row');
      const hasContent = container.innerHTML.trim().length > 0;
      const hasBadgeInfo = container.querySelector('.badge') !== null;
      return hasContent && !hasChoiceRow && hasBadgeInfo;
    }

    if (type === 'escape') {
      const title = container.querySelector('.result-title');
      if (!title) return false;
      return title.textContent.toLowerCase().includes('escaped');
    }

    return false;
  }

  console.log('[ActivityGate] Renderers wrapped.');
})();
