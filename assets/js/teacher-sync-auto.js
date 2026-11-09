/* ============================================================
   teacher-sync-auto.js — Auto-sync ng data ng lahat ng estudyante papunta sa teacher pages
   Version: 2.0.0
   ------------------------------------------------------------
   Dati: hindi ito nilo-load ng kahit anong page, at ang cache na sinusulat nito ay walang bumabasa.
   Ngayon: kusang nilo-load ng teacher-auth.js sa lahat ng teacher pages.
   - Kumukuha ng lahat ng estudyante (progress, scores kasama ang Term Exam, badges, points, activities)
     mula sa Google Sheet (action: getAllStudentsAggregated) at minemerge sa localStorage ng teacher
     kaya gumagana agad ang LAHAT ng teacher pages (class record, trackers, item analysis, ...).
   - Una: kapag may bago, isang beses na magre-refresh ang page. Pagkatapos: bawat 60s; may lalabas na
     "Refresh" banner kapag may bagong data (hindi nakaka-istorbo habang nagta-type ang teacher).
   - Token: ang password na ginamit sa teacher-login (naka-save sa sessionStorage).
   - Public API: window.TeacherSync.syncNow({ask}), getToken(ask), setToken(t)
   ============================================================ */
(() => {
  'use strict';
  if (window.__GBA_TSYNC_LOADED) return;
  window.__GBA_TSYNC_LOADED = true;

  const NS = 'gba_v1_';
  const TOKEN_KEY = 'gba_teacher_token';
  const INTERVAL = 60 * 1000;
  const SUBJECTS = ['biol1', 'biol2'];
  let _running = null;
  let _first = true;
  let _lastResult = null;

  const enabled = () => typeof CONFIG !== 'undefined' && CONFIG.backendEnabled;

  function getToken(ask) {
    let t = '';
    try { t = sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { /* ignore */ }
    if (!t && ask) {
      t = prompt('Enter teacher password to sync with the Google Sheet:') || '';
      if (t) setToken(t);
    }
    return t;
  }
  function setToken(t) { try { sessionStorage.setItem(TOKEN_KEY, t); } catch (e) { /* ignore */ } }
  function clearToken() { try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } }

  /* ---------- merge helpers (kapareho ng sync-master.js) ---------- */
  const flat = (o) => !!o && typeof o === 'object' && !Array.isArray(o) &&
    ['score', 'percent', 'total', 'passed'].some((k) => o[k] !== undefined && typeof o[k] !== 'object');
  const ts = (o) => { const t = new Date((o && o.timestamp) || 0).getTime(); return isNaN(t) ? 0 : t; };

  function normalize(scores) {
    const out = {};
    Object.keys(scores || {}).forEach((subj) => {
      const s = scores[subj];
      if (!s || typeof s !== 'object') return;
      out[subj] = {};
      Object.keys(s).forEach((type) => {
        let v = s[type];
        if (v === null || v === undefined) { out[subj][type] = {}; return; }
        if (typeof v !== 'object') return;
        if (type === 'te' && flat(v)) v = { [`${subj}-te`]: v };
        out[subj][type] = v;
      });
    });
    return out;
  }

  function mergeEntry(local, inc) {
    if (!local) return inc;
    if (!inc) return local;
    const lo = local.override, io = inc.override;
    let win;
    if (lo && !io) win = (inc.timestamp || '') > (lo.at || '') ? inc : local;
    else if (io && !lo) win = (local.timestamp || '') > (io.at || '') ? local : inc;
    else if (lo && io) win = (io.at || '') >= (lo.at || '') ? inc : local;
    else if (ts(inc) > ts(local)) win = inc;
    else if (ts(inc) === ts(local) && (Number(inc.score) || 0) > (Number(local.score) || 0)) win = inc;
    else win = local;
    const other = win === local ? inc : local;
    if ((!Array.isArray(win.breakdown) || !win.breakdown.length) && Array.isArray(other.breakdown) && other.breakdown.length && ts(win) === ts(other)) {
      win = Object.assign({}, win, { breakdown: other.breakdown });
    }
    return win;
  }

  function mergeScores(local, incoming) {
    const base = normalize(local), inc = normalize(incoming);
    Object.keys(inc).forEach((subj) => {
      base[subj] = base[subj] || {};
      Object.keys(inc[subj]).forEach((type) => {
        base[subj][type] = base[subj][type] || {};
        Object.keys(inc[subj][type] || {}).forEach((id) => {
          if (inc[subj][type][id]) base[subj][type][id] = mergeEntry(base[subj][type][id], inc[subj][type][id]);
        });
      });
    });
    return base;
  }

  function mergeProgress(local, incoming) {
    const merged = JSON.parse(JSON.stringify(local || {}));
    Object.keys(incoming || {}).forEach((subj) => {
      const inc = incoming[subj];
      if (!inc || typeof inc !== 'object') return;
      if (!merged[subj]) merged[subj] = { completed: [], weeks: {} };
      merged[subj].completed = Array.from(new Set([...(merged[subj].completed || []), ...(inc.completed || [])]));
      merged[subj].weeks = merged[subj].weeks || {};
      Object.keys(inc.weeks || {}).forEach((w) => {
        merged[subj].weeks[w] = Object.assign(merged[subj].weeks[w] || {}, inc.weeks[w]);
      });
    });
    return merged;
  }

  function mergeBadges(local, incoming) {
    const merged = JSON.parse(JSON.stringify(local || {}));
    Object.keys(incoming || {}).forEach((subj) => {
      merged[subj] = Array.from(new Set([...(merged[subj] || []), ...(Array.isArray(incoming[subj]) ? incoming[subj] : [])]));
    });
    return merged;
  }

  function readJson(key, fb) { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fb; } catch (e) { return fb; } }

  // Sinusulat lang kapag nagbago; ibinabalik kung nagbago. Kapag puno na ang storage, subukan nang walang breakdown.
  function writeIfChanged(key, value) {
    const next = JSON.stringify(value);
    if (localStorage.getItem(key) === next) return false;
    try { localStorage.setItem(key, next); return true; }
    catch (e) {
      try {
        const slim = JSON.parse(next);
        Object.keys(slim).forEach((subj) => ['quizzes', 'st', 'te', 'pt'].forEach((t) => {
          Object.keys((slim[subj] || {})[t] || {}).forEach((id) => { if (slim[subj][t][id]) delete slim[subj][t][id].breakdown; });
        }));
        localStorage.setItem(key, JSON.stringify(slim));
        return true;
      } catch (e2) { console.warn('[TeacherSync] storage full for', key); return false; }
    }
  }

  function mergeIntoLocal(students) {
    let changed = 0;
    const users = readJson(`${NS}users`, []);
    const list = Array.isArray(users) ? users : [];
    let usersChanged = false;

    students.forEach((s) => {
      if (!s.lrn) return;
      const lrn = String(s.lrn);

      // user/profile
      const idx = list.findIndex((u) => String(u.lrn) === lrn);
      const prev = idx >= 0 ? list[idx] : { lrn };
      const next = Object.assign({}, prev, {
        lrn,
        lastName: s.lastName || prev.lastName || '', firstName: s.firstName || prev.firstName || '',
        middleName: s.middleName || prev.middleName || '', gradeLevel: s.gradeLevel || prev.gradeLevel || '',
        section: s.section || prev.section || '', sex: s.sex || prev.sex || ''
      });
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        if (idx >= 0) list[idx] = next; else list.push(next);
        usersChanged = true; changed++;
      }

      // progress / scores / badges / points
      if (s.progress && writeIfChanged(`${NS}progress_${lrn}`, mergeProgress(readJson(`${NS}progress_${lrn}`, {}), s.progress))) changed++;
      if (s.scores && writeIfChanged(`${NS}scores_${lrn}`, mergeScores(readJson(`${NS}scores_${lrn}`, {}), s.scores))) changed++;
      if (s.badges && writeIfChanged(`${NS}badges_${lrn}`, mergeBadges(readJson(`${NS}badges_${lrn}`, { biol1: [], biol2: [] }), s.badges))) changed++;
      Object.keys(s.points || {}).forEach((k) => {
        const key = `${NS}points_${lrn}_${k}`;
        const cur = Number(readJson(key, 0)) || 0, inc = Number(s.points[k]) || 0;
        if (inc > cur) { try { localStorage.setItem(key, JSON.stringify(inc)); changed++; } catch (e) { /* full */ } }
      });
    });

    if (usersChanged) { try { localStorage.setItem(`${NS}users`, JSON.stringify(list)); } catch (e) { /* full */ } }
    return changed;
  }

  /* ---------- UI ---------- */
  function showBanner(text, actionLabel, onClick) {
    let el = document.getElementById('gba-tsync-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gba-tsync-banner';
      el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;background:#1b5e20;color:#fff;padding:10px 14px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.25);font:600 13px/1.3 system-ui,sans-serif;display:flex;gap:10px;align-items:center;max-width:340px;';
      document.body.appendChild(el);
    }
    el.innerHTML = '';
    const span = document.createElement('span'); span.textContent = text; el.appendChild(span);
    if (actionLabel) {
      const b = document.createElement('button');
      b.textContent = actionLabel;
      b.style.cssText = 'background:#fff;color:#1b5e20;border:0;border-radius:6px;padding:5px 10px;font-weight:700;cursor:pointer;';
      b.onclick = onClick; el.appendChild(b);
    }
  }
  const hideBanner = () => { const el = document.getElementById('gba-tsync-banner'); if (el) el.remove(); };

  /* ---------- sync ---------- */
  async function post(body) {
    const res = await fetch(CONFIG.BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    const text = await res.text();
    if (text.trim().startsWith('<')) throw new Error('Backend returned HTML — check the Apps Script deployment (Anyone + latest version).');
    return JSON.parse(text);
  }

  async function syncNow(opts) {
    opts = opts || {};
    if (!enabled()) return { ok: false, error: 'Backend not configured' };
    if (_running) return _running;
    _running = (async () => {
      const token = getToken(!!opts.ask);
      if (!token) return { ok: false, error: 'NO_TOKEN' };
      try {
        const res = await post({ action: 'getAllStudentsAggregated', token });
        if (!res.ok) {
          if (/UNAUTHORIZED/i.test(res.error || '')) clearToken();
          return { ok: false, error: res.error || 'Backend error' };
        }
        const students = res.students || [];
        const changed = mergeIntoLocal(students);
        _lastResult = { ok: true, count: students.length, changed, at: new Date().toISOString(), students };
        try { localStorage.setItem(`${NS}teacher_last_sync_at`, _lastResult.at); } catch (e) { /* ignore */ }
        window.dispatchEvent(new CustomEvent('teacher-students-updated', { detail: { count: students.length, changed } }));
        return _lastResult;
      } catch (err) {
        return { ok: false, error: err.message };
      }
    })();
    try { return await _running; } finally { _running = null; }
  }

  async function tick() {
    if (document.hidden) return;
    if (typeof TeacherAuth !== 'undefined' && !TeacherAuth.isLoggedIn()) return;
    const r = await syncNow({ ask: false });
    if (r.error === 'NO_TOKEN') {
      showBanner('Enter your teacher password to sync student data from the Google Sheet.', 'Enter', async () => {
        const rr = await syncNow({ ask: true });
        if (rr.ok) { hideBanner(); location.reload(); }
      });
      return;
    }
    if (!r.ok) { console.warn('[TeacherSync]', r.error); return; }
    if (r.changed > 0) {
      const key = 'gba_tsync_reload_' + location.pathname;
      const last = Number(sessionStorage.getItem(key) || 0);
      if (_first && Date.now() - last > 60000) {            // unang load: isang beses na auto-refresh
        sessionStorage.setItem(key, String(Date.now()));
        location.reload();
        return;
      }
      showBanner('New student data synced.', 'Refresh', () => location.reload());
    }
    _first = false;
  }

  window.TeacherSync = { syncNow, getToken, setToken, last: () => _lastResult };

  const start = () => { setTimeout(tick, 600); setInterval(tick, INTERVAL); document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(tick, 300); }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
