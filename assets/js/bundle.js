/* ============================================================
   bundle.js — Lesson day engine (ActivityGate + Lesson)
   Version: 3.0.0
   ------------------------------------------------------------
   v3.0.0:
   - No more private copies of CONFIG / APP / Store / Sync. day.html now
     loads config.js, app.js, store.js, sync.js and sync-master.js, so a
     new BACKEND_URL or any store fix reaches the lesson pages too.
   - Activity gate state is rebuilt from the saved activity results, so a
     passed Activity 1/2 stays passed on reload and on other devices.
   - Pass mark from CONFIG.ACTIVITY_PASS_PERCENT (70%).
   - Daily points = best run of each activity ("Practice Again" cannot farm).
   - Scenario / formative choices are shuffled every attempt; letter
     prefixes in the data ("A) ...") are removed.
   - After every answer the explanation is shown (timer paused); match
     pairs show their reasons at the end.
   ============================================================ */

/* ---------- ACTIVITY GATE ---------- */
const ActivityGate = (() => {
  'use strict';
  const STORAGE_KEY = 'gba_gate_v2_';
  const PASS = ((typeof CONFIG !== 'undefined' && CONFIG.ACTIVITY_PASS_PERCENT) || 70) / 100;
  const ORDER = ['activity1', 'activity2', 'formative'];
  let session = null, inited = false;

  function savedResult(k) {
    try {
      const sess = Store.getSession();
      if (!sess || !session) return null;
      const acts = ((Store.getScores(sess.lrn) || {})[session.subject] || {}).activities || {};
      return acts[`w${session.week}-d${session.day}-${k}`] || null;
    } catch (e) { return null; }
  }

  function init(cfg) {
    if (inited) return;
    session = {
      key: `${STORAGE_KEY}${cfg.subject}_w${cfg.week}_d${cfg.day}`,
      subject: cfg.subject, week: cfg.week, day: cfg.day,
      states: {
        activity1: { status: 'ready', score: 0, attempts: 0 },
        activity2: { status: 'locked', score: 0, attempts: 0 },
        formative: { status: 'locked', score: 0, attempts: 0 }
      }
    };
    // 1) results saved on this device or pulled from the cloud
    ORDER.forEach((k, i) => {
      const r = savedResult(k);
      if (r && r.passed) {
        session.states[k] = { status: 'passed', score: Number(r.percent) || 0, attempts: Number(r.attempts) || 1 };
        const next = ORDER[i + 1];
        if (next && session.states[next].status === 'locked') session.states[next].status = 'ready';
      } else if (r) {
        session.states[k].attempts = Number(r.attempts) || 0;
        session.states[k].score = Number(r.percent) || 0;
      }
    });
    // 2) this tab's live state (e.g. a failed attempt waiting for Retake)
    const saved = sessionStorage.getItem(session.key);
    if (saved) {
      try {
        const st = JSON.parse(saved).states || {};
        ORDER.forEach((k) => {
          if (!st[k] || session.states[k].status === 'passed') return;
          if (st[k].status === 'running') st[k].status = 'ready';
          if (st[k].status !== 'locked') session.states[k] = st[k];
        });
      } catch (e) { /* ignore */ }
    }
    inited = true;
    setTimeout(applyUI, 10);
    setTimeout(() => document.dispatchEvent(new CustomEvent('activity-gate:ready')), 30);
  }

  function save() {
    if (!session) return;
    try { sessionStorage.setItem(session.key, JSON.stringify({ states: session.states })); } catch (e) { /* ignore */ }
  }

  function markRunning(id) {
    const k = normalize(id);
    if (!session) return;
    session.states[k].status = 'running';
    save(); applyUI();
  }

  function completeWithScore(id, pct) {
    if (!session) return;
    const k = normalize(id);
    const st = session.states[k];
    const wasPassed = st.passedBefore;
    st.attempts = (st.attempts || 0) + 1;
    st.score = Math.round(pct);
    if (pct >= PASS * 100 || wasPassed) {
      st.status = 'passed';
      st.passedBefore = true;
      if (pct < PASS * 100) st.score = Math.max(st.score, Number(st.bestScore) || 0);
      const next = ORDER[ORDER.indexOf(k) + 1];
      if (next && session.states[next].status === 'locked') session.states[next].status = 'ready';
      if (pct >= PASS * 100) APP.toast(k === 'formative' ? '🎉 Formative complete!' : '✅ ' + titlesMap(k) + ' passed!', 'success', 4000);
    } else {
      st.status = 'failed';
    }
    st.bestScore = Math.max(Number(st.bestScore) || 0, Math.round(pct));
    save(); applyUI();
    recordAndPushActivity(k, st, pct);
  }

  function recordAndPushActivity(k, st, pct) {
    if (!session) return;
    const sess = Store.getSession();
    const lrn = sess ? sess.lrn : null;
    if (!lrn) return;
    let saved = null;
    try {
      saved = Store.saveActivity(lrn, session.subject, `w${session.week}-d${session.day}-${k}`, {
        percent: Math.round(pct), score: Math.round(pct), total: 100, passed: pct >= PASS * 100, attempts: st.attempts || 1,
        week: session.week, day: session.day, activity: k
      });
    } catch (e) { console.warn('[ActivityGate] saveActivity failed', e); }
    if (window.Sync) {
      if (saved && typeof Sync.pushActivityToBackend === 'function') Sync.pushActivityToBackend(lrn, session.subject, saved).catch(() => {});
      if (typeof Sync.pushProgressToBackend === 'function') Sync.pushProgressToBackend(lrn, session.subject).catch(() => {});
    }
  }

  function resetActivity(id) {
    if (!session) return;
    const k = normalize(id);
    session.states[k].passedBefore = session.states[k].status === 'passed' || session.states[k].passedBefore;
    session.states[k].status = 'ready';
    save(); applyUI();
    APP.toast('🔁 ' + titlesMap(k) + ' reset — practice as much as you like', 'info', 3000);
  }

  function reset(id) { if (!session) return; session.states[normalize(id)].status = 'ready'; save(); applyUI(); }

  function titlesMap(k) { return k === 'activity1' ? 'Activity 1' : k === 'activity2' ? 'Activity 2' : 'Formative'; }

  function applyUI() { applyStage('activity-1', 'activity1'); applyStage('activity-2', 'activity2'); applyStage('formative', 'formative'); }

  function applyStage(cid, sk) {
    const c = document.getElementById(cid);
    if (!c || !session) return;
    const pc = c.closest('.activity-card') || c.parentElement;
    if (!pc) return;
    const st = session.states[sk];
    pc.querySelectorAll('.gate-overlay').forEach((e) => e.remove());
    if (st.status === 'running') { c.style.display = ''; return; }
    c.style.display = 'none';
    if (st.status === 'locked') pc.appendChild(mkLocked());
    else if (st.status === 'ready') pc.appendChild(mkReady(sk));
    else if (st.status === 'passed') pc.appendChild(mkPassed(sk, st));
    else if (st.status === 'failed') pc.appendChild(mkFailed(sk, st));
  }

  const pctLabel = () => Math.round(PASS * 100) + '%';

  function overlay(css, html) {
    const e = document.createElement('div');
    e.className = 'gate-overlay';
    e.style.cssText = css;
    e.innerHTML = html;
    return e;
  }

  function mkLocked() {
    return overlay('padding:32px 24px;text-align:center;background:#f8f9fa;border:2px dashed #dadce0;border-radius:8px;',
      '<div style="font-size:2rem;">🔒</div><div style="font-weight:600;margin-top:8px;color:#1b7a3d;">Locked</div><div style="font-size:0.85rem;margin-top:4px;color:#5f6368;">Complete the previous activity with at least ' + pctLabel() + ' to unlock.</div>');
  }

  function mkReady(sk) {
    const titles = { activity1: 'Activity 1 — Match the Pairs', activity2: 'Activity 2 — Scenario Challenge', formative: 'Formative — Escape the Cell' };
    const cid = sk === 'activity1' ? 'activity-1' : sk === 'activity2' ? 'activity-2' : 'formative';
    const c = document.getElementById(cid);
    const mins = c && c.dataset.estimatedMinutes ? c.dataset.estimatedMinutes : 5;
    const e = overlay('padding:32px 24px;text-align:center;background:linear-gradient(135deg,#e8f5e9,#c8e6c9);border:2px solid #4caf50;border-radius:8px;', `
      <div style="font-size:2.5rem;">▶️</div>
      <div style="font-weight:700;margin-top:12px;color:#1b5e20;font-size:1.1rem;">${titles[sk]}</div>
      <div style="font-size:0.85rem;margin-top:8px;color:#2e7d32;">⏱️ ${mins} min · 🎯 ${pctLabel()} to pass · 💡 explanations after each answer</div>
      <button class="btn btn-primary" style="margin-top:16px;padding:12px 28px;" data-start="${sk}">▶️ Start Activity</button>`);
    setTimeout(() => { const b = e.querySelector('[data-start]'); if (b) b.addEventListener('click', () => start(sk)); }, 0);
    return e;
  }

  function mkPassed(sk, st) {
    const e = overlay('padding:28px 24px;text-align:center;background:linear-gradient(135deg,#e8f5e9,#a5d6a7);border:2px solid #2e7d32;border-radius:8px;', `
      <div style="font-size:2rem;">✅</div>
      <div style="font-weight:700;margin-top:8px;color:#1b5e20;">Passed!</div>
      <div style="font-size:0.9rem;margin-top:6px;color:#2e7d32;">Best score: ${Math.max(st.score || 0, st.bestScore || 0)}% · Attempts: ${st.attempts || 1}</div>
      <button class="btn btn-outline" style="margin-top:16px;padding:10px 22px;border-color:#2e7d32;color:#1b5e20;background:#fff;" data-retake="${sk}">🔁 Practice Again</button>`);
    setTimeout(() => {
      const b = e.querySelector('[data-retake]');
      if (b) b.addEventListener('click', () => {
        if (confirm('Practice "' + titlesMap(sk) + '" again?\n\nYour passing score is kept — this is extra practice.')) resetActivity(sk);
      });
    }, 0);
    return e;
  }

  function mkFailed(sk, st) {
    const e = overlay('padding:32px 24px;text-align:center;background:linear-gradient(135deg,#fff3e0,#ffe0b2);border:2px solid #ed6c02;border-radius:8px;', `
      <div style="font-size:2.5rem;">🔁</div>
      <div style="font-weight:700;margin-top:8px;color:#e65100;">Try Again!</div>
      <div style="font-size:0.95rem;margin-top:8px;color:#ef6c00;">Score: ${st.score}% — need ${pctLabel()}. Read the discussion again, then retry.</div>
      <button class="btn btn-primary" style="margin-top:16px;padding:12px 28px;" data-start="${sk}">🔁 Retake</button>`);
    setTimeout(() => { const b = e.querySelector('[data-start]'); if (b) b.addEventListener('click', () => start(sk)); }, 0);
    return e;
  }

  function start(sk) {
    markRunning(sk);
    document.dispatchEvent(new CustomEvent('activity:start', { detail: { activity: sk } }));
  }

  function normalize(id) {
    const s = String(id);
    if (s === '1' || s === 'activity-1' || s === 'activity1') return 'activity1';
    if (s === '2' || s === 'activity-2' || s === 'activity2') return 'activity2';
    return 'formative';
  }

  return {
    init, markRunning, completeWithScore, reset, resetActivity,
    applyUI, PASS, isInitialized: () => inited,
    complete: (id) => completeWithScore(id, 100),
    applyLocks: applyUI
  };
})();

