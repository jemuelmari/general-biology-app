/* ============================================================
   activity-gate.js — Sequential activity locking
   Version: 2.2.1
   ------------------------------------------------------------
   Uses event-driven completion (not just polling) for reliability.
   ============================================================ */

const ActivityGate = (() => {
  'use strict';

  const STORAGE_KEY_PREFIX = 'gba_gate_';
  let session = null;

  /* ---------- Init ---------- */
  function init(config) {
    session = {
      key: `${STORAGE_KEY_PREFIX}${config.subject}_w${config.week}_d${config.day}`,
      states: { 1: 'unlocked', 2: 'locked', formative: 'locked' }
    };

    const saved = sessionStorage.getItem(session.key);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        Object.assign(session.states, parsed);
      } catch (e) { /* ignore */ }
    }

    console.log('[ActivityGate] Session:', session.key, session.states);

    applyLocks();
    setTimeout(applyLocks, 50);
    setTimeout(applyLocks, 300);
    setTimeout(applyLocks, 1000);
    setTimeout(applyLocks, 2000);
  }

  /* ---------- Auto-detect config from page ---------- */
  function autoDetectConfig() {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);

    let subject = null;
    if (path.includes('/biol1/')) subject = 'biol1';
    else if (path.includes('/biol2/')) subject = 'biol2';

    const weekMatch = path.match(/week(\d+)/i);
    const week = weekMatch ? parseInt(weekMatch[1]) : null;
    const day = parseInt(params.get('day') || '0');

    if (subject && week && day) return { subject, week, day };

    const label = document.querySelector('.score-bar-label');
    if (label) {
      const m = label.textContent.match(/Week\s+(\d+)\s*·\s*Day\s+(\d+)/i);
      if (m && subject) return { subject, week: parseInt(m[1]), day: parseInt(m[2]) };
    }

    return null;
  }

  /* ---------- Persist state ---------- */
  function save() {
    if (!session) return;
    sessionStorage.setItem(session.key, JSON.stringify(session.states));
  }

  /* ============================================================
     PUBLIC: mark activity complete
     ============================================================ */
  function complete(activityId) {
    if (!session) {
      console.warn('[ActivityGate] complete() called but session is null');
      return;
    }

    const idStr = String(activityId);
    console.log('[ActivityGate] complete(' + idStr + ')');

    if (idStr === '1') {
      if (session.states[1] === 'completed') return;
      session.states[1] = 'completed';
      session.states[2] = 'unlocked';
      console.log('[ActivityGate] 🔓 Activity 2 unlocked');
      if (window.APP && APP.toast) APP.toast('🔓 Activity 2 unlocked!', 'success', 2500);
    } else if (idStr === '2') {
      if (session.states[2] === 'completed') return;
      session.states[2] = 'completed';
      session.states.formative = 'unlocked';
      console.log('[ActivityGate] 🔓 Formative unlocked');
      if (window.APP && APP.toast) APP.toast('🔓 Formative Check unlocked!', 'success', 2500);
    } else if (idStr === 'formative') {
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
   Auto-init when loaded
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

  if (!tryInit()) {
    document.addEventListener('DOMContentLoaded', tryInit);
    setTimeout(tryInit, 500);
    setTimeout(tryInit, 1500);
  }
})();

/* ============================================================
   Wrap Lesson render functions to detect completion
   ============================================================ */
