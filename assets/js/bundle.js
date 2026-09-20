/* ============================================================
   bundle.js — Combined script for slow connections
   Version: 2.3.7
   ------------------------------------------------------------
   Changelog:
   - 2.3.7: version sync with CONFIG, cleanLabel on match items
   - 2.3.6: strip "✓" from scenario choice labels
   ============================================================ */

/* ---------- SECTION 1: CONFIG ---------- */
const CONFIG = {
  APP_NAME: 'General Biology Online Modular Application',
  VERSION: '2.3.7',
  DEVELOPER: {
    name: 'JEMUEL C. MARI, MAN, RN, LPT',
    position: 'Senior High School Teacher · Teacher II',
    school: 'Iba High School',
    division: 'Schools Division of Tarlac Province',
    district: 'San Jose West District',
    region: 'Region III',
    department: 'Department of Education'
  },
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbyi2fj-Jnmlk7Pp4qhtfuE_lz0zSewtLfRPiAZnPO5A-uA5ICvicE_DPUry_lax69ubuQ/exec',
  get backendEnabled() { return this.BACKEND_URL && this.BACKEND_URL.length > 20; },
  TEACHER_PASSWORD_HASH: '01d58c1ac3df6d023d869e50bf78e2f9185332c281f665fd53f6dbd7592df45e',
  TEACHER_SESSION_TIMEOUT: 30 * 60 * 1000,
  TEACHER_MAX_ATTEMPTS: 3,
  TEACHER_LOCKOUT_TIME: 5 * 60 * 1000
};