/* ---------- LESSON ENGINE ---------- */
const Lesson = (() => {
  'use strict';
  let ctx = null;
  const pending = {};
  let ready = false;
  let to = null;
  const PASS = ((typeof CONFIG !== 'undefined' && CONFIG.ACTIVITY_PASS_PERCENT) || 70);

  const esc = (v) => String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // strip check marks and data-side letter prefixes ("A) ", "B. ")
  function cleanLabel(label) {
    if (typeof label !== 'string') return label;
    return label.replace(/[✓✔✅☑]/g, '').replace(/^\s*[A-Da-d][.)]\s+/, '').replace(/\s+/g, ' ').trim();
  }
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const explanationOf = (it) => it && (it.explanation || it.why || it.feedback || '');

  function init(cfg) {
    const user = Store.getCurrentUser();
    if (!user) { window.location.href = '../../../student/login.html'; return; }
    ctx = { lrn: user.lrn, subject: cfg.subject, week: cfg.week, day: cfg.day, badges: [], startTime: Date.now(), current: null, runPts: 0 };
    renderBar(cfg.title);
    liveTimer();
    showLoad();
    to = setTimeout(() => { if (!ready) showTimeout(); }, 15000);
    document.addEventListener('activity:start', (e) => startAct(e.detail.activity));
    document.addEventListener('activity-gate:ready', () => { setTimeout(() => { hideLoad(); ready = true; clearTimeout(to); }, 100); });
    if (window.ActivityGate && !window.ActivityGate.isInitialized()) window.ActivityGate.init(cfg);
  }

  function calcTime(type, n) {
    const MIN = 300;
    if (type === 'match') return Math.max(MIN, n * 30);
    if (type === 'scenario') return Math.max(MIN, n * 60);
    if (type === 'escape') return Math.max(MIN, n * 75);
    return MIN;
  }

  function register(type, listKey, id, cfg) {
    const t = calcTime(type, (cfg[listKey] || []).length);
    pending[id] = { type, cfg: Object.assign({}, cfg, { timeLimit: t }) };
    const c = document.getElementById(id);
    if (c) c.dataset.estimatedMinutes = Math.round(t / 60);
  }
  const regMatch = (id, cfg) => register('match', 'pairs', id, cfg);
  const regScenario = (id, cfg) => register('scenario', 'scenarios', id, cfg);
  const regEscape = (id, cfg) => register('escape', 'questions', id, cfg);

  function startAct(sk) {
    const cid = sk === 'activity1' ? 'activity-1' : sk === 'activity2' ? 'activity-2' : 'formative';
    const p = pending[cid];
    if (!p) return;
    ctx.current = sk; ctx.runPts = 0;
    if (p.type === 'match') renderMatch(cid, p.cfg);
    else if (p.type === 'scenario') renderScenario(cid, p.cfg);
    else renderEscape(cid, p.cfg);
  }

  function renderBar(title) {
    const bar = document.getElementById('daily-score-bar');
    if (!bar) return;
    const pts = Store.getDailyPoints ? Store.getDailyPoints(ctx.lrn, ctx.subject, ctx.week, ctx.day) : 0;
    bar.innerHTML = `
      <div class="score-bar-left">
        <span class="score-bar-label">Week ${ctx.week} · Day ${ctx.day}</span>
        <span class="score-bar-title">${esc(title)}</span>
      </div>
      <div class="score-bar-right">
        <div class="score-bar-stat"><span class="value" id="sb-points">${pts || 0}</span><span class="label">Points</span></div>
        <div class="score-bar-stat"><span class="value" id="sb-badges">0</span><span class="label">Badges</span></div>
        <div class="score-bar-stat"><span class="value" id="sb-timer">00:00</span><span class="label">Time</span></div>
      </div>`;
  }

  function liveTimer() {
    const el = document.getElementById('sb-timer');
    if (!el) return;
    setInterval(() => { el.textContent = APP.formatTime(Math.floor((Date.now() - ctx.startTime) / 1000)); }, 1000);
  }

  function addPts(n) { ctx.runPts += n; }

  // End of a run: keep the best run of this activity; daily points = sum of best runs
  function commitPoints() {
    if (!ctx.current) return;
    let total = ctx.runPts;
    if (Store.setDailyPointsBest) total = Store.setDailyPointsBest(ctx.lrn, ctx.subject, ctx.week, ctx.day, ctx.current, ctx.runPts);
    const el = document.getElementById('sb-points');
    if (el) el.textContent = total;
  }

  function awardBadge(id, name, icon) {
    if (!id || ctx.badges.indexOf(id) !== -1) return;
    if (Store.awardBadge(ctx.lrn, ctx.subject, id)) {
      ctx.badges.push(id);
      const el = document.getElementById('sb-badges');
      if (el) el.textContent = ctx.badges.length;
      APP.toast('🏆 ' + (icon || '') + ' ' + (name || ''), 'success', 4000);
    }
  }

  function showLoad() {
    if (document.getElementById('lesson-loading-overlay')) return;
    const o = document.createElement('div');
    o.id = 'lesson-loading-overlay';
    o.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(255,255,255,0.92);display:flex;align-items:center;justify-content:center;';
    o.innerHTML = '<div style="text-align:center;max-width:320px;padding:24px;"><div style="font-size:2.5rem;">⏳</div><div style="font-size:1.1rem;font-weight:600;color:#1b7a3d;margin-top:12px;">Loading activities...</div></div>';
    document.body.appendChild(o);
  }
  function hideLoad() {
    const o = document.getElementById('lesson-loading-overlay');
    if (o) { o.style.opacity = '0'; setTimeout(() => o.remove(), 300); }
  }
  function showTimeout() {
    const o = document.getElementById('lesson-loading-overlay');
    if (!o) return;
    o.innerHTML = '<div style="text-align:center;max-width:380px;padding:24px;"><div style="font-size:2.5rem;">📡</div><div style="font-size:1.1rem;font-weight:600;color:#c62828;margin-top:12px;">Slow connection</div><button onclick="location.reload()" style="margin-top:16px;padding:10px 20px;background:#1b7a3d;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">🔄 Retry</button></div>';
  }

  // A pausable countdown shared by the three activity types
  function countdown(seconds, el, onEnd) {
    let left = seconds, paused = false;
    const iv = setInterval(() => {
      if (paused) return;
      left--;
      const n = typeof el === 'function' ? el() : el;
      if (n) n.textContent = APP.formatTime(Math.max(0, left));
      if (left <= 0) { clearInterval(iv); onEnd(); }
    }, 1000);
    return { pause: () => { paused = true; }, resume: () => { paused = false; }, stop: () => clearInterval(iv), left: () => left };
  }

  function feedbackBox(ok, correctText, why, onNext, nextLabel) {
    const box = document.createElement('div');
    box.className = 'activity-feedback';
    box.style.cssText = `margin-top:14px;padding:14px 16px;border-radius:10px;border:2px solid ${ok ? '#2e7d32' : '#c62828'};background:${ok ? '#e8f5e9' : '#ffebee'};text-align:left;`;
    box.innerHTML = `<div style="font-weight:700;color:${ok ? '#1b5e20' : '#b71c1c'};">${ok ? '✅ Correct!' : '❌ Not quite.'}</div>
      ${!ok && correctText ? `<div style="margin-top:6px;font-size:0.9rem;"><strong>Answer:</strong> ${esc(correctText)}</div>` : ''}
      ${why ? `<div style="margin-top:6px;font-size:0.9rem;color:#37474f;">💡 ${esc(why)}</div>` : ''}
      <button class="btn btn-primary" style="margin-top:10px;">${nextLabel || 'Next →'}</button>`;
    box.querySelector('button').addEventListener('click', onNext);
    return box;
  }

  function finish(cid, pct, badge) {
    commitPoints();
    if (pct >= PASS && badge && badge.id) awardBadge(badge.id, badge.name, badge.icon);
    if (window.ActivityGate) window.ActivityGate.completeWithScore(cid, pct);
    APP.toast(pct >= PASS ? '🎉 Passed ' + pct + '%' : '📖 Score ' + pct + '% — need ' + PASS + '%', pct >= PASS ? 'success' : 'warning', 4000);
  }

  /* ---------- Activity 1: match the pairs ---------- */
  function renderMatch(cid, cfg) {
    const c = document.getElementById(cid);
    if (!c) return;
    const pairs = cfg.pairs || [];
    const pointsCorrect = cfg.pointsCorrect || 10;
    const pointsWrong = cfg.pointsWrong || -3;
    const L = shuffle(pairs), R = shuffle(pairs);
    let sel = null, matches = 0, wrong = 0, done = false;

    c.innerHTML = `
      <div class="activity-header"><span class="activity-title">🔗 Match the pairs</span><span class="activity-timer" id="${cid}-t">${APP.formatTime(cfg.timeLimit)}</span></div>
      <div class="match-grid"><div class="match-column"><h4>Term</h4><div class="m-left"></div></div><div class="match-column"><h4>Meaning</h4><div class="m-right"></div></div></div>
      <div class="text-center mt-md"><span class="badge badge-info m-score">Matches: 0 / ${pairs.length}</span></div>
      <div class="m-review"></div>`;
    const le = c.querySelector('.m-left'), re = c.querySelector('.m-right');
    L.forEach((it) => { const e = APP.el('div', { class: 'match-item', 'data-key': it.key, text: cleanLabel(it.left) }); e.onclick = () => onL(e); le.appendChild(e); });
    R.forEach((it) => { const e = APP.el('div', { class: 'match-item', 'data-key': it.key, text: cleanLabel(it.right) }); e.onclick = () => onR(e); re.appendChild(e); });
    const timer = countdown(cfg.timeLimit, () => document.getElementById(cid + '-t'), () => end());

    function onL(e) {
      if (done || e.classList.contains('correct')) return;
      le.querySelectorAll('.match-item').forEach((n) => n.classList.remove('selected'));
      e.classList.add('selected'); sel = e;
    }
    function onR(e) {
      if (done || !sel || e.classList.contains('correct')) return;
      if (sel.dataset.key === e.dataset.key) {
        sel.classList.remove('selected'); sel.classList.add('correct'); e.classList.add('correct');
        addPts(pointsCorrect); matches++;
        c.querySelector('.m-score').textContent = 'Matches: ' + matches + ' / ' + pairs.length;
        if (matches === pairs.length) end();
      } else {
        e.classList.add('wrong'); sel.classList.add('wrong');
        addPts(pointsWrong); wrong++;
        const s = sel;
        setTimeout(() => { s.classList.remove('wrong', 'selected'); e.classList.remove('wrong'); }, 500);
      }
      sel = null;
    }
    function end() {
      if (done) return;
      done = true; timer.stop();
      // accuracy: each wrong try costs half a pair
      const pct = Math.max(0, Math.round(((matches - wrong * 0.5) / pairs.length) * 100));
      if (pct >= PASS && wrong === 0) awardBadge((cfg.badgeId || 'match') + '-flawless', 'Flawless', '🎯');
      const rev = c.querySelector('.m-review');
      const withWhy = pairs.filter((p) => explanationOf(p));
      rev.innerHTML = `<div style="margin-top:14px;padding:14px 16px;border-radius:10px;background:#f1f8e9;border:1px solid #c5e1a5;text-align:left;">
        <div style="font-weight:700;color:#33691e;">📘 Review: ${matches}/${pairs.length} matched${wrong ? ', ' + wrong + ' wrong tr' + (wrong === 1 ? 'y' : 'ies') : ''}</div>
        <ul style="margin:8px 0 0 18px;font-size:0.88rem;line-height:1.55;">${pairs.map((p) => `<li><strong>${esc(cleanLabel(p.left))}</strong> → ${esc(cleanLabel(p.right))}${explanationOf(p) ? `<br><span style="color:#546e7a;">💡 ${esc(explanationOf(p))}</span>` : ''}</li>`).join('')}</ul>
        ${withWhy.length ? '' : ''}</div>`;
      finish(cid, pct, { id: cfg.badgeId, name: cfg.badgeName, icon: cfg.badgeIcon });
    }
  }

  /* ---------- Activity 2: scenario cards ---------- */
  function renderScenario(cid, cfg) {
    const c = document.getElementById(cid);
    if (!c) return;
    const scenarios = cfg.scenarios || [];
    const pointsCorrect = cfg.pointsCorrect || 8;
    let i = 0, correct = 0, done = false;
    c.innerHTML = `<div class="activity-header"><span class="activity-title">🎯 Scenario</span><span class="activity-timer" id="${cid}-t">${APP.formatTime(cfg.timeLimit)}</span></div><div class="scen-body"></div>`;
    const timer = countdown(cfg.timeLimit, () => document.getElementById(cid + '-t'), () => end());
    renderCard();

    function renderCard() {
      if (done) return;
      if (i >= scenarios.length) return end();
      const sc = scenarios[i];
      const b = c.querySelector('.scen-body');
      b.innerHTML = `<div class="scenario-card"><p class="scenario-text">${sc.text}</p><div class="choice-row"></div></div><div class="text-center mt-md"><span class="badge badge-info">${i + 1} / ${scenarios.length}</span></div>`;
      const row = b.querySelector('.choice-row');
      shuffle(sc.choices || []).forEach((ch) => {
        const btn = APP.el('button', { class: 'choice-btn', text: cleanLabel(ch.label) });
        btn.onclick = () => onCh(btn, ch, sc);
        row.appendChild(btn);
      });
    }
    function onCh(btn, ch, sc) {
      if (done) return;
      c.querySelectorAll('.choice-btn').forEach((x) => { x.disabled = true; });
      const right = (sc.choices || []).find((x) => x.correct);
      if (ch.correct) { btn.classList.add('correct'); addPts(pointsCorrect); correct++; }
      else {
        btn.classList.add('wrong');
        c.querySelectorAll('.choice-btn').forEach((x) => { if (right && x.textContent === cleanLabel(right.label)) x.classList.add('correct'); });
      }
      timer.pause();
      c.querySelector('.scenario-card').appendChild(feedbackBox(!!ch.correct, right ? cleanLabel(right.label) : '', explanationOf(sc), () => { timer.resume(); i++; renderCard(); },
        i + 1 >= scenarios.length ? 'Finish' : 'Next →'));
    }
    function end() {
      if (done) return;
      done = true; timer.stop();
      finish(cid, Math.round((correct / Math.max(1, scenarios.length)) * 100), { id: cfg.badgeId, name: cfg.badgeName, icon: cfg.badgeIcon });
    }
  }

  /* ---------- Formative: escape room ---------- */
  function renderEscape(cid, cfg) {
    const c = document.getElementById(cid);
    if (!c) return;
    const questions = cfg.questions || [];
    const lives = cfg.lives || 3;
    let cl = lives, keys = 0, i = 0, done = false, timer = null;

    c.innerHTML = `<div class="escape-container"><div class="escape-header"><div><div class="score-bar-label">Formative</div><div style="font-size:1.2rem;font-weight:600;">🔐 Escape</div></div></div>
      <div class="escape-result"><div class="result-emoji">🗝️</div><div class="result-title">Unlock ${questions.length} keys</div>
      <p class="result-message">${lives} lives · ${PASS}% to pass · ⏱️ ${APP.formatTime(cfg.timeLimit)}</p>
      <button class="btn btn-accent esc-go" style="margin-top:16px;">Begin →</button></div></div>`;
    c.querySelector('.esc-go').onclick = () => {
      timer = countdown(cfg.timeLimit, () => document.getElementById(cid + '-t'), () => end());
      showQ();
    };

    function showQ() {
      if (done) return;
      if (i >= questions.length || cl <= 0) return end();
      const q = questions[i];
      c.innerHTML = `<div class="escape-container"><div class="escape-header"><div><div class="score-bar-label">Q${i + 1} / ${questions.length}</div></div>
        <div style="text-align:right;"><div class="escape-lives">${'❤️'.repeat(cl)}${'🖤'.repeat(lives - cl)}</div><div class="activity-timer" id="${cid}-t" style="font-size:0.9rem;">${APP.formatTime(Math.max(0, timer.left()))}</div></div></div>
        <div class="escape-keys" style="justify-content:center;margin-bottom:12px;">${questions.map((_, j) => `<span class="key-icon ${j < keys ? 'earned' : ''}">🗝️</span>`).join('')}</div>
        <div class="escape-question"><h4>${q.text}</h4><div class="escape-options"></div></div></div>`;
      const o = c.querySelector('.escape-options');
      shuffle(q.choices || []).forEach((ch, j) => {
        const b = APP.el('button', { class: 'escape-option', text: String.fromCharCode(65 + j) + '. ' + cleanLabel(ch.label) });
        b.onclick = () => ans(b, ch, q);
        o.appendChild(b);
      });
    }
    function ans(btn, ch, q) {
      if (done) return;
      c.querySelectorAll('.escape-option').forEach((b) => { b.disabled = true; });
      const right = (q.choices || []).find((x) => x.correct);
      if (ch.correct) { btn.classList.add('correct'); keys++; addPts(10); }
      else {
        btn.classList.add('wrong'); cl--;
        c.querySelectorAll('.escape-option').forEach((b) => { if (right && b.textContent.slice(3) === cleanLabel(right.label)) b.classList.add('correct'); });
      }
      timer.pause();
      const last = i + 1 >= questions.length || cl <= 0;
      c.querySelector('.escape-question').appendChild(feedbackBox(!!ch.correct, right ? cleanLabel(right.label) : '', explanationOf(q), () => { timer.resume(); i++; showQ(); },
        last ? 'See result' : 'Next →'));
    }
    function end() {
      if (done) return;
      done = true;
      if (timer) timer.stop();
      const pct = Math.round((keys / Math.max(1, questions.length)) * 100);
      if (pct >= PASS) {
        if (cl === lives) awardBadge(cfg.badgeId, cfg.badgeName, cfg.badgeIcon);
        Store.markDayComplete(ctx.lrn, ctx.subject, ctx.week, ctx.day);
      }
      c.innerHTML = `<div class="escape-container"><div class="escape-result"><div class="result-emoji">${pct >= PASS ? '🎉' : '📖'}</div>
        <div class="result-title">${keys} / ${questions.length} keys</div><p class="result-message">${pct}% ${pct >= PASS ? '— Day complete!' : '— need ' + PASS + '%'}</p></div></div>`;
      finish(cid, pct, null);
    }
  }

  return { init, addPoints: addPts, awardBadge, renderMatchGame: regMatch, renderScenarioGame: regScenario, renderEscapeRoom: regEscape };
})();

window.ActivityGate = ActivityGate;
window.Lesson = Lesson;
