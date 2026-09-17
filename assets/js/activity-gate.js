/* ============================================================
   activity-gate.js — Sequential activity locking
   Version: 1.3.0
   ------------------------------------------------------------
   Ensures that Activity 2 does not start until Activity 1 is
   complete, and that the Formative Check is not available
   until Activity 2 is complete.

   Load this AFTER lesson-engine.js.
   ============================================================ */

const ActivityGate = (() => {
  'use strict';

  const STORAGE_KEY_PREFIX = 'gba_gate_';

  /* ---------- Session state ---------- */
  let session = null;

  /* ---------- Init ---------- */
  function init(config) {
    session = {
      key: `${STORAGE_KEY_PREFIX}${config.subject}_w${config.week}_d${config.day}`,
      states: { 1: 'locked', 2: 'locked', formative: 'locked' }
    };

    // Activity 1 is always unlocked at start
    session.states[1] = 'unlocked';

    // Restore from sessionStorage if re-entering the page
    const saved = sessionStorage.getItem(session.key);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        Object.assign(session.states, parsed);
      } catch (e) { /* ignore */ }
    }

    renderLocks();
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
      session.states[1] = 'completed';
      session.states[2] = 'unlocked';
    } else if (activityId === 2 || activityId === '2') {
      session.states[2] = 'completed';
      session.states.formative = 'unlocked';
    } else if (activityId === 'formative') {
      session.states.formative = 'completed';
    }

    save();
    renderLocks();
    APP.toast('🔓 Next activity unlocked!', 'success', 2000);
  }

  /* ---------- Render lock overlays ---------- */
  function renderLocks() {
    if (!session) return;

    // Activity 1
    applyLock('activity-1', session.states[1]);
    // Activity 2
    applyLock('activity-2', session.states[2]);
    // Formative
    applyLock('formative', session.states.formative);
  }

  function applyLock(containerId, state) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const parentCard = container.closest('.activity-card') || container.parentElement;

    if (state === 'locked') {
      // Hide the activity content, show a "locked" placeholder
      container.style.display = 'none';

      let lockMsg = parentCard.querySelector('.gate-lock-msg');
      if (!lockMsg) {
        lockMsg = document.createElement('div');
        lockMsg.className = 'gate-lock-msg';
        lockMsg.style.cssText = `
          padding:32px 24px;text-align:center;
          background:var(--color-bg);
          border:2px dashed var(--color-border);
          border-radius:var(--radius-md);
          color:var(--color-text-muted);
        `;
        lockMsg.innerHTML = `
          <div style="font-size:2rem;">🔒</div>
          <div style="font-weight:600;margin-top:8px;">Locked</div>
          <div style="font-size:0.85rem;margin-top:4px;">
            Complete the previous activity to unlock this one.
          </div>
        `;
        parentCard.appendChild(lockMsg);
      }
      lockMsg.style.display = 'block';
    } else {
      // Show the activity content
      container.style.display = '';
      const lockMsg = parentCard.querySelector('.gate-lock-msg');
      if (lockMsg) lockMsg.style.display = 'none';
    }
  }

  /* ---------- Reset (for retakes) ---------- */
  function reset() {
    if (!session) return;
    sessionStorage.removeItem(session.key);
    session.states = { 1: 'unlocked', 2: 'locked', formative: 'locked' };
    renderLocks();
  }

  /* ---------- Public API ---------- */
  return { init, complete, reset, renderLocks };
})();

/* ============================================================
   Auto-wrap Lesson.render* functions to trigger completion.
   This runs after lesson-engine.js is loaded.
   ============================================================ */
(function wrapLessonRenderers() {
  if (typeof Lesson === 'undefined') {
    console.warn('[ActivityGate] Lesson engine not found — gate disabled.');
    return;
  }

  /* ---------- Wrap renderMatchGame (Activity 1 by default) ---------- */
  const originalMatch = Lesson.renderMatchGame.bind(Lesson);
  Lesson.renderMatchGame = function (containerId, config) {
    const originalAward = (typeof Lesson.awardBadge === 'function')
      ? Lesson.awardBadge
      : null;

    // Hook into badge awarding as a completion signal
    wrapCompletionSignal(containerId, config.badgeId, 'match', config);

    return originalMatch(containerId, config);
  };

  /* ---------- Wrap renderScenarioGame (Activity 2 by default) ---------- */
  const originalScenario = Lesson.renderScenarioGame.bind(Lesson);
  Lesson.renderScenarioGame = function (containerId, config) {
    wrapCompletionSignal(containerId, config.badgeId, 'scenario', config);
    return originalScenario(containerId, config);
  };

  /* ---------- Wrap renderEscapeRoom (Formative) ---------- */
  const originalEscape = Lesson.renderEscapeRoom.bind(Lesson);
  Lesson.renderEscapeRoom = function (containerId, config) {
    wrapCompletionSignal(containerId, config.badgeId, 'escape', config);
    return originalEscape(containerId, config);
  };

  /* ---------- Helper: detect completion and notify gate ---------- */
  function wrapCompletionSignal(containerId, badgeId, type, config) {
    // Completion detection strategy:
    // - Activity 1 (match): all pairs matched → easy to detect via DOM
    // - Activity 2 (scenario): all cards shown → easy to detect via DOM
    // - Formative (escape): victory screen shown → detectable via DOM

    const container = document.getElementById(containerId);
    if (!container) return;

    // Map containerId → activity number
    const activityNumber = containerId === 'activity-1' ? 1
                        : containerId === 'activity-2' ? 2
                        : containerId === 'formative' ? 'formative'
                        : null;

    if (!activityNumber) return;

    // Poll for completion markers in the DOM
    const checkInterval = setInterval(() => {
      if (isComplete(container, type, config)) {
        clearInterval(checkInterval);
        if (window.ActivityGate) ActivityGate.complete(activityNumber);
      }
    }, 800);

    // Stop polling after 15 minutes to avoid leaks
    setTimeout(() => clearInterval(checkInterval), 15 * 60 * 1000);
  }

  /* ---------- Detect completion from the DOM ---------- */
  function isComplete(container, type, config) {
    if (type === 'match') {
      // Match complete when all .match-item have .correct
      const items = container.querySelectorAll('.match-item');
      if (!items.length) return false;
      const correct = container.querySelectorAll('.match-item.correct').length;
      // Each pair produces 2 correct items (one on each side)
      const pairs = items.length / 2;
      return correct >= pairs * 2;
    }

    if (type === 'scenario') {
      // Scenario complete when no more cards to render
      // Detect by absence of active card after last answer
      const activeCard = container.querySelector('.scenario-card');
      if (activeCard) return false;
      // Also require that at least one card was answered (some activity data exists)
      return container.innerHTML.trim().length > 0 &&
             !container.querySelector('.choice-row');
    }

    if (type === 'escape') {
      // Escape room complete when victory screen shows
      const title = container.querySelector('.result-title');
      if (!title) return false;
      return title.textContent.includes('You escaped') ||
             title.textContent.includes('escaped');
    }

    return false;
  }

  console.log('[ActivityGate] Lesson renderers wrapped — sequencing enabled.');
})();