/* ---------- SECTION 2: APP ---------- */
const APP = (() => {
  'use strict';
  const VERSION = CONFIG.VERSION;
  const APP_NAME = CONFIG.APP_NAME;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
      else n.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (typeof c === 'string') n.appendChild(document.createTextNode(c));
      else if (c) n.appendChild(c);
    });
    return n;
  }

  function toast(msg, type = 'info', duration = 3000) {
    const container = $('#toast-container') || (() => {
      const c = el('div', { id: 'toast-container', style: 'position:fixed;top:80px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;' });
      document.body.appendChild(c);
      return c;
    })();
    const colors = { success: '#2e7d32', warning: '#ed6c02', danger: '#c62828', info: '#0277bd' };
    const t = el('div', {
      style: `background:${colors[type] || colors.info};color:#fff;padding:12px 20px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.2);font-size:0.9rem;font-weight:500;max-width:320px;`,
      text: msg
    });
    container.appendChild(t);
    setTimeout(() => t.remove(), duration);
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  function formatLRN(lrn) { return String(lrn).replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3'); }
  function toTitleCase(str) {
    if (!str) return '';
    return str.toString().trim().toLowerCase().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  function toLastNameFormat(str) { return str ? str.toString().trim().toUpperCase() : ''; }
  function formatFullName(l, f, m) {
    const L = toLastNameFormat(l), F = toTitleCase(f), M = m ? ' ' + toTitleCase(m) : '';
    return `${L}, ${F}${M}`.trim();
  }
  function validateLRN(lrn) { return /^\d{12}$/.test(String(lrn).replace(/\D/g, '')); }

  function init() {
    console.log(`[${APP_NAME}] v${VERSION}`);
    $$('.version').forEach((e) => (e.textContent = `v${VERSION}`));
  }

  return { VERSION, APP_NAME, $, $$, el, toast, formatTime, formatLRN, toTitleCase, toLastNameFormat, formatFullName, validateLRN, init };
})();

/* ---------- SECTION 3: STORE ---------- */
const Store = (() => {
  'use strict';
  const NS = 'gba_v1_';
  function _get(k, fb = null) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } }
  function _set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
  function _rm(k) { try { localStorage.removeItem(k); } catch {} }
  function getAllUsers() { return _get(`${NS}users`, []); }
  function saveUser(u) {
    const list = getAllUsers();
    const i = list.findIndex((x) => x.lrn === u.lrn);
    if (i >= 0) list[i] = { ...list[i], ...u }; else list.push(u);
    _set(`${NS}users`, list);
    return u;
  }
  function getUser(lrn) { return getAllUsers().find((u) => u.lrn === lrn) || null; }
  function setSession(lrn) { _set(`${NS}session`, { lrn, startedAt: Date.now() }); }
  function getSession() { return _get(`${NS}session`, null); }
  function clearSession() { _rm(`${NS}session`); }
  function getCurrentUser() { const s = getSession(); return s ? getUser(s.lrn) : null; }
  function getProgress(lrn) { return _get(`${NS}progress_${lrn}`, { biol1: { weeks: {}, completed: [] }, biol2: { weeks: {}, completed: [] } }); }
  function saveProgress(lrn, p) { _set(`${NS}progress_${lrn}`, p); }
  function markDayComplete(lrn, subj, w, d) {
    const p = getProgress(lrn);
    if (!p[subj]) p[subj] = { weeks: {}, completed: [] };
    if (!p[subj].weeks[w]) p[subj].weeks[w] = {};
    p[subj].weeks[w][d] = { completed: true, completedAt: new Date().toISOString() };
    const key = `${subj}-w${w}-d${d}`;
    if (!p[subj].completed.includes(key)) p[subj].completed.push(key);
    saveProgress(lrn, p);
  }
  function getScores(lrn) {
    return _get(`${NS}scores_${lrn}`, { biol1: { quizzes: {}, st: {}, pt: {}, te: null }, biol2: { quizzes: {}, st: {}, pt: {}, te: null } });
  }
  function saveScore(lrn, subj, type, id, data) {
    const s = getScores(lrn);
    if (!s[subj]) s[subj] = {};
    if (!s[subj][type]) s[subj][type] = {};
    s[subj][type][id] = { ...data, timestamp: new Date().toISOString() };
    _set(`${NS}scores_${lrn}`, s);
    return s[subj][type][id];
  }
  function getBadges(lrn) { return _get(`${NS}badges_${lrn}`, { biol1: [], biol2: [] }); }
  function awardBadge(lrn, subj, id) {
    const b = getBadges(lrn);
    if (!b[subj]) b[subj] = [];
    if (!b[subj].includes(id)) {
      b[subj].push(id);
      _set(`${NS}badges_${lrn}`, b);
      return true;
    }
    return false;
  }
  function addDailyPoints(lrn, subj, w, d, pts) {
    const key = `${NS}points_${lrn}_${subj}_w${w}_d${d}`;
    const cur = _get(key, 0);
    const next = cur + pts;
    _set(key, next);
    return next;
  }
  function isAssessmentLocked(lrn, id) { const l = _get(`${NS}lock_${lrn}_${id}`, null); return l && l.locked; }
  function lockAssessment(lrn, id, data) { _set(`${NS}lock_${lrn}_${id}`, { locked: true, ...data, lockedAt: new Date().toISOString() }); }
  function unlockAssessment(lrn, id) { _rm(`${NS}lock_${lrn}_${id}`); }

  return { getAllUsers, saveUser, getUser, setSession, getSession, clearSession, getCurrentUser,
    getProgress, saveProgress, markDayComplete, getScores, saveScore,
    getBadges, awardBadge, addDailyPoints, isAssessmentLocked, lockAssessment, unlockAssessment };
})();

