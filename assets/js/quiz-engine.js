/* ============================================================
   quiz-engine.js — Quiz / ST / TE engine with anti-cheat
   Version: 1.0.0
   ============================================================ */

const QuizEngine = (() => {
  'use strict';

  let state = null;

  /* ---------- Init ---------- */
  function init(config) {
    const user = Store.getCurrentUser();
    if (!user) {
      window.location.href = '../../student/login.html';
      return;
    }

    const {
      assessmentId,
      subject,
      type,        // 'quiz' | 'st' | 'te'
      title,
      items,       // array of question objects
      timeLimit,   // seconds
      allowRetake  = false,
      passingScore = 80
    } = config;

    // Check if already locked
    if (!allowRetake && Store.isAssessmentLocked(user.lrn, assessmentId)) {
      renderLocked();
      return;
    }

    state = {
      lrn: user.lrn,
      assessmentId,
      subject,
      type,
      title,
      items: Security.shuffleQuestions(items),
      answers: {},
      currentIndex: 0,
      startTime: Date.now(),
      timeLimit,
      submitted: false,
      tabViolations: 0,
      tabThreshold: 3,
      passingScore,
      allowRetake
    };

    setupAntiCheat();
    renderHeader();
    renderQuestion();
    startTimer();
    renderNavigation();
  }

  /* ---------- Anti-cheat Setup ---------- */
  function setupAntiCheat() {
    // Copy/paste disable
    Security.disableCopyPaste(document);
    Security.disableDevShortcuts();

    // Tab switch monitoring
    Security.startTabMonitor((count, final) => {
      state.tabViolations = count;
      if (final) {
        APP.toast('Too many tab switches. Quiz submitted automatically.', 'danger', 5000);
        submit(true);
      } else {
        APP.toast(`⚠️ Tab switch detected (${count}/${state.tabThreshold}). Stay on this page.`, 'warning', 3000);
      }
    }, state.tabThreshold);
  }

  /* ---------- Render Header ---------- */
  function renderHeader() {
    const header = document.getElementById('quiz-header');
    if (!header) return;

    header.innerHTML = `
      <div class="daily-score-bar">
        <div class="score-bar-left">
          <span class="score-bar-label">${state.type.toUpperCase()} · ${state.subject.toUpperCase()}</span>
          <span class="score-bar-title">${state.title}</span>
        </div>
        <div class="score-bar-right">
          <div class="score-bar-stat">
            <span class="value" id="quiz-progress">0/${state.items.length}</span>
            <span class="label">Answered</span>
          </div>
          <div class="score-bar-stat">
            <span class="value" id="quiz-timer">--:--</span>
            <span class="label">Time</span>
          </div>
          <div class="score-bar-stat">
            <span class="value" id="quiz-warnings">0</span>
            <span class="label">Warnings</span>
          </div>
        </div>
      </div>
    `;
  }

  /* ---------- Render Question ---------- */
  function renderQuestion() {
    const container = document.getElementById('quiz-body');
    if (!container) return;

    const q = state.items[state.currentIndex];
    const saved = state.answers[q.id];

    container.innerHTML = `
      <div class="card">
        <div class="flex-between" style="margin-bottom:16px;">
          <span class="badge badge-info">Question ${state.currentIndex + 1} of ${state.items.length}</span>
          <span class="badge badge-warning">${q.competency || 'General'}</span>
        </div>
        <p style="font-size:1.1rem;font-weight:500;margin-bottom:20px;">${q.text}</p>
        <div id="quiz-options"></div>
      </div>
    `;

    const opts = document.getElementById('quiz-options');
    q.options.forEach((opt, i) => {
      const label = document.createElement('label');
      label.className = 'quiz-option';
      label.style.cssText = `
        display:flex;align-items:flex-start;gap:12px;
        padding:14px 16px;margin-bottom:10px;
        background:${saved === opt.key ? 'var(--color-primary-light)' : 'var(--color-surface)'};
        border:2px solid ${saved === opt.key ? 'var(--color-primary)' : 'var(--color-border)'};
        border-radius:8px;cursor:pointer;transition:all 0.15s;
      `;

      label.innerHTML = `
        <input type="radio" name="q${state.currentIndex}" value="${opt.key}" ${saved === opt.key ? 'checked' : ''} style="margin-top:3px;" />
        <span style="flex:1;font-size:0.95rem;">
          <strong style="color:var(--color-primary-dark);">${String.fromCharCode(65 + i)}.</strong>
          ${opt.label}
        </span>
      `;

      label.addEventListener('click', () => {
        state.answers[q.id] = opt.key;
        renderQuestion();
        updateProgress();
      });

      opts.appendChild(label);
    });

    updateNavButtons();
  }

  /* ---------- Navigation ---------- */
  function renderNavigation() {
    const nav = document.getElementById('quiz-nav');
    if (!nav) return;

    nav.innerHTML = `
      <div class="flex-between" style="gap:8px;flex-wrap:wrap;">
        <button id="btn-prev" class="btn btn-outline">← Previous</button>
        <div id="quiz-dots" style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center;flex:1;"></div>
        <button id="btn-next" class="btn btn-outline">Next →</button>
      </div>
      <div style="margin-top:16px;text-align:center;">
        <button id="btn-submit" class="btn btn-primary btn-full">📝 Submit Assessment</button>
      </div>
    `;

    document.getElementById('btn-prev').addEventListener('click', () => {
      if (state.currentIndex > 0) { state.currentIndex--; renderQuestion(); renderDots(); }
    });

    document.getElementById('btn-next').addEventListener('click', () => {
      if (state.currentIndex < state.items.length - 1) { state.currentIndex++; renderQuestion(); renderDots(); }
    });

    document.getElementById('btn-submit').addEventListener('click', () => {
      const answered = Object.keys(state.answers).length;
      const total = state.items.length;

      if (answered < total) {
        if (!confirm(`You have answered ${answered}/${total} items. Submit anyway?`)) return;
      }
      submit(false);
    });

    renderDots();
  }

  function renderDots() {
    const dots = document.getElementById('quiz-dots');
    if (!dots) return;
    dots.innerHTML = state.items.map((q, i) => {
      const answered = state.answers[q.id] !== undefined;
      const current = i === state.currentIndex;
      return `
        <span data-dot="${i}" style="
          width:22px;height:22px;border-radius:50%;
          display:inline-flex;align-items:center;justify-content:center;
          font-size:0.7rem;font-weight:600;cursor:pointer;
          background:${current ? 'var(--color-accent)' : answered ? 'var(--color-primary)' : 'var(--color-border)'};
          color:${answered || current ? '#fff' : '#666'};
          transition:all 0.15s;
        ">${i + 1}</span>
      `;
    }).join('');

    dots.querySelectorAll('[data-dot]').forEach((el) => {
      el.addEventListener('click', () => {
        state.currentIndex = parseInt(el.dataset.dot);
        renderQuestion();
        renderDots();
      });
    });
  }

  function updateNavButtons() {
    const prev = document.getElementById('btn-prev');
    const next = document.getElementById('btn-next');
    if (prev) prev.disabled = state.currentIndex === 0;
    if (next) next.disabled = state.currentIndex === state.items.length - 1;
  }

  function updateProgress() {
    const el = document.getElementById('quiz-progress');
    if (el) el.textContent = `${Object.keys(state.answers).length}/${state.items.length}`;
  }

  /* ---------- Timer ---------- */
  function startTimer() {
    const el = document.getElementById('quiz-timer');
    if (!el) return;

    const endTime = state.startTime + state.timeLimit * 1000;

    const interval = setInterval(() => {
      if (state.submitted) { clearInterval(interval); return; }
      const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
      el.textContent = APP.formatTime(remaining);

      if (remaining < 60) el.style.color = '#c62828';
      if (remaining <= 0) {
        clearInterval(interval);
        APP.toast('⏰ Time is up. Submitting...', 'warning', 3000);
        submit(true);
      }
    }, 1000);
  }

  /* ---------- Submit ---------- */
  function submit(autoSubmitted) {
    if (state.submitted) return;
    state.submitted = true;

    // Score
    let correct = 0;
    const breakdown = [];

    state.items.forEach((q) => {
      const given = state.answers[q.id];
      const correctOpt = q.options.find((o) => o.correct);
      const isCorrect = given === correctOpt?.key;
      if (isCorrect) correct++;

      breakdown.push({
        id: q.id,
        competency: q.competency,
        given,
        correct: correctOpt?.key,
        isCorrect
      });
    });

    const total = state.items.length;
    const percent = Math.round((correct / total) * 100);
    const passed = percent >= state.passingScore;

    // Save
    Store.saveScore(state.lrn, state.subject, state.type, state.assessmentId, {
      score: correct,
      total,
      percent,
      passed,
      autoSubmitted,
      tabViolations: state.tabViolations,
      breakdown,
      durationSec: Math.floor((Date.now() - state.startTime) / 1000)
    });

    // Lock
    if (!state.allowRetake) {
      Store.lockAssessment(state.lrn, state.assessmentId, {
        score: correct, total, percent
      });
    }

    // Remediation trigger
    if (state.type === 'st' && percent < 80) {
      Store.saveUser({
        lrn: state.lrn,
        remediationUnlocked: true,
        remediationTrigger: state.assessmentId,
        remediationCompetencies: breakdown.filter((b) => !b.isCorrect).map((b) => b.competency)
      });
    }

    renderResult({ correct, total, percent, passed, autoSubmitted });
  }

  /* ---------- Render Result ---------- */
  function renderResult({ correct, total, percent, passed, autoSubmitted }) {
    const container = document.getElementById('quiz-body');
    const nav = document.getElementById('quiz-nav');
    const header = document.getElementById('quiz-header');

    if (header) header.innerHTML = '';
    if (nav) nav.innerHTML = '';

    const level = Transmutation.proficiencyLevel(percent);

    container.innerHTML = `
      <div class="card text-center">
        <div style="font-size:3rem;">${passed ? '🎉' : '📖'}</div>
        <h2 style="color:${passed ? 'var(--color-success)' : 'var(--color-warning)'};">
          ${passed ? 'Passed!' : 'Keep Practicing'}
        </h2>
        <p class="text-muted">${autoSubmitted ? 'Assessment auto-submitted.' : 'Assessment complete.'}</p>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:16px;margin:24px 0;">
          <div class="stat-card">
            <div class="stat-value">${correct}/${total}</div>
            <div class="stat-label">Score</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${percent}%</div>
            <div class="stat-label">Percentage</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">
              <span class="pl-indicator pl-${level.key}">${level.level}</span>
            </div>
            <div class="stat-label">Proficiency</div>
          </div>
        </div>

        ${state.tabViolations > 0 ? `<div class="alert alert-warning">⚠️ ${state.tabViolations} tab switch(es) detected during the assessment.</div>` : ''}

        ${!passed && state.type === 'st' ? `
          <div class="alert alert-warning" style="text-align:left;">
            <strong>📚 Remediation Unlocked</strong>
            <p style="margin-top:8px;">Your score is below 80%. A remediation module has been unlocked for the competencies you missed.</p>
            <a href="../../remediation/index.html?subject=${state.subject}&st=${state.assessmentId}" class="btn btn-accent mt-md">Go to Remediation →</a>
          </div>
        ` : ''}

        <div style="margin-top:24px;">
          <a href="../../dashboard.html" class="btn btn-primary">← Back to Dashboard</a>
        </div>
      </div>
    `;
  }

  /* ---------- Render Locked ---------- */
  function renderLocked() {
    const container = document.getElementById('quiz-body');
    container.innerHTML = `
      <div class="card text-center">
        <div style="font-size:3rem;">🔒</div>
        <h2>Assessment Already Locked</h2>
        <p class="text-muted">You have already submitted this assessment. Only your teacher can unlock it.</p>
        <a href="../../dashboard.html" class="btn btn-primary mt-lg">← Back to Dashboard</a>
      </div>
    `;
  }

  /* ---------- Public API ---------- */
  return { init };
})();
