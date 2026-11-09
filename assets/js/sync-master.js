/* ============================================================
   sync-master.js — Master Sync Engine (student side)
   Version: 3.0.0
   ------------------------------------------------------------
   v3.0.0 (sync-complete):
   - Isang "snapshot" ang ipinapadala: progress + scores + badges + points
     (dati: points at activity scores ay hindi nasi-sync).
   - AUTO-SYNC LOOP: bawat 30s, kapag nagbago ang data sa device -> kusang pino-push.
     Kaya kahit may Store.* na nagsulat nang walang explicit push, aabot pa rin sa backend.
   - Kusang PULL (sa load, bawat ~90s, at pagbalik sa tab) kaya lumalabas sa kahit
     anong device ang pinakabagong progress/score. Ang mga listing page ay kusang nagre-refresh.
   - Term Exam ay laging nested: te = { 'biol1-te': {...} } (inaayos ang lumang flat).
   - Locks ay ina-derive mula sa scores kaya hindi makaka-retake sa ibang device nang walang code.
   - Ang pumalyang push ay NAKA-QUEUE at hindi na binubura (dati: tinatanggal pagkatapos ng 5 try).
   - Teacher override ay pinoprotektahan sa merge.
   ============================================================ */

const SyncMaster = (() => {
  'use strict';

  const NS = 'gba_v1_';
  const QUEUE_KEY = `${NS}master_queue`;
  const PUSH_INTERVAL = 30 * 1000;
  const PULL_INTERVAL = 90 * 1000;
  const MIN_PULL_GAP = 20 * 1000;
  const SUBJECTS = ['biol1', 'biol2'];

  let _pushing = null;       // single-flight push
  let _pulling = null;       // single-flight pull
  let _lastPullAt = 0;
  let _autoStarted = false;

  /* ---------- helpers ---------- */
  function backendEnabled() {
    return typeof CONFIG !== 'undefined' && !!CONFIG.backendEnabled;
  }

  function normLrn(lrn) {
    if (lrn === null || lrn === undefined) return '';
    let s = String(lrn).trim();
    if (s.endsWith('.0')) s = s.slice(0, -2);
    const d = s.replace(/\D/g, '');
    if (!d) return '';
    return d.length > 12 ? d.slice(0, 12) : d.padStart(12, '0');
  }

  function _read(key, fb) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fb; } catch (e) { return fb; }
  }
  function _write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { console.warn('[SyncMaster] storage write failed', key, e && e.message); return false; }
  }

  function currentLrn() {
    try {
      const s = _read(`${NS}session`, null);
      return s && s.lrn ? normLrn(s.lrn) : '';
    } catch (e) { return ''; }
  }

  async function backendPost(body, opts) {
    opts = opts || {};
    const retries = opts.retries || 2;
    let lastErr;
    for (let i = 0; i < retries; i++) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeout || 30000) : null;
      try {
        const res = await fetch(CONFIG.BACKEND_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(body),
          keepalive: !!opts.keepalive,
          signal: ctrl ? ctrl.signal : undefined
        });
        const text = await res.text();
        if (timer) clearTimeout(timer);
        if (text.trim().startsWith('<')) throw new Error('ERR_HTML_RESPONSE (check Apps Script deployment: Anyone + latest version)');
        return JSON.parse(text);
      } catch (err) {
        if (timer) clearTimeout(timer);
        lastErr = err;
        if (i < retries - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
    throw lastErr;
  }

  /* ---------- score shape + merge ---------- */
  function _isFlatEntry(o) {
    return !!o && typeof o === 'object' && !Array.isArray(o) &&
      ['score', 'percent', 'total', 'passed'].some((k) => o[k] !== undefined && typeof o[k] !== 'object');
  }

  function normalizeScores(scores) {
    const out = {};
    if (!scores || typeof scores !== 'object') return out;
    Object.keys(scores).forEach((subj) => {
      const s = scores[subj];
      if (!s || typeof s !== 'object') return;
      out[subj] = {};
      Object.keys(s).forEach((type) => {
        let v = s[type];
        if (v === null || v === undefined) { out[subj][type] = {}; return; }
        if (typeof v !== 'object') return;
        if (type === 'te' && _isFlatEntry(v)) v = { [`${subj}-te`]: v };
        out[subj][type] = v;
      });
    });
    return out;
  }

  function _ts(o) { const t = new Date((o && o.timestamp) || 0).getTime(); return isNaN(t) ? 0 : t; }

  function mergeEntry(local, incoming) {
    if (!local) return incoming;
    if (!incoming) return local;
    const lo = local.override, io = incoming.override;
    let win;
    if (lo && !io) win = (incoming.timestamp || '') > (lo.at || '') ? incoming : local;
    else if (io && !lo) win = (local.timestamp || '') > (io.at || '') ? local : incoming;
    else if (lo && io) win = (io.at || '') >= (lo.at || '') ? incoming : local;
    else {
      const lt = _ts(local), it = _ts(incoming);
      if (it > lt) win = incoming;
      else if (it === lt && (Number(incoming.score) || 0) > (Number(local.score) || 0)) win = incoming;
      else win = local;
    }
    // same attempt but one side lost its breakdown (oversize strip) -> keep the one that has it
    const other = win === local ? incoming : local;
    if ((!Array.isArray(win.breakdown) || !win.breakdown.length) && Array.isArray(other.breakdown) && other.breakdown.length && _ts(win) === _ts(other)) {
      win = Object.assign({}, win, { breakdown: other.breakdown });
    }
    return win;
  }

  function mergeScores(existing, incoming) {
    const base = normalizeScores(existing);
    const inc = normalizeScores(incoming);
    Object.keys(inc).forEach((subj) => {
      if (!base[subj]) base[subj] = {};
      Object.keys(inc[subj]).forEach((type) => {
        if (!base[subj][type] || typeof base[subj][type] !== 'object') base[subj][type] = {};
        const items = inc[subj][type] || {};
        Object.keys(items).forEach((id) => {
          if (!items[id]) return;
          base[subj][type][id] = mergeEntry(base[subj][type][id], items[id]);
        });
      });
    });
    return base;
  }

  function mergeProgress(existing, incoming) {
    if (!incoming) return existing || {};
    if (!existing) return incoming;
    const merged = JSON.parse(JSON.stringify(existing));
    for (const subj in incoming) {
      const inc = incoming[subj];
      if (!inc || typeof inc !== 'object') continue;
      if (!merged[subj]) merged[subj] = { completed: [], weeks: {} };
      merged[subj].completed = Array.from(new Set([...(merged[subj].completed || []), ...(inc.completed || [])]));
      const incWeeks = inc.weeks || {};
      if (!merged[subj].weeks) merged[subj].weeks = {};
      for (const w in incWeeks) {
        if (!merged[subj].weeks[w]) merged[subj].weeks[w] = {};
        Object.assign(merged[subj].weeks[w], incWeeks[w]);
      }
    }
    return merged;
  }

  function mergeBadges(existing, incoming) {
    if (!incoming) return existing || {};
    if (!existing) return incoming;
    const merged = JSON.parse(JSON.stringify(existing));
    for (const subj in incoming) {
      merged[subj] = Array.from(new Set([...(merged[subj] || []), ...(Array.isArray(incoming[subj]) ? incoming[subj] : [])]));
    }
    return merged;
  }

  /* ---------- local snapshot ---------- */
  function readPoints(lrn) {
    const prefix = `${NS}points_${lrn}_`;
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        try { out[k.slice(prefix.length)] = Number(JSON.parse(localStorage.getItem(k))) || 0; } catch (e) { /* skip */ }
      }
    }
    return out;
  }

  function buildSnapshot(lrn) {
    return {
      progress: _read(`${NS}progress_${lrn}`, {}),
      scores: normalizeScores(_read(`${NS}scores_${lrn}`, {})),
      badges: _read(`${NS}badges_${lrn}`, {}),
      points: readPoints(lrn)
    };
  }

  function _hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return String(h) + ':' + str.length;
  }
  const snapshotHash = (snap) => _hash(JSON.stringify(snap));
  const _hashKey = (lrn) => `${NS}last_pushed_hash_${lrn}`;

  function getDeviceId() {
    let devId = localStorage.getItem(`${NS}device_id`);
    if (!devId) { devId = 'DEV-' + Math.random().toString(36).slice(2, 11); localStorage.setItem(`${NS}device_id`, devId); }
    return devId;
  }

  function _studentBlock(lrn) {
    let user = null;
    try { user = (typeof Store !== 'undefined' && Store.getUser) ? Store.getUser(lrn) : null; } catch (e) { /* ignore */ }
    if (!user) {
      const list = _read(`${NS}users`, []);
      user = (Array.isArray(list) ? list : []).find((u) => normLrn(u.lrn || u.LRN) === lrn) || null;
    }
    if (!user) return null;
    return {
      lastName: user.lastName || user.LastName || '', firstName: user.firstName || user.FirstName || '',
      middleName: user.middleName || user.MiddleName || '', gradeLevel: user.gradeLevel || user.GradeLevel || '',
      section: user.section || user.Section || '', sex: user.sex || user.Sex || ''
    };
  }

  /* ---------- PUSH ---------- */
  async function pushMasterUpdate(lrn, subject, reason, opts) {
    if (!backendEnabled()) return { ok: false, error: 'Backend disabled' };
    const normalized = normLrn(lrn || currentLrn());
    if (!normalized) return { ok: false, error: 'No LRN' };
    if (_pushing) { try { await _pushing; } catch (e) { /* ignore */ } }   // isang push lang sa isang oras

    const run = (async () => {
      const student = _studentBlock(normalized);
      if (!student) return { ok: false, error: 'User not found' };
      const snap = buildSnapshot(normalized);
      const body = Object.assign({ action: 'upsertStudentMaster', lrn: normalized, student, deviceId: getDeviceId(), reason: reason || '' }, snap);
      const h = snapshotHash(snap);
      try {
        const size = JSON.stringify(body).length;
        const res = await backendPost(body, { keepalive: !!(opts && opts.keepalive) && size < 60000, retries: (opts && opts.keepalive) ? 1 : 2 });
        if (res && res.ok) {
          localStorage.setItem(_hashKey(normalized), h);
          localStorage.setItem(`${NS}last_push_at`, new Date().toISOString());
          _dropQueued(normalized);
          window.dispatchEvent(new Event('sync-queue-changed'));
        } else {
          _queueFailedPush(body);
        }
        return res;
      } catch (err) {
        _queueFailedPush(body);
        return { ok: false, error: err.message };
      }
    })();
    _pushing = run;
    try { return await run; } finally { if (_pushing === run) _pushing = null; }
  }

  function _queueFailedPush(body) {
    try {
      const queue = _read(QUEUE_KEY, []);
      const item = { body, queuedAt: new Date().toISOString(), attempts: 0 };
      const idx = queue.findIndex((q) => q && q.body && q.body.lrn === body.lrn && q.body.action === body.action);
      if (idx >= 0) { item.attempts = queue[idx].attempts || 0; queue[idx] = item; } else queue.push(item);
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-50)));
      window.dispatchEvent(new Event('sync-queue-changed'));
    } catch (e) { /* ignore */ }
  }

  function _dropQueued(lrn) {
    try {
      const queue = _read(QUEUE_KEY, []);
      const rest = queue.filter((q) => !(q && q.body && q.body.lrn === lrn && q.body.action === 'upsertStudentMaster'));
      if (rest.length !== queue.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(rest));
    } catch (e) { /* ignore */ }
  }

  async function flushQueue() {
    if (!backendEnabled() || !navigator.onLine) return { ok: false, flushed: 0 };
    const queue = _read(QUEUE_KEY, []);
    if (!queue.length) return { ok: true, flushed: 0, remaining: 0 };
    const remaining = []; let flushed = 0;
    for (const item of queue) {
      try {
        const res = await backendPost(item.body);
        if (res && res.ok) {
          flushed++;
          localStorage.setItem(`${NS}last_push_at`, new Date().toISOString());
        } else {
          item.attempts = (item.attempts || 0) + 1;
          item.lastError = res && res.error;
          remaining.push(item);               // HINDI na binubura — hihintayin ang susunod na try
        }
      } catch (e) {
        item.attempts = (item.attempts || 0) + 1;
        item.lastError = e && e.message;
        remaining.push(item);
      }
    }
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining)); } catch (e) { /* ignore */ }
    window.dispatchEvent(new Event('sync-queue-changed'));
    return { ok: true, flushed, remaining: remaining.length };
  }

  function getQueueStatus() {
    const q = _read(QUEUE_KEY, []);
    return { count: Array.isArray(q) ? q.length : 0 };
  }

  /* ---------- PULL ---------- */
  // Walang lock sa device na ito pero may score sa backend -> i-lock (maliban kung may redeemed retake code).
  function deriveLocks(lrn) {
    if (typeof Store === 'undefined' || !Store.lockAssessment) return;
    const scores = normalizeScores(_read(`${NS}scores_${lrn}`, {}));
    SUBJECTS.forEach((subj) => {
      const s = scores[subj] || {};
      ['quizzes', 'st', 'te'].forEach((type) => {
        Object.keys(s[type] || {}).forEach((id) => {
          const e = s[type][id];
          if (!e || e.score === null || e.score === undefined) return;
          if (localStorage.getItem(`${NS}unlocked_${lrn}_${id}`)) return;
          if (Store.isAssessmentLocked && Store.isAssessmentLocked(lrn, id)) return;
          Store.lockAssessment(lrn, id, { score: e.score, total: e.total, percent: e.percent, derived: true });
        });
      });
    });
  }

  function _stripHeavyUserFields(lrn) {
    try {
      const key = `${NS}users`;
      const users = JSON.parse(localStorage.getItem(key) || '[]');
      const HEAVY = ['ProgressJSON', 'ScoresJSON', 'BadgesJSON', 'LocksJSON', 'PointsJSON', 'ProgressObj', 'ScoresObj', 'BadgesObj', 'LocksObj', 'PointsObj'];
      let changed = false;
      users.forEach((u) => {
        if (normLrn(u.lrn || u.LRN) !== lrn) return;
        HEAVY.forEach((k) => { if (k in u) { delete u[k]; changed = true; } });
      });
      if (changed) localStorage.setItem(key, JSON.stringify(users));
    } catch (e) { /* hindi dapat humarang sa sync */ }
  }

  function _localFingerprint(lrn) { return snapshotHash(buildSnapshot(lrn)); }

  async function pullFromBackend(lrn) {
    if (!backendEnabled()) return { ok: false, error: 'ERR_BACKEND_DISABLED', code: 'BACKEND_DISABLED' };
    const normalized = normLrn(lrn || currentLrn());
    if (_pulling) return _pulling;
    _pulling = (async () => {
      try {
        const res = await backendPost({ action: 'getStudentByLRN', lrn: normalized });
        if (!res || !res.ok) return res || { ok: false, error: 'No response' };

        const student = res.student || {};
        const before = _localFingerprint(normalized);

        const profile = { lrn: normalized };
        [['lastName', 'LastName'], ['firstName', 'FirstName'], ['middleName', 'MiddleName'],
         ['gradeLevel', 'GradeLevel'], ['section', 'Section'], ['sex', 'Sex']].forEach(([lo, up]) => {
          const v = String(student[lo] || student[up] || '').trim();
          if (v) { profile[lo] = v; profile[up] = v; }
        });
        Store.saveUser(profile);
        _stripHeavyUserFields(normalized);

        _write(`${NS}progress_${normalized}`, mergeProgress(_read(`${NS}progress_${normalized}`, { biol1: { weeks: {}, completed: [] }, biol2: { weeks: {}, completed: [] } }), student.ProgressObj));
        _write(`${NS}scores_${normalized}`, mergeScores(_read(`${NS}scores_${normalized}`, {}), student.ScoresObj));
        _write(`${NS}badges_${normalized}`, mergeBadges(_read(`${NS}badges_${normalized}`, { biol1: [], biol2: [] }), student.BadgesObj));
        if (student.PointsObj && typeof Store.mergePoints === 'function') Store.mergePoints(normalized, student.PointsObj);
        else if (student.PointsObj) Object.keys(student.PointsObj).forEach((k) => {
          const key = `${NS}points_${normalized}_${k}`; const cur = Number(_read(key, 0)) || 0;
          if ((Number(student.PointsObj[k]) || 0) > cur) _write(key, Number(student.PointsObj[k]));
        });
        deriveLocks(normalized);

        _lastPullAt = Date.now();
        localStorage.setItem(`${NS}last_pull_at`, new Date().toISOString());
        const changed = _localFingerprint(normalized) !== before;
        return { ok: true, user: Store.getUser(normalized), migrated: res.migrated || false, changed };
      } catch (err) {
        console.warn('[SyncMaster] Pull failed:', err.message);
        return { ok: false, error: err.message, code: 'NETWORK_ERROR' };
      } finally {
        _pulling = null;
      }
    })();
    return _pulling;
  }

  /* ---------- Full two-way sync (Force Sync button) ---------- */
  async function syncNow(lrn) {
    const normalized = normLrn(lrn || currentLrn());
    const out = { ok: false, pushed: false, pulled: false, flushed: 0, changed: false };
    if (!backendEnabled()) { out.error = 'Backend disabled'; return out; }
    if (!navigator.onLine) { out.error = 'Offline'; return out; }
    try { const f = await flushQueue(); out.flushed = f.flushed || 0; } catch (e) { /* ignore */ }
    const push = await pushMasterUpdate(normalized, 'both', 'syncNow');
    out.pushed = !!(push && push.ok);
    const pull = await pullFromBackend(normalized);
    out.pulled = !!(pull && pull.ok);
    out.changed = !!(pull && pull.changed);
    out.ok = out.pushed || out.pulled;
    if (!out.ok) out.error = (push && push.error) || (pull && pull.error) || 'Sync failed';
    return out;
  }

  /* ---------- AUTO SYNC ---------- */
  function _isListingPage() {
    const p = location.pathname;
    return /\/student\/(dashboard|profile)\.html$/.test(p) ||
           /\/student\/assessments\/index\.html$/.test(p) ||
           /\/student\/biol[12]\/(week\d+\/)?index\.html$/.test(p) ||
           /\/student\/biol[12]\/index\.html$/.test(p);
  }

  function _maybeRefreshView() {
    if (!_isListingPage()) return;
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
    const last = Number(sessionStorage.getItem('gba_sync_reload_at') || 0);
    if (Date.now() - last < 30000) return;
    sessionStorage.setItem('gba_sync_reload_at', String(Date.now()));
    location.reload();
  }

  async function autoTick(reason, force) {
    const lrn = currentLrn();
    if (!lrn || !backendEnabled() || !navigator.onLine) return;
    if (typeof Store === 'undefined') return;
    try {
      await flushQueue();
      const snap = buildSnapshot(lrn);
      if (snapshotHash(snap) !== localStorage.getItem(_hashKey(lrn))) {
        if (_studentBlock(lrn)) await pushMasterUpdate(lrn, 'both', 'auto:' + (reason || 'tick'));
      }
      if (force || Date.now() - _lastPullAt >= PULL_INTERVAL - 2000) {
        if (Date.now() - _lastPullAt >= MIN_PULL_GAP) {
          const r = await pullFromBackend(lrn);
          if (r && r.ok) {
            window.dispatchEvent(new CustomEvent('gba:data-pulled', { detail: { changed: !!r.changed } }));
            if (r.changed) _maybeRefreshView();
          }
        }
      }
    } catch (e) { /* auto-sync ay hindi dapat makasira ng page */ }
  }

  function startAutoSync() {
    if (_autoStarted || typeof window === 'undefined') return;
    _autoStarted = true;
    setTimeout(() => autoTick('load', true), 1500);
    setInterval(() => autoTick('interval', false), PUSH_INTERVAL);
    window.addEventListener('online', () => setTimeout(() => autoTick('online', true), 800));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        const lrn = currentLrn();
        if (lrn && backendEnabled() && navigator.onLine && snapshotHash(buildSnapshot(lrn)) !== localStorage.getItem(_hashKey(lrn))) {
          pushMasterUpdate(lrn, 'both', 'hidden', { keepalive: true });
        }
      } else {
        setTimeout(() => autoTick('visible', true), 400);
      }
    });
    window.addEventListener('pagehide', () => {
      const lrn = currentLrn();
      if (lrn && backendEnabled() && navigator.onLine && snapshotHash(buildSnapshot(lrn)) !== localStorage.getItem(_hashKey(lrn))) {
        pushMasterUpdate(lrn, 'both', 'pagehide', { keepalive: true });
      }
    });
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('load', () => setTimeout(flushQueue, 3000));
    // auto-sync ay para sa estudyante lang (hindi sa teacher pages)
    const isTeacherCtx = typeof TeacherAuth !== 'undefined';
    if (!isTeacherCtx) {
      if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(startAutoSync, 0);
      else document.addEventListener('DOMContentLoaded', startAutoSync);
    }
  }

  return {
    backendEnabled, pullFromBackend, pushMasterUpdate, flushQueue, getQueueStatus, getDeviceId,
    syncNow, autoTick, buildSnapshot, mergeScores, mergeProgress, mergeBadges, normalizeScores, deriveLocks
  };
})();

window.SyncMaster = SyncMaster;
