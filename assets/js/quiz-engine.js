/* ============================================================
   quiz-engine.js — Quiz / ST / TE engine with anti-cheat
   Version: 2.0.0
   ------------------------------------------------------------
   v2.0.0:
   - Start screen; the attempt (question order, answers, deadline, tab
     switches) is saved, so a reload RESUMES the same attempt with the
     same timer instead of restarting it.
   - Before starting, the cloud record is pulled (max 5 s) so a test
     already taken on another device is locked here too.
   - Starting a test sends an "in progress" marker to the cloud: opening
     the test on a second device is blocked (ask the teacher for a code).
   - Time is measured on the real clock; when the deadline passed while
     the page was closed, the saved answers are submitted.
   - Passing mark from CONFIG.PASSING_PERCENT (70%).
   - Tab switch counted once per leave; the count survives a reload.
   ============================================================ */

const QuizEngine = (() => {
  'use strict';

  const NS = 'gba_v1_';
  let state = null;
  let cfg = null;
  let tabMon = null;

  const PASS = () => (typeof CONFIG !== 'undefined' && CONFIG.PASSING_PERCENT) || 70;
  const esc = (v) => String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const attemptKey = (lrn, id) => `${NS}attempt_${lrn}_${id}`;

  function readAttempt(lrn, id) {
    try { return JSON.parse(localStorage.getItem(attemptKey(lrn, id)) || 'null'); } catch (e) { return null; }
  }
  function writeAttempt() {
    if (!state) return;
    try {
      localStorage.setItem(attemptKey(state.lrn, state.assessmentId), JSON.stringify({
        seed: state.seed, startedAt: state.startTime, deadline: state.deadline,
        answers: state.answers, currentIndex: state.currentIndex, tabViolations: state.tabViolations
      }));
    } catch (e) { /* storage full: the attempt still works in memory */ }
  }
  function clearAttempt(lrn, id) { try { localStorage.removeItem(attemptKey(lrn, id)); } catch (e) { /* ignore */ } }

  function hasRetakeUnlock(lrn, id) {
    try { return !!localStorage.getItem(`${NS}unlocked_${lrn}_${id}`); } catch (e) { return false; }
  }

  function currentEntry(lrn, subject, typeKey, id) {
    const s = (Store.getScores(lrn, { includePending: true }) || {})[subject] || {};
    return (s[typeKey] || {})[id] || null;
  }

  /* ---------- cloud check before starting ---------- */
  async function pullFirst(lrn) {
    if (!navigator.onLine || typeof CONFIG === 'undefined' || !CONFIG.backendEnabled) return;
    try {
      const master = (window.Sync && Sync.ensureSyncMaster) ? await Sync.ensureSyncMaster() : window.SyncMaster;
      if (!master || !master.pullFromBackend) return;
      await Promise.race([master.pullFromBackend(lrn), new Promise((r) => setTimeout(r, 5000))]);
    } catch (e) { /* offline: continue with local data */ }
  }

  /* ---------- Init ---------- */
  async function init(config) {
    const user = Store.getCurrentUser();
    if (!user) { window.location.href = '../../student/login.html'; return; }

    cfg = Object.assign({ allowRetake: false }, config);
    const typeKey = cfg.type === 'quiz' ? 'quizzes' : cfg.type;
    const body = document.getElementById('quiz-body');
    const saved = readAttempt(user.lrn, cfg.assessmentId);

    if (!saved) {
      if (body) body.innerHTML = '<div class="card text-center"><p class="text-muted">⏳ Checking your record…</p></div>';
      await pullFirst(user.lrn);
    }

    const unlocked = hasRetakeUnlock(user.lrn, cfg.assessmentId);
    if (!saved && !cfg.allowRetake && !unlocked) {
      if (Store.isAssessmentLocked(user.lrn, cfg.assessmentId)) { renderLocked(); return; }
      const e = currentEntry(user.lrn, cfg.subject, typeKey, cfg.assessmentId);
      if (e && e.score !== null && e.score !== undefined) { renderLocked(); return; }
      if (e && e.status === 'in-progress') { renderStartedElsewhere(); return; }
    }

    if (saved) {
      if (Date.now() >= saved.deadline) {
        begin(user, saved);
        APP.toast('⏰ Time ran out while the test was closed. Your saved answers were submitted.', 'warning', 6000);
        submit(true);
        return;
      }
      begin(user, saved);
      APP.toast('▶️ Your test was resumed. The timer kept running.', 'info', 4000);
      return;
    }
    renderStart(user, unlocked);
  }

  function renderStart(user, isRetake) {
    const mins = Math.round(cfg.timeLimit / 60);
    const n = (cfg.items || []).length;
    const body = document.getElementById('quiz-body');
    body.innerHTML = `
      <div class="card">
        <h2 style="color:var(--color-primary-dark);">${esc(cfg.title)}</h2>
        <p class="text-muted">${n} items · ${mins} minutes · ${PASS()}% to pass${isRetake ? ' · <strong>Retake</strong>' : ''}</p>
        <ul style="margin:16px 0 0 18px;line-height:1.7;">
          <li>The timer starts when you press <strong>Start</strong> and keeps running even if you close or reload the page.</li>
          <li>If the page reloads, your answers are kept — just open the test again on this device.</li>
          <li>Leaving the page (switching tabs/apps) is recorded. After 3 times the test is submitted.</li>
          <li>Once started, this test cannot be opened on another device.</li>
        </ul>
        <button id="btn-start" class="btn btn-primary btn-full" style="margin-top:20px;">▶️ Start</button>
      </div>`;
    document.getElementById('btn-start').addEventListener('click', () => {
      const now = Date.now();
      const fresh = { seed: user.lrn + '|' + cfg.assessmentId + '|' + now, startedAt: now, deadline: now + cfg.timeLimit * 1000, answers: {}, currentIndex: 0, tabViolations: 0 };
      begin(user, fresh);
      writeAttempt();
      if (!isRetake) markStarted(user, now);
    });
  }

  // Cloud marker so the same test cannot be started again on another device
  function markStarted(user, now) {
    const typeKey = cfg.type === 'quiz' ? 'quizzes' : cfg.type;
    const existing = currentEntry(user.lrn, cfg.subject, typeKey, cfg.assessmentId);
    if (existing) return;
    const marker = { score: null, total: (cfg.items || []).length, percent: null, passed: false, status: 'in-progress', startedAt: new Date(now).toISOString() };
    const saved = Store.saveScore(user.lrn, cfg.subject, typeKey, cfg.assessmentId, marker);
    if (window.Sync && typeof Sync.pushScoreToBackend === 'function') {
      Sync.pushScoreToBackend(user.lrn, cfg.subject, typeKey, cfg.assessmentId, { ...marker, timestamp: saved && saved.timestamp }).catch(() => {});
    }
  }

  function begin(user, saved) {
    state = {
      lrn: user.lrn,
      assessmentId: cfg.assessmentId,
      subject: cfg.subject,
      type: cfg.type,
      title: cfg.title,
      seed: saved.seed,
      items: Security.shuffleQuestions(cfg.items, saved.seed),
      answers: saved.answers || {},
      currentIndex: Math.min(saved.currentIndex || 0, (cfg.items || []).length - 1),
      startTime: saved.startedAt,
      deadline: saved.deadline,
      submitted: false,
      tabViolations: saved.tabViolations || 0,
      tabThreshold: 3,
      passingScore: PASS(),
      allowRetake: cfg.allowRetake
    };
    setupAntiCheat();
    renderHeader();
    renderQuestion();
    startTimer();
    renderNavigation();
    updateProgress();
    const w = document.getElementById('quiz-warnings');
    if (w) w.textContent = state.tabViolations;
  }

  /* ---------- Anti-cheat ---------- */
  function setupAntiCheat() {
    Security.disableCopyPaste(document);
    Security.disableDevShortcuts();
    tabMon = Security.startTabMonitor((count, final) => {
      if (!state || state.submitted) return;
      state.tabViolations = count;
      writeAttempt();
      const w = document.getElementById('quiz-warnings');
      if (w) w.textContent = count;
      if (final) {
        APP.toast('Too many tab switches. Test submitted automatically.', 'danger', 5000);
        submit(true);
      } else {
        APP.toast(`⚠️ Tab switch detected (${count}/${state.tabThreshold}). Stay on this page.`, 'warning', 3000);
      }
    }, state.tabThreshold, state.tabViolations);
  }

  function renderHeader() {
    const header = document.getElementById('quiz-header');
    if (!header) return;
    header.innerHTML = `
      <div class="daily-score-bar">
        <div class="score-bar-left">
          <span class="score-bar-label">${esc(state.type.toUpperCase())} · ${esc(state.subject.toUpperCase())}</span>
          <span class="score-bar-title">${esc(state.title)}</span>
        </div>
        <div class="score-bar-right">
          <div class="score-bar-stat"><span class="value" id="quiz-progress">0/${state.items.length}</span><span class="label">Answered</span></div>
          <div class="score-bar-stat"><span class="value" id="quiz-timer">--:--</span><span class="label">Time</span></div>
          <div class="score-bar-stat"><span class="value" id="quiz-warnings">0</span><span class="label">Warnings</span></div>
        </div>
      </div>`;
  }

  function renderQuestion() {
    const container = document.getElementById('quiz-body');
    if (!container) return;
    const q = state.items[state.currentIndex];
    const saved = state.answers[q.id];
    container.innerHTML = `
      <div class="card">
        <div class="flex-between" style="margin-bottom:16px;">
          <span class="badge badge-info">Question ${state.currentIndex + 1} of ${state.items.length}</span>
        </div>
        <p style="font-size:1.1rem;font-weight:500;margin-bottom:20px;">${q.text}</p>
        <div id="quiz-options"></div>
      </div>`;
    const opts = document.getElementById('quiz-options');
    q.options.forEach((opt, i) => {
      const label = document.createElement('label');
      label.className = 'quiz-option';
      label.style.cssText = `display:flex;align-items:flex-start;gap:12px;padding:14px 16px;margin-bottom:10px;
        background:${saved === opt.key ? 'var(--color-primary-light)' : 'var(--color-surface)'};
        border:2px solid ${saved === opt.key ? 'var(--color-primary)' : 'var(--color-border)'};
        border-radius:8px;cursor:pointer;transition:all 0.15s;`;
      label.innerHTML = `
        <input type="radio" name="q${state.currentIndex}" value="${esc(opt.key)}" ${saved === opt.key ? 'checked' : ''} style="margin-top:3px;" />
        <span style="flex:1;font-size:0.95rem;"><strong style="color:var(--color-primary-dark);">${String.fromCharCode(65 + i)}.</strong> ${opt.label}</span>`;
      label.addEventListener('click', () => {
        if (state.submitted) return;
        state.answers[q.id] = opt.key;
        writeAttempt();
        renderQuestion();
        renderDots();
        updateProgress();
      });
      opts.appendChild(label);
    });
    updateNavButtons();
  }

  function go(i) {
    state.currentIndex = i;
    writeAttempt();
    renderQuestion();
    renderDots();
  }

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
      </div>`;
    document.getElementById('btn-prev').addEventListener('click', () => { if (state.currentIndex > 0) go(state.currentIndex - 1); });
    document.getElementById('btn-next').addEventListener('click', () => { if (state.currentIndex < state.items.length - 1) go(state.currentIndex + 1); });
    document.getElementById('btn-submit').addEventListener('click', () => {
      const answered = Object.keys(state.answers).length;
      const total = state.items.length;
      if (answered < total && !confirm(`You have answered ${answered}/${total} items. Submit anyway?`)) return;
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
      return `<span data-dot="${i}" style="width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
        font-size:0.7rem;font-weight:600;cursor:pointer;background:${current ? 'var(--color-accent)' : answered ? 'var(--color-primary)' : 'var(--color-border)'};
        color:${answered || current ? '#fff' : '#666'};">${i + 1}</span>`;
    }).join('');
    dots.querySelectorAll('[data-dot]').forEach((el) => el.addEventListener('click', () => go(parseInt(el.dataset.dot, 10))));
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

  function startTimer() {
    const tick = () => {
      if (!state || state.submitted) return false;
      const el = document.getElementById('quiz-timer');
      const remaining = Math.max(0, Math.floor((state.deadline - Date.now()) / 1000));
      if (el) { el.textContent = APP.formatTime(remaining); if (remaining < 60) el.style.color = '#c62828'; }
      if (remaining <= 0) {
        APP.toast('⏰ Time is up. Submitting...', 'warning', 3000);
        submit(true);
        return false;
      }
      return true;
    };
    tick();
    const interval = setInterval(() => { if (!tick()) clearInterval(interval); }, 1000);
  }

  /* ---------- Submit ---------- */
  function submit(autoSubmitted) {
    if (!state || state.submitted) return;
    state.submitted = true;
    if (tabMon) tabMon.stop();

    let correct = 0;
    const breakdown = [];
    state.items.forEach((q) => {
      const given = state.answers[q.id];
      const correctOpt = q.options.find((o) => o.correct);
      const isCorrect = given !== undefined && given === correctOpt?.key;
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
      durationSec: Math.floor((Date.now() - state.startTime) / 1000),
      startedAt: new Date(state.startTime).toISOString()
    };

    const saved = Store.saveScore(state.lrn, state.subject, typeKey, state.assessmentId, scoreData);
    let pushPromise = Promise.resolve({ ok: false, error: 'Sync module not loaded' });
    if (window.Sync && typeof Sync.pushScoreToBackend === 'function') {
      pushPromise = Sync.pushScoreToBackend(state.lrn, state.subject, typeKey, state.assessmentId, { ...scoreData, timestamp: saved && saved.timestamp })
        .catch((err) => ({ ok: false, error: err && err.message }));
    }

    if (!state.allowRetake) Store.lockAssessment(state.lrn, state.assessmentId, { score: correct, total, percent });
    if (window.Sync && typeof Sync.clearRetakeUnlock === 'function') Sync.clearRetakeUnlock(state.lrn, state.assessmentId);
    clearAttempt(state.lrn, state.assessmentId);

    if (state.type === 'st' && !passed) {
      const u = Store.getUser(state.lrn) || {};
      u.remediationUnlocked = true;
      u.remediationTrigger = state.assessmentId;
      u.remediationCompetencies = breakdown.filter((b) => !b.isCorrect).map((b) => b.competency);
      Store.saveUser(u);
    }

    renderResult({ correct, total, percent, passed, autoSubmitted });

    pushPromise.then((res) => {
      const el = document.getElementById('quiz-sync-status');
      if (!el) return;
      if (res && res.ok) { el.textContent = '☁️ Score sent to your teacher.'; el.style.color = '#2e7d32'; }
      else { el.textContent = '📴 Score saved on this device — it will be sent automatically once you are online.'; el.style.color = '#ed6c02'; }
    });
  }

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
        <h2 style="color:${passed ? 'var(--color-success)' : 'var(--color-warning)'};">${passed ? 'Passed!' : 'Keep Practicing'}</h2>
        <p class="text-muted">${autoSubmitted ? 'Assessment auto-submitted.' : 'Assessment complete.'}</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:16px;margin:24px 0;">
          <div class="stat-card"><div class="stat-value">${correct}/${total}</div><div class="stat-label">Score</div></div>
          <div class="stat-card"><div class="stat-value">${percent}%</div><div class="stat-label">Percentage</div></div>
          <div class="stat-card"><div class="stat-value"><span class="pl-indicator pl-${level.key}">${level.level}</span></div><div class="stat-label">Proficiency</div></div>
        </div>
        ${state.tabViolations > 0 ? `<div class="alert alert-warning">⚠️ ${state.tabViolations} tab switch(es) detected during the assessment.</div>` : ''}
        ${!passed && state.type === 'st' ? `
          <div class="alert alert-warning" style="text-align:left;">
            <strong>📚 Remediation Unlocked</strong>
            <p style="margin-top:8px;">Your score is below ${state.passingScore}%. A remediation module has been unlocked for the competencies you missed.</p>
            <a href="../remediation/index.html?subject=${esc(state.subject)}&st=${esc(state.assessmentId)}" class="btn btn-accent mt-md">Go to Remediation →</a>
          </div>` : ''}
        ${!passed ? `
          <div class="alert alert-info" style="text-align:left;margin-top:16px;">
            <strong>💡 Want to retake?</strong>
            <p style="margin-top:8px;font-size:0.85rem;">Go back to Assessments and click <strong>"🔑 Request Retake Code"</strong>. Your teacher will send you a code.</p>
          </div>` : ''}
        <p id="quiz-sync-status" class="text-small" style="margin-top:16px;color:#78909c;">⏳ Sending your score to your teacher...</p>
        <div style="margin-top:24px;"><a href="index.html?subject=${esc(state.subject)}" class="btn btn-primary">← Back to Assessments</a></div>
      </div>`;
  }

  function renderLocked() {
    const container = document.getElementById('quiz-body');
    container.innerHTML = `
      <div class="card text-center">
        <div style="font-size:3rem;">🔒</div>
        <h2>Assessment Already Taken</h2>
        <p class="text-muted">You have already submitted this assessment. To take it again, request a retake code from the Assessments page.</p>
        <a href="index.html" class="btn btn-primary mt-lg">← Back to Assessments</a>
      </div>`;
  }

  function renderStartedElsewhere() {
    const container = document.getElementById('quiz-body');
    container.innerHTML = `
      <div class="card text-center">
        <div style="font-size:3rem;">📱</div>
        <h2>Test Already Started</h2>
        <p class="text-muted">This test was started on another device. Continue it on that device, or ask your teacher for a retake code.</p>
        <a href="index.html" class="btn btn-primary mt-lg">← Back to Assessments</a>
      </div>`;
  }

  return { init };
})();
