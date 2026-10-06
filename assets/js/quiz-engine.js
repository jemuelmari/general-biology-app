/* ============================================================
   quiz-engine.js — Quiz / ST / TE engine with anti-cheat
   Version: 1.0.5
   ------------------------------------------------------------
   v1.0.5:
   - On submit, push the lock to the backend when the attempt
     is locked (i.e., failed and can't be retaken).
   ============================================================ */

const QuizEngine = (() => {
  'use strict';

  let state = null;

  async function init(config) {
    // ... [unchanged from v1.0.4] ...
  }

  // ... [setupAntiCheat, renderHeader, renderQuestion, etc. unchanged] ...

  function submit(autoSubmitted) {
    if (state.submitted) return;
    state.submitted = true;

    let correct = 0;
    const breakdown = [];
    state.items.forEach((q) => {
      const given = state.answers[q.id];
      const correctOpt = q.options.find((o) => o.correct);
      const isCorrect = given === correctOpt?.key;
      if (isCorrect) correct++;
      breakdown.push({ id: q.id, competency: q.competency, given, correct: correctOpt?.key, isCorrect });
    });

    const total = state.items.length;
    const percent = Math.round((correct / total) * 100);
    const passed = percent >= state.passingScore;
    const typeKey = state.type === 'quiz' ? 'quizzes' : state.type;

    const scoreData = {
      score: correct, total, percent, passed, autoSubmitted,
      tabViolations: state.tabViolations, breakdown,
      durationSec: Math.floor((Date.now() - state.startTime) / 1000)
    };

    // 1. Save score locally
    Store.saveScore(state.lrn, state.subject, typeKey, state.assessmentId, scoreData);

    // 2. Auto-push score to backend
    if (window.Sync && typeof Sync.pushScoreToBackend === 'function') {
      Sync.pushScoreToBackend(state.lrn, state.subject, typeKey, state.assessmentId, scoreData)
        .catch((err) => console.warn('[AutoPush] Score push failed:', err));
    }

    // 3. Lock the assessment and push the lock to the backend
    if (!state.allowRetake) {
      const lockData = { score: correct, total, percent };
      Store.lockAssessment(state.lrn, state.assessmentId, lockData);

      // NEW: Also push the lock to the backend
      if (window.Sync && typeof Sync.pushLock === 'function') {
        const fullLockData = { ...lockData, reason: 'failed-attempt', lockedAt: new Date().toISOString() };
        Sync.pushLock(state.lrn, state.assessmentId, fullLockData)
          .catch((err) => console.warn('[AutoPush] Lock push failed:', err));
      }
    }

    // ... [rest of remediation trigger and renderResult unchanged] ...
    if (state.type === 'st' && percent < 80) {
      const u = Store.getUser(state.lrn) || {};
      u.remediationUnlocked = true;
      u.remediationTrigger = state.assessmentId;
      u.remediationCompetencies = breakdown.filter((b) => !b.isCorrect).map((b) => b.competency);
      Store.saveUser(u);
    }

    renderResult({ correct, total, percent, passed, autoSubmitted });
  }

  // ... [renderResult, renderLocked unchanged] ...
  return { init };
})();
