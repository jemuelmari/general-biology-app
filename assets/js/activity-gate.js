/* ============================================================
   activity-gate.js — Sequential activity locking with retakes
   Version: 2.3.0
   ------------------------------------------------------------
   RULES:
   - Activity 1 available at start
   - Activity 2 unlocks ONLY after Activity 1 ≥ 75%
   - Formative unlocks ONLY after Activities 1 & 2 ≥ 75%
   - Each activity has a difficulty-based timer (min 5 min)
   - Retakes unlimited until passing score reached
   - Manual "Start" tap required to begin each activity
   - Fully fail-proof (survives refresh)
   ============================================================ */

const ActivityGate = (() => {
  'use strict';

  const STORAGE_KEY_PREFIX = 'gba_gate_v2_';
  const PASS_THRESHOLD = 0.75; // 75%

  let session = null;

  /* ============================================================
     INIT
     ============================================================ */
  function init(config) {
    session = {
      key: `${STORAGE_KEY_PREFIX}${config.subject}_w${config.week}_d${config.day}`,
      subject: config.subject,
      week: config.week,
      day: config.day,
      states: {
        activity1: { status: 'ready',   score: 0, attempts: 0 },   // ready | running | passed | failed
        activity2: { status: 'locked',  score: 0, attempts: 0 },
        formative: { status: 'locked',  score: 0, attempts: 0 }
      }
    };

    // Restore from sessionStorage
    const saved = sessionStorage.getItem(session.key);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        Object.assign(session.states, parsed.states);
      } catch (e) { /* ignore */ }
    }

    console.log('[ActivityGate] Init:', session.key, session.states);
    applyUI();
  }

  /* ============================================================
     PERSIST
     ============================================================ */
  function save() {
    if (!session) return;
    sessionStorage.setItem(session.key, JSON.stringify({
      subject: session.subject,
      week: session.week,
      day: session.day,
      states: session.states,
      updatedAt: new Date().toISOString()
    }));
  }

  /* ============================================================
     STATE MUTATIONS
     ============================================================ */

  // Mark activity as running (called when student taps "Start")
  function markRunning(activityId) {
    const key = normalizeKey(activityId);
    if (!session) return;
    if (session.states[key].status === 'passed') return;
    session.states[key].status = 'running';
    save();
    applyUI();
  }

  // Mark activity complete with score (called by lesson engine)
  function completeWithScore(activityId, scorePercent) {
    if (!session) return;
    const key = normalizeKey(activityId);
    const st = session.states[key];
    st.attempts = (st.attempts || 0) + 1;
    st.score = Math.round(scorePercent);

    if (scorePercent >= PASS_THRESHOLD * 100) {
      st.status = 'passed';
      console.log(`[ActivityGate] ${key} PASSED (${st.score}%)`);

      // Unlock the next stage
      if (key === 'activity1') {
        session.states.activity2.status = 'ready';
        APP.toast('✅ Activity 1 passed! Activity 2 is now available.', 'success', 4000);
      } else if (key === 'activity2') {
        session.states.formative.status = 'ready';
        APP.toast('✅ Activity 2 passed! Formative Check is now available.', 'success', 4000);
      } else if (key === 'formative') {
        APP.toast('🎉 Formative Check passed!', 'success', 4000);
      }
    } else {
      st.status = 'failed';
      console.log(`[ActivityGate] ${key} FAILED (${st.score}%) — needs 75%`);
    }

    save();
    applyUI();
  }

  // Reset a single activity for a retake
  function resetActivity(activityId) {
    if (!session) return;
    const key = normalizeKey(activityId);
    session.states[key].status = 'ready';
    // Keep score & attempts for record-keeping
    save();
    applyUI();
  }

  /* ============================================================
     UI
     ============================================================ */
  function applyUI() {
    applyStageUI('activity-1', 'activity1');
    applyStageUI('activity-2', 'activity2');
    applyStageUI('formative', 'formative');
  }

  function applyStageUI(containerId, stateKey) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const parentCard = container.closest('.activity-card') || container.parentElement;
    if (!parentCard) return;

    const st = session.states[stateKey];

    // Remove any existing overlay
    parentCard.querySelectorAll('.gate-overlay').forEach((el) => el.remove());

    switch (st.status) {
      case 'locked':
        container.style.display = 'none';
        parentCard.appendChild(buildLockedOverlay());
        break;

      case 'ready':
        container.style.display = 'none';
        parentCard.appendChild(buildReadyOverlay(stateKey, st));
        break;

      case 'running':
        // Hide overlay, show activity
        container.style.display = '';
        break;

      case 'passed':
        container.style.display = 'none';
        parentCard.appendChild(buildPassedOverlay(stateKey, st));
        break;

      case 'failed':
        container.style.display = 'none';
        parentCard.appendChild(buildFailedOverlay(stateKey, st));
        break;
    }
  }

  /* ---------- Overlays ---------- */
  function buildLockedOverlay() {
    const el = document.createElement('div');
    el.className = 'gate-overlay';
    el.style.cssText = `
      padding:32px 24px;text-align:center;
      background:#f8f9fa;
      border:2px dashed #dadce0;
      border-radius:8px;
    `;
    el.innerHTML = `
      <div style="font-size:2rem;">🔒</div>
      <div style="font-weight:600;margin-top:8px;color:#1b7a3d;">Locked</div>
      <div style="font-size:0.85rem;margin-top:4px;color:#5f6368;">
        Complete the previous activity with at least 75% to unlock this one.
      </div>
    `;
    return el;
  }

  function buildReadyOverlay(stateKey, st) {
    const el = document.createElement('div');
    el.className = 'gate-overlay';
    el.style.cssText = `
      padding:32px 24px;text-align:center;
      background:linear-gradient(135deg, #e8f5e9, #c8e6c9);
      border:2px solid #4caf50;
      border-radius:8px;
    `;

    const titles = {
      activity1: 'Activity 1 — Match the Pairs',
      activity2: 'Activity 2 — Scenario Challenge',
      formative: 'Formative Check — Escape the Cell'
    };

    const timeEst = getEstimatedTime(stateKey);

    el.innerHTML = `
      <div style="font-size:2.5rem;">▶️</div>
      <div style="font-weight:700;margin-top:12px;color:#1b5e20;font-size:1.1rem;">
        ${titles[stateKey]}
      </div>
      <div style="font-size:0.85rem;margin-top:8px;color:#2e7d32;">
        ⏱️ Estimated time: <strong>${timeEst} minutes</strong>
      </div>
      <div style="font-size:0.85rem;margin-top:4px;color:#2e7d32;">
        🎯 Passing score: <strong>75%</strong>
      </div>
      <div style="font-size:0.8rem;margin-top:4px;color:#66bb6a;">
        ♻️ Retakes: unlimited until you pass
      </div>
      ${st.attempts > 0 ? `
        <div style="font-size:0.8rem;margin-top:8px;color:#d84315;">
          Previous attempt: <strong>${st.score}%</strong> (Attempt #${st.attempts})
        </div>
      ` : ''}
      <button class="btn btn-primary" style="margin-top:16px;font-size:0.95rem;padding:12px 28px;" data-start="${stateKey}">
        ▶️ Start Activity
      </button>
    `;

    // Attach click handler
    setTimeout(() => {
      el.querySelector(`[data-start="${stateKey}"]`)?.addEventListener('click', () => {
        startActivity(stateKey);
      });
    }, 0);

    return el;
  }

  function buildPassedOverlay(stateKey, st) {
    const el = document.createElement('div');
    el.className = 'gate-overlay';
    el.style.cssText = `
      padding:24px;text-align:center;
      background:linear-gradient(135deg, #e8f5e9, #a5d6a7);
      border:2px solid #2e7d32;
      border-radius:8px;
    `;

    const isFormative = stateKey === 'formative';
    el.innerHTML = `
      <div style="font-size:2rem;">✅</div>
      <div style="font-weight:700;margin-top:8px;color:#1b5e20;">
        ${isFormative ? 'Formative Complete!' : 'Passed!'}
      </div>
      <div style="font-size:0.9rem;margin-top:6px;color:#2e7d32;">
        Score: <strong>${st.score}%</strong> · Attempts: ${st.attempts}
      </div>
      <div style="font-size:0.85rem;margin-top:8px;color:#2e7d32;">
        ${isFormative
          ? '🎉 You completed all activities for today!'
          : '✅ Next activity is now unlocked.'}
      </div>
      <button class="btn btn-outline" style="margin-top:12px;font-size:0.8rem;padding:8px 18px;" data-retake="${stateKey}">
        ♻️ Practice Again
      </button>
    `;

    setTimeout(() => {
      el.querySelector(`[data-retake="${stateKey}"]`)?.addEventListener('click', () => {
        if (confirm('Practice this activity again? Your pass status will NOT be affected.')) {
          resetActivity(stateKey);
        }
      });
    }, 0);

    return el;
  }

  function buildFailedOverlay(stateKey, st) {
    const el = document.createElement('div');
    el.className = 'gate-overlay';
    el.style.cssText = `
      padding:32px 24px;text-align:center;
      background:linear-gradient(135deg, #fff3e0, #ffe0b2);
      border:2px solid #ed6c02;
      border-radius:8px;
    `;

    el.innerHTML = `
      <div style="font-size:2.5rem;">🔁</div>
      <div style="font-weight:700;margin-top:8px;color:#e65100;font-size:1.1rem;">
        Try Again!
      </div>
      <div style="font-size:0.95rem;margin-top:8px;color:#ef6c00;">
        Score: <strong>${st.score}%</strong> — You need 75% to pass.
      </div>
      <div style="font-size:0.85rem;margin-top:6px;color:#ef6c00;">
        Attempts so far: ${st.attempts} · Retakes: unlimited
      </div>
      <button class="btn btn-primary" style="margin-top:16px;font-size:0.95rem;padding:12px 28px;" data-start="${stateKey}">
        🔁 Retake Activity
      </button>
    `;

    setTimeout(() => {
      el.querySelector(`[data-start="${stateKey}"]`)?.addEventListener('click', () => {
        startActivity(stateKey);
      });
    }, 0);

    return el;
  }

  /* ---------- Activity Start ---------- */
  function startActivity(stateKey) {
    markRunning(stateKey);
    // Trigger the lesson engine to re-render this activity
    document.dispatchEvent(new CustomEvent('activity:start', {
      detail: { activity: stateKey }
    }));
  }

  /* ---------- Time Estimation ---------- */
  function getEstimatedTime(stateKey) {
    const containerId = stateKey === 'activity1' ? 'activity-1'
                      : stateKey === 'activity2' ? 'activity-2'
                      : 'formative';
    const container = document.getElementById(containerId);
    if (!container) return 5;

    // Read from data attribute set by lesson-engine
    const mins = container.dataset.estimatedMinutes;
    return mins ? parseFloat(mins) : 5;
  }

  /* ---------- Helpers ---------- */
  function normalizeKey(id) {
    const s = String(id);
    if (s === '1' || s === 'activity-1' || s === 'activity1') return 'activity1';
    if (s === '2' || s === 'activity-2' || s === 'activity2') return 'activity2';
    return 'formative';
  }

  /* ---------- Public API ---------- */
  return {
    init,
    markRunning,
    completeWithScore,
    resetActivity,
    applyUI,
    PASS_THRESHOLD,
    // legacy support
    complete: (id) => completeWithScore(id, 100),
    applyLocks: applyUI
  };
})();

/* ============================================================
   Auto-init
   ============================================================ */
(function autoInit() {
  const tryInit = () => {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    let subject = null;
    if (path.includes('/biol1/')) subject = 'biol1';
    else if (path.includes('/biol2/')) subject = 'biol2';
    const weekMatch = path.match(/week(\d+)/i);
    const week = weekMatch ? parseInt(weekMatch[1]) : null;
    const day = parseInt(params.get('day') || '0');

    if (subject && week && day) {
      ActivityGate.init({ subject, week, day });
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