/* ---------- SECTION 4: ACTIVITY GATE ---------- */
const ActivityGate = (() => {
  'use strict';
  const STORAGE_KEY = 'gba_gate_v2_';
  const PASS = 0.75;
  let session = null, inited = false;

  function init(cfg) {
    if (inited) { console.log('[ActivityGate] Already initialized'); return; }
    console.log('[ActivityGate] init() with:', cfg);
    session = {
      key: `${STORAGE_KEY}${cfg.subject}_w${cfg.week}_d${cfg.day}`,
      subject: cfg.subject, week: cfg.week, day: cfg.day,
      states: {
        activity1: { status: 'ready', score: 0, attempts: 0 },
        activity2: { status: 'locked', score: 0, attempts: 0 },
        formative: { status: 'locked', score: 0, attempts: 0 }
      }
    };
    const saved = sessionStorage.getItem(session.key);
    if (saved) { try { Object.assign(session.states, JSON.parse(saved).states); } catch {} }
    console.log('[ActivityGate] Session:', session.key, session.states);
    inited = true;
    setTimeout(() => { console.log('[ActivityGate] applyUI()'); applyUI(); }, 10);
    setTimeout(() => { console.log('[ActivityGate] Fire ready'); document.dispatchEvent(new CustomEvent('activity-gate:ready')); }, 30);
  }

  function save() {
    if (!session) return;
    try { sessionStorage.setItem(session.key, JSON.stringify({ states: session.states })); } catch {}
  }

  function markRunning(id) {
    const k = normalize(id);
    if (!session || session.states[k].status === 'passed') return;
    session.states[k].status = 'running';
    save(); applyUI();
  }

  function completeWithScore(id, pct) {
    if (!session) return;
    const k = normalize(id);
    const st = session.states[k];
    st.attempts = (st.attempts || 0) + 1;
    st.score = Math.round(pct);
    if (pct >= PASS * 100) {
      st.status = 'passed';
      if (k === 'activity1') { session.states.activity2.status = 'ready'; APP.toast('✅ Activity 1 passed!', 'success', 4000); }
      else if (k === 'activity2') { session.states.formative.status = 'ready'; APP.toast('✅ Activity 2 passed!', 'success', 4000); }
      else { APP.toast('🎉 Formative complete!', 'success', 4000); }
    } else {
      st.status = 'failed';
    }
    save(); applyUI();
  }

  function reset(id) {
    if (!session) return;
    session.states[normalize(id)].status = 'ready';
    save(); applyUI();
  }

  function applyUI() {
    applyStage('activity-1', 'activity1');
    applyStage('activity-2', 'activity2');
    applyStage('formative', 'formative');
  }

  function applyStage(cid, sk) {
    const c = document.getElementById(cid);
    if (!c || !session) return;
    const pc = c.closest('.activity-card') || c.parentElement;
    if (!pc) return;
    const st = session.states[sk];
    pc.querySelectorAll('.gate-overlay').forEach((e) => e.remove());
    if (st.status === 'locked') { c.style.display = 'none'; pc.appendChild(mkLocked()); }
    else if (st.status === 'ready') { c.style.display = 'none'; pc.appendChild(mkReady(sk, st)); }
    else if (st.status === 'running') { c.style.display = ''; }
    else if (st.status === 'passed') { c.style.display = 'none'; pc.appendChild(mkPassed(sk, st)); }
    else if (st.status === 'failed') { c.style.display = 'none'; pc.appendChild(mkFailed(sk, st)); }
  }

  function mkLocked() {
    const e = document.createElement('div');
    e.className = 'gate-overlay';
    e.style.cssText = 'padding:32px 24px;text-align:center;background:#f8f9fa;border:2px dashed #dadce0;border-radius:8px;';
    e.innerHTML = `<div style="font-size:2rem;">🔒</div><div style="font-weight:600;margin-top:8px;color:#1b7a3d;">Locked</div><div style="font-size:0.85rem;margin-top:4px;color:#5f6368;">Complete the previous activity with at least 75% to unlock.</div>`;
    return e;
  }

  function mkReady(sk, st) {
    const e = document.createElement('div');
    e.className = 'gate-overlay';
    e.style.cssText = 'padding:32px 24px;text-align:center;background:linear-gradient(135deg,#e8f5e9,#c8e6c9);border:2px solid #4caf50;border-radius:8px;';
    const titles = { activity1: 'Activity 1 — Match the Pairs', activity2: 'Activity 2 — Scenario Challenge', formative: 'Formative — Escape the Cell' };
    const cid = sk === 'activity1' ? 'activity-1' : sk === 'activity2' ? 'activity-2' : 'formative';
    const c = document.getElementById(cid);
    const mins = c?.dataset.estimatedMinutes || 5;
    e.innerHTML = `
      <div style="font-size:2.5rem;">▶️</div>
      <div style="font-weight:700;margin-top:12px;color:#1b5e20;font-size:1.1rem;">${titles[sk]}</div>
      <div style="font-size:0.85rem;margin-top:8px;color:#2e7d32;">⏱️ ${mins} min · 🎯 75% to pass · ♻️ Unlimited retakes</div>
      <button class="btn btn-primary" style="margin-top:16px;padding:12px 28px;" data-start="${sk}">▶️ Start Activity</button>
    `;
    setTimeout(() => { e.querySelector(`[data-start="${sk}"]`)?.addEventListener('click', () => start(sk)); }, 0);
    return e;
  }

  function mkPassed(sk, st) {
    const e = document.createElement('div');
    e.className = 'gate-overlay';
    e.style.cssText = 'padding:24px;text-align:center;background:linear-gradient(135deg,#e8f5e9,#a5d6a7);border:2px solid #2e7d32;border-radius:8px;';
    e.innerHTML = `<div style="font-size:2rem;">✅</div><div style="font-weight:700;margin-top:8px;color:#1b5e20;">Passed!</div><div style="font-size:0.9rem;margin-top:6px;color:#2e7d32;">Score: ${st.score}% · Attempts: ${st.attempts}</div>`;
    return e;
  }

  function mkFailed(sk, st) {
    const e = document.createElement('div');
    e.className = 'gate-overlay';
    e.style.cssText = 'padding:32px 24px;text-align:center;background:linear-gradient(135deg,#fff3e0,#ffe0b2);border:2px solid #ed6c02;border-radius:8px;';
    e.innerHTML = `
      <div style="font-size:2.5rem;">🔁</div>
      <div style="font-weight:700;margin-top:8px;color:#e65100;font-size:1.1rem;">Try Again!</div>
      <div style="font-size:0.95rem;margin-top:8px;color:#ef6c00;">Score: ${st.score}% — need 75% to pass</div>
      <button class="btn btn-primary" style="margin-top:16px;padding:12px 28px;" data-start="${sk}">🔁 Retake</button>
    `;
    setTimeout(() => { e.querySelector(`[data-start="${sk}"]`)?.addEventListener('click', () => start(sk)); }, 0);
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

  return { init, markRunning, completeWithScore, reset, applyUI, PASS, isInitialized: () => inited, complete: (id) => completeWithScore(id, 100), applyLocks: applyUI };
})();

/* ---------- SECTION 5: LESSON ENGINE ---------- */
const Lesson = (() => {
  'use strict';
  let ctx = null;
  let pending = {};
  let ready = false;
  let to = null;

  /* Strip "✓" and similar marker characters */
  function cleanLabel(label) {
    if (typeof label !== 'string') return label;
    return label
      .replace(/[✓✔✅☑]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function init(cfg) {
    console.log('[Lesson] init() with:', cfg);
    const user = Store.getCurrentUser();
    console.log('[Lesson] user:', user ? user.lrn : 'NULL');
    if (!user) { window.location.href = '../../../student/login.html'; return; }
    ctx = { lrn: user.lrn, subject: cfg.subject, week: cfg.week, day: cfg.day, points: 0, badges: [], startTime: Date.now() };
    renderBar(cfg.title);
    liveTimer();
    showLoad();
    to = setTimeout(() => { if (!ready) showTimeout(); }, 15000);
    document.addEventListener('activity:start', (e) => startAct(e.detail.activity));
    document.addEventListener('activity-gate:ready', () => {
      console.log('[Lesson] Got activity-gate:ready');
      setTimeout(() => { hideLoad(); ready = true; clearTimeout(to); }, 100);
    });
    console.log('[Lesson] window.ActivityGate type:', typeof window.ActivityGate);
    if (window.ActivityGate && !window.ActivityGate.isInitialized()) {
      console.log('[Lesson] Calling ActivityGate.init()');
      window.ActivityGate.init(cfg);
    } else {
      console.log('[Lesson] Skipped ActivityGate.init()');
    }
  }

  function calcTime(type, n) {
    const MIN = 300;
    if (type === 'match') return Math.max(MIN, n * 20);
    if (type === 'scenario') return Math.max(MIN, n * 25);
    if (type === 'escape') return Math.max(MIN, n * 60);
    return MIN;
  }

  function regMatch(id, cfg) {
    const t = calcTime('match', cfg.pairs.length);
    pending[id] = { type: 'match', cfg: { ...cfg, timeLimit: t } };
    const c = document.getElementById(id);
    if (c) c.dataset.estimatedMinutes = Math.round(t / 60);
  }
  function regScenario(id, cfg) {
    const t = calcTime('scenario', cfg.scenarios.length);
    pending[id] = { type: 'scenario', cfg: { ...cfg, timeLimit: t } };
    const c = document.getElementById(id);
    if (c) c.dataset.estimatedMinutes = Math.round(t / 60);
  }
  function regEscape(id, cfg) {
    const t = calcTime('escape', cfg.questions.length);
    pending[id] = { type: 'escape', cfg: { ...cfg, timeLimit: t } };
    const c = document.getElementById(id);
    if (c) c.dataset.estimatedMinutes = Math.round(t / 60);
  }

  function startAct(sk) {
    const cid = sk === 'activity1' ? 'activity-1' : sk === 'activity2' ? 'activity-2' : 'formative';
    const p = pending[cid];
    if (!p) { console.warn('[Lesson] No pending for', cid); return; }
    if (p.type === 'match') renderMatch(cid, p.cfg);
    else if (p.type === 'scenario') renderScenario(cid, p.cfg);
    else renderEscape(cid, p.cfg);
  }

  function renderBar(title) {
    const bar = document.getElementById('daily-score-bar');
    if (!bar) return;
    bar.innerHTML = `
      <div class="score-bar-left">
        <span class="score-bar-label">Week ${ctx.week} · Day ${ctx.day}</span>
        <span class="score-bar-title">${title}</span>
      </div>
      <div class="score-bar-right">
        <div class="score-bar-stat"><span class="value" id="sb-points">0</span><span class="label">Points</span></div>
        <div class="score-bar-stat"><span class="value" id="sb-badges">0</span><span class="label">Badges</span></div>
        <div class="score-bar-stat"><span class="value" id="sb-timer">00:00</span><span class="label">Time</span></div>
      </div>
    `;
  }

  function liveTimer() {
    const el = document.getElementById('sb-timer');
    if (!el) return;
    setInterval(() => { el.textContent = APP.formatTime(Math.floor((Date.now() - ctx.startTime) / 1000)); }, 1000);
  }

  function addPts(n) {
    ctx.points += n;
    const el = document.getElementById('sb-points');
    if (el) el.textContent = ctx.points;
    Store.addDailyPoints(ctx.lrn, ctx.subject, ctx.week, ctx.day, n);
  }

  function awardBadge(id, name, icon) {
    if (ctx.badges.includes(id)) return;
    if (Store.awardBadge(ctx.lrn, ctx.subject, id)) {
      ctx.badges.push(id);
      const el = document.getElementById('sb-badges');
      if (el) el.textContent = ctx.badges.length;
      APP.toast(`🏆 ${icon} ${name}`, 'success', 4000);
    }
  }

  function showLoad() {
    if (document.getElementById('lesson-loading-overlay')) return;
    const o = document.createElement('div');
    o.id = 'lesson-loading-overlay';
    o.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(255,255,255,0.92);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;';
    o.innerHTML = `
      <div style="text-align:center;max-width:320px;padding:24px;">
        <div style="font-size:2.5rem;">⏳</div>
        <div style="font-size:1.1rem;font-weight:600;color:#1b7a3d;margin-top:12px;">Loading activities...</div>
        <div style="font-size:0.85rem;color:#5f6368;margin-top:8px;">This may take a moment on slow connection.</div>
      </div>
    `;
    document.body.appendChild(o);
  }

  function hideLoad() {
    const o = document.getElementById('lesson-loading-overlay');
    if (o) { o.style.opacity = '0'; setTimeout(() => o.remove(), 300); }
  }

  function showTimeout() {
    const o = document.getElementById('lesson-loading-overlay');
    if (!o) return;
    o.innerHTML = `
      <div style="text-align:center;max-width:380px;padding:24px;">
        <div style="font-size:2.5rem;">📡</div>
        <div style="font-size:1.1rem;font-weight:600;color:#c62828;margin-top:12px;">Slow connection</div>
        <button onclick="location.reload()" style="margin-top:16px;padding:10px 20px;background:#1b7a3d;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">🔄 Retry</button>
      </div>
    `;
  }

  function renderMatch(cid, cfg) {
    const c = document.getElementById(cid);
    if (!c) return;
    const { pairs, timeLimit, pointsCorrect = 10, pointsWrong = -3, badgeId, badgeName, badgeIcon } = cfg;
    let L = [...pairs].sort(() => Math.random() - 0.5);
    let R = [...pairs].sort(() => Math.random() - 0.5);
    let sel = null, matches = 0, wrong = 0, tLeft = timeLimit, interval = null, done = false;
    c.innerHTML = `
      <div class="activity-header"><span class="activity-title">🔗 Match the pairs</span><span class="activity-timer" id="match-timer">${APP.formatTime(tLeft)}</span></div>
      <div class="match-grid"><div class="match-column"><h4>Left</h4><div id="match-left"></div></div><div class="match-column"><h4>Right</h4><div id="match-right"></div></div></div>
      <div class="text-center mt-md"><span id="match-score" class="badge badge-info">Matches: 0 / ${pairs.length}</span></div>
    `;
    const le = c.querySelector('#match-left'), re = c.querySelector('#match-right');
    L.forEach((it) => { const e = APP.el('div', { class: 'match-item', 'data-key': it.key, text: cleanLabel(it.left) }); e.onclick = () => onL(e); le.appendChild(e); });
    R.forEach((it) => { const e = APP.el('div', { class: 'match-item', 'data-key': it.key, text: cleanLabel(it.right) }); e.onclick = () => onR(e); re.appendChild(e); });

    function onL(e) { if (done || e.classList.contains('correct')) return; le.querySelectorAll('.match-item').forEach((n) => n.classList.remove('selected')); e.classList.add('selected'); sel = e; }
    function onR(e) {
      if (done || !sel || e.classList.contains('correct')) return;
      if (sel.dataset.key === e.dataset.key) {
        sel.classList.remove('selected'); sel.classList.add('correct'); e.classList.add('correct');
        addPts(pointsCorrect); matches++; upScore();
        if (matches === pairs.length) end('complete');
      } else {
        e.classList.add('wrong'); sel.classList.add('wrong'); addPts(pointsWrong); wrong++;
        const s = sel; setTimeout(() => { s.classList.remove('wrong', 'selected'); e.classList.remove('wrong'); }, 500);
      }
      sel = null;
    }
    function upScore() { const el = c.querySelector('#match-score'); if (el) el.textContent = `Matches: ${matches} / ${pairs.length}`; }
    function end(reason) {
      if (done) return; done = true; clearInterval(interval);
      const pct = Math.round((matches / pairs.length) * 100);
      if (pct >= 75) { if (wrong === 0) awardBadge(badgeId + '-flawless', 'Flawless', '🎯'); awardBadge(badgeId, badgeName, badgeIcon); }
      if (window.ActivityGate) window.ActivityGate.completeWithScore(cid, pct);
      APP.toast(pct >= 75 ? `🎉 Passed ${pct}%` : `📖 Score ${pct}% — need 75%`, pct >= 75 ? 'success' : 'warning', 4000);
    }
    interval = setInterval(() => {
      tLeft--; const el = c.querySelector('#match-timer'); if (el) el.textContent = APP.formatTime(Math.max(0, tLeft));
      if (tLeft <= 0) end('timeout');
    }, 1000);
  }

  function renderScenario(cid, cfg) {
    const c = document.getElementById(cid);
    if (!c) return;
    const { scenarios, timeLimit, pointsCorrect = 8, badgeId, badgeName, badgeIcon } = cfg;
    let i = 0, correct = 0, done = false, tLeft = timeLimit, interval = null;
    c.innerHTML = `<div class="activity-header"><span class="activity-title">🎯 Scenario</span><span class="activity-timer" id="scen-t">${APP.formatTime(tLeft)}</span></div><div id="scen-body"></div>`;
    renderCard();
    interval = setInterval(() => {
      tLeft--; const el = c.querySelector('#scen-t'); if (el) el.textContent = APP.formatTime(Math.max(0, tLeft));
      if (tLeft <= 0) end('timeout');
    }, 1000);
    function renderCard() {
      if (done) return;
      if (i >= scenarios.length) return end('complete');
      const sc = scenarios[i];
      const b = c.querySelector('#scen-body');
      b.innerHTML = `<div class="scenario-card"><p class="scenario-text">${sc.text}</p><div class="choice-row" id="cr"></div></div><div class="text-center mt-md"><span class="badge badge-info">${i + 1} / ${scenarios.length}</span></div>`;
      const row = b.querySelector('#cr');
      sc.choices.forEach((ch) => {
        const cleanText = cleanLabel(ch.label);
        const btn = APP.el('button', { class: 'choice-btn', text: cleanText });
        btn.onclick = () => onCh(btn, ch);
        row.appendChild(btn);
      });
    }
    function onCh(btn, ch) {
      if (done) return;
      c.querySelectorAll('.choice-btn').forEach((b) => b.disabled = true);
      if (ch.correct) { btn.classList.add('correct'); addPts(pointsCorrect); correct++; }
      else { btn.classList.add('wrong'); }
      setTimeout(() => { i++; renderCard(); }, 1200);
    }
    function end(reason) {
      if (done) return; done = true; clearInterval(interval);
      const pct = Math.round((correct / scenarios.length) * 100);
      if (pct >= 75) awardBadge(badgeId, badgeName, badgeIcon);
      if (window.ActivityGate) window.ActivityGate.completeWithScore(cid, pct);
      APP.toast(pct >= 75 ? `🎉 Passed ${pct}%` : `📖 Score ${pct}% — need 75%`, pct >= 75 ? 'success' : 'warning', 4000);
    }
  }

  function renderEscape(cid, cfg) {
    const c = document.getElementById(cid);
    if (!c) return;
    const { questions, badgeId, badgeName, badgeIcon, lives = 3, timeLimit } = cfg;
    let cl = lives, keys = [], i = 0, locked = false, done = false, tLeft = timeLimit, interval = null;
    intro();
    interval = setInterval(() => {
      tLeft--; const el = document.getElementById('esc-t'); if (el) el.textContent = APP.formatTime(Math.max(0, tLeft));
      if (tLeft <= 0) end('timeout');
    }, 1000);

    function intro() {
      c.innerHTML = `
        <div class="escape-container">
          <div class="escape-header"><div><div class="score-bar-label">Formative</div><div style="font-size:1.2rem;font-weight:600;">🔐 Escape</div></div><div style="text-align:right;"><div class="escape-lives" id="esc-l">${'❤️'.repeat(cl)}</div><div class="activity-timer" id="esc-t" style="font-size:0.9rem;margin-top:4px;">${APP.formatTime(tLeft)}</div></div></div>
          <div class="escape-result"><div class="result-emoji">🗝️</div><div class="result-title">Unlock ${questions.length} keys</div><p class="result-message">Need 75% to pass.</p><button id="esc-go" class="btn btn-accent" style="margin-top:16px;">Begin →</button></div>
        </div>`;
      c.querySelector('#esc-go').onclick = showQ;
    }

    function showQ() {
      if (done) return;
      if (i >= questions.length) return end('complete');
      const q = questions[i];
      c.innerHTML = `
        <div class="escape-container">
          <div class="escape-header"><div><div class="score-bar-label">Q${i + 1} / ${questions.length}</div></div><div style="text-align:right;"><div class="escape-lives">${'❤️'.repeat(cl)}${'🖤'.repeat(lives - cl)}</div><div class="activity-timer" id="esc-t" style="font-size:0.9rem;">${APP.formatTime(Math.max(0, tLeft))}</div></div></div>
          <div class="escape-keys" style="justify-content:center;margin-bottom:12px;">${questions.map((_, j) => `<span class="key-icon ${keys.includes(j) ? 'earned' : ''}">🗝️</span>`).join('')}</div>
          <div class="escape-question"><h4>${q.text}</h4><div class="escape-options" id="esc-o"></div></div>
        </div>`;
      const o = c.querySelector('#esc-o');
      q.choices.forEach((ch, j) => {
        const cleanText = cleanLabel(ch.label);
        const b = APP.el('button', { class: 'escape-option', text: `${String.fromCharCode(65 + j)}. ${cleanText}` });
        b.onclick = () => ans(b, ch);
        o.appendChild(b);
      });
    }

    function ans(btn, ch) {
      if (locked || done) return; locked = true;
      c.querySelectorAll('.escape-option').forEach((b) => b.disabled = true);
      if (ch.correct) { btn.classList.add('correct'); keys.push(i); setTimeout(() => { i++; locked = false; showQ(); }, 900); }
      else {
        btn.classList.add('wrong'); cl--;
        const ci = questions[i].choices.findIndex((x) => x.correct);
        c.querySelectorAll('.escape-option')[ci].classList.add('correct');
        if (cl <= 0) setTimeout(() => end('outoflives'), 1200);
        else setTimeout(() => { locked = false; i++; showQ(); }, 1400);
      }
    }

    function end(reason) {
      if (done) return; done = true; clearInterval(interval);
      const pct = Math.round((keys.length / questions.length) * 100);
      if (pct >= 75) { if (cl === lives) awardBadge(badgeId, badgeName, badgeIcon); Store.markDayComplete(ctx.lrn, ctx.subject, ctx.week, ctx.day); }
      if (window.ActivityGate) window.ActivityGate.completeWithScore(cid, pct);
      APP.toast(pct >= 75 ? `🎉 Passed ${pct}%` : `📖 Score ${pct}% — need 75%`, pct >= 75 ? 'success' : 'warning', 4000);
    }
  }

  return { init, addPoints: addPts, awardBadge, renderMatchGame: regMatch, renderScenarioGame: regScenario, renderEscapeRoom: regEscape };
})();

/* ---------- EXPOSE TO WINDOW ---------- */
window.CONFIG = CONFIG;
window.APP = APP;
window.Store = Store;
window.ActivityGate = ActivityGate;
window.Lesson = Lesson;

document.addEventListener('DOMContentLoaded', () => {
  if (window.APP) APP.init();
});