(function wrapLessonRenderers() {
  if (typeof Lesson === 'undefined') {
    console.warn('[ActivityGate] Lesson engine not found.');
    return;
  }

  /* ---------- MATCH GAME ---------- */
  const originalMatch = Lesson.renderMatchGame.bind(Lesson);
  Lesson.renderMatchGame = function (containerId, config) {
    startMatchWatcher(containerId);
    const result = originalMatch(containerId, config);
    setTimeout(() => ActivityGate.applyLocks(), 50);
    return result;
  };

  function startMatchWatcher(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const activityNumber = containerId === 'activity-1' ? 1
                        : containerId === 'activity-2' ? 2 : null;
    if (!activityNumber) return;

    const observer = new MutationObserver(() => {
      if (isMatchComplete(container)) {
        observer.disconnect();
        console.log('[ActivityGate] Match complete detected (observer)');
        ActivityGate.complete(activityNumber);
      }
    });

    observer.observe(container, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });

    const interval = setInterval(() => {
      if (isMatchComplete(container)) {
        clearInterval(interval);
        observer.disconnect();
        console.log('[ActivityGate] Match complete detected (poll)');
        ActivityGate.complete(activityNumber);
      }
    }, 500);

    setTimeout(() => { clearInterval(interval); observer.disconnect(); }, 30 * 60 * 1000);
  }

  function isMatchComplete(container) {
    const items = container.querySelectorAll('.match-item');
    if (!items.length) return false;
    const correct = container.querySelectorAll('.match-item.correct').length;
    const pairs = items.length / 2;
    return correct >= pairs * 2;
  }

  /* ---------- SCENARIO GAME ---------- */
  const originalScenario = Lesson.renderScenarioGame.bind(Lesson);
  Lesson.renderScenarioGame = function (containerId, config) {
    startScenarioWatcher(containerId, config);
    const result = originalScenario(containerId, config);
    setTimeout(() => ActivityGate.applyLocks(), 50);
    return result;
  };

  function startScenarioWatcher(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const activityNumber = containerId === 'activity-1' ? 1
                        : containerId === 'activity-2' ? 2 : null;
    if (!activityNumber) return;

    const totalScenarios = (config && config.scenarios) ? config.scenarios.length : 6;

    const observer = new MutationObserver(() => {
      if (isScenarioComplete(container, totalScenarios)) {
        observer.disconnect();
        console.log('[ActivityGate] Scenario complete detected');
        ActivityGate.complete(activityNumber);
      }
    });

    observer.observe(container, { subtree: true, childList: true, characterData: true });

    const interval = setInterval(() => {
      if (isScenarioComplete(container, totalScenarios)) {
        clearInterval(interval);
        observer.disconnect();
        console.log('[ActivityGate] Scenario complete detected (poll)');
        ActivityGate.complete(activityNumber);
      }
    }, 500);

    setTimeout(() => { clearInterval(interval); observer.disconnect(); }, 30 * 60 * 1000);
  }

  function isScenarioComplete(container, total) {
    const hasChoiceRow = !!container.querySelector('.choice-row');
    const hasCard = !!container.querySelector('.scenario-card');
    if (hasChoiceRow || hasCard) return false;
    return container.innerHTML.trim().length > 0;
  }

  /* ---------- ESCAPE ROOM ---------- */
  const originalEscape = Lesson.renderEscapeRoom.bind(Lesson);
  Lesson.renderEscapeRoom = function (containerId, config) {
    startEscapeWatcher(containerId);
    const result = originalEscape(containerId, config);
    setTimeout(() => ActivityGate.applyLocks(), 50);
    return result;
  };

  function startEscapeWatcher(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const observer = new MutationObserver(() => {
      if (isEscapeComplete(container)) {
        observer.disconnect();
        ActivityGate.complete('formative');
      }
    });

    observer.observe(container, { subtree: true, childList: true, characterData: true });

    const interval = setInterval(() => {
      if (isEscapeComplete(container)) {
        clearInterval(interval);
        observer.disconnect();
        ActivityGate.complete('formative');
      }
    }, 500);

    setTimeout(() => { clearInterval(interval); observer.disconnect(); }, 30 * 60 * 1000);
  }

  function isEscapeComplete(container) {
    const title = container.querySelector('.result-title');
    if (!title) return false;
    return title.textContent.toLowerCase().includes('escaped');
  }

  console.log('[ActivityGate] Renderers wrapped (event-based).');
})();
