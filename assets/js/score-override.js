/* ============================================================
   score-override.js — Manual score entry / override (teacher)
   Version: 1.0.0
   ------------------------------------------------------------
   For students who took a quiz / ST / Term Exam / PT offline
   (paper copy) or whose online score needs correction.

   - Saves into the SAME local score store the class record reads
     (Store.saveScore), so grades recompute automatically.
   - Every override is marked: entry.override = { by, reason,
     takenOn, at, previous } — `previous` is the old online result
     so the override can be reverted.
   - Pushes to the Google Sheet backend (teacher token required):
       1. action 'overrideScoresBatch'  (Code.gs v2.2.0+)
       2. falls back to the existing 'saveScore' action if the
          backend has not been redeployed yet.
   - If the push fails (offline / wrong token), items are queued
     in this browser WITHOUT the token and can be re-sent later
     with flushPending().
   - mergeEntry() lets backend pulls keep a newer local override
     instead of overwriting it with older online data.
   ============================================================ */

const ScoreOverride = (() => {
  'use strict';

  const QUEUE_KEY = 'gba_v1_override_queue';
  const TOKEN_KEY = 'gba_teacher_token';
  const PASSING = 80;

  const CATALOG = [
    { code: 'quiz1', label: 'Quiz 1', type: 'quizzes', total: 20 },
    { code: 'quiz2', label: 'Quiz 2', type: 'quizzes', total: 20 },
    { code: 'quiz3', label: 'Quiz 3', type: 'quizzes', total: 20 },
    { code: 'st1',   label: 'Summative Test 1', type: 'st', total: 30 },
    { code: 'st2',   label: 'Summative Test 2', type: 'st', total: 30 },
    { code: 'te',    label: 'Term Exam', type: 'te', total: 60 },
    { code: 'pt1',   label: 'Performance Task 1', type: 'pt', total: 100 },
    { code: 'pt2',   label: 'Performance Task 2', type: 'pt', total: 100 },
    { code: 'pt3',   label: 'Performance Task 3', type: 'pt', total: 100 }
  ];

  function getCatalog() { return CATALOG.slice(); }
  function findItem(code) { return CATALOG.find((c) => c.code === code) || null; }
  function assessmentId(subject, code) { return subject + '-' + code; }
  function backendUrl() {
    return (typeof CONFIG !== 'undefined' && CONFIG.backendEnabled) ? CONFIG.BACKEND_URL : '';
  }

  /* ---------- reading ---------- */
  function getEntry(lrn, subject, code) {
    const item = findItem(code);
    if (!item) return null;
    const s = (Store.getScores(lrn) || {})[subject] || {};
    return ((s[item.type] || {})[assessmentId(subject, code)]) || null;
  }

  function isOverridden(entry) { return !!(entry && entry.override); }

  /* ---------- validation ---------- */
  function validate(score, total) {
    const s = Number(score), t = Number(total);
    if (score === '' || score === null || score === undefined || isNaN(s)) return 'Enter a score.';
    if (isNaN(t) || t <= 0) return 'Total must be greater than 0.';
    if (s < 0) return 'Score cannot be negative.';
    if (s > t) return 'Score (' + s + ') cannot exceed the total (' + t + ').';
    return null;
  }

  function stripForPrevious(entry) {
    if (!entry) return null;
    const copy = Object.assign({}, entry);
    delete copy.override;
    return copy;
  }

  /* ---------- write (local) ---------- */
  /**
   * @param {object} p { lrn, subject, code, score, total, reason, takenOn }
   * @returns {{ entry, push }} push = payload ready for the backend
   */
  function applyLocal(p) {
    const item = findItem(p.code);
    if (!item) throw new Error('Unknown assessment: ' + p.code);
    const err = validate(p.score, p.total);
    if (err) throw new Error(err);

    const lrn = Store.normalizeLRN(p.lrn);
    const subject = p.subject;
    const id = assessmentId(subject, p.code);
    const score = Number(p.score);
    const total = Number(p.total);
    const percent = Math.round((score / total) * 100);
    const old = getEntry(lrn, subject, p.code);
    const previous = old && old.override ? (old.override.previous || null) : stripForPrevious(old);
    const at = new Date().toISOString();

    const override = {
      by: 'teacher',
      reason: String(p.reason || '').trim(),
      takenOn: p.takenOn || '',
      at,
      previous
    };

    let data;
    if (item.type === 'pt') {
      data = Object.assign({}, old ? stripForPrevious(old) : {}, {
        score, maxScore: total, total, percent, status: 'graded', override
      });
    } else {
      data = {
        score, total, percent,
        passed: percent >= PASSING,
        autoSubmitted: false,
        tabViolations: 0,
        breakdown: [],
        override
      };
    }
    const entry = Store.saveScore(lrn, subject, item.type, id, data);

    return { entry, push: buildPush(lrn, subject, item.type, id, entry) };
  }

  function buildPush(lrn, subject, type, id, entry) {
    const u = Store.getUser(lrn) || {};
    return {
      lrn,
      student: {
        lrn, lastName: u.lastName || '', firstName: u.firstName || '',
        middleName: u.middleName || '', gradeLevel: u.gradeLevel || '', section: u.section || ''
      },
      subject, type, assessmentId: id,
      score: entry.score,
      total: entry.total != null ? entry.total : entry.maxScore,
      percent: entry.percent,
      passed: entry.passed != null ? !!entry.passed : (entry.percent >= PASSING),
      override: {
        by: 'teacher',
        reason: entry.override ? entry.override.reason : '',
        takenOn: entry.override ? entry.override.takenOn : '',
        at: entry.override ? entry.override.at : new Date().toISOString(),
        reverted: !entry.override
      },
      timestamp: new Date().toISOString()
    };
  }

  /** Undo an override: restore the previous online result (or remove). */
  function revertLocal(lrn, subject, code) {
    const item = findItem(code);
    const old = getEntry(lrn, subject, code);
    if (!item || !old || !old.override) throw new Error('Nothing to revert.');
    lrn = Store.normalizeLRN(lrn);
    const id = assessmentId(subject, code);
    const prev = old.override.previous;
    if (prev) {
      const restored = Object.assign({}, prev);
      const entry = Store.saveScore(lrn, subject, item.type, id, restored);
      return { entry, push: buildPush(lrn, subject, item.type, id, entry), removed: false };
    }
    // No online result existed before: remove the entry locally and
    // push a zero-free tombstone is not possible — the backend keeps its
    // row, so we push a 0 revert only for local-only cases.
    Store.deleteScore(lrn, subject, item.type, id);
    const tomb = buildPush(lrn, subject, item.type, id, { score: 0, total: old.total || old.maxScore || 0, percent: 0, passed: false });
    tomb.removed = true;
    tomb.override.reverted = true;
    tomb.override.removed = true;
    return { entry: null, push: tomb, removed: true };
  }

  /* ---------- queue ---------- */
  function _readQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (e) { return []; }
  }
  function _writeQueue(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (e) { /* quota */ }
  }
  function enqueue(items) {
    const q = _readQueue();
    items.forEach((it) => {
      // one pending entry per student+assessment — newest wins
      const i = q.findIndex((x) => x.lrn === it.lrn && x.assessmentId === it.assessmentId);
      if (i >= 0) q.splice(i, 1);
      q.push(it);
    });
    _writeQueue(q);
  }
  function pendingCount() { return _readQueue().length; }
  function pendingItems() { return _readQueue(); }

  /* ---------- backend ---------- */
  function getToken(ask) {
    let t = '';
    try { t = sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { /* ignore */ }
    if (!t && ask) {
      t = prompt('Enter teacher token (password) to sync with the backend:') || '';
      if (t) { try { sessionStorage.setItem(TOKEN_KEY, t); } catch (e) { /* ignore */ } }
    }
    return t;
  }
  function clearToken() { try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } }

  async function _post(body) {
    const res = await fetch(backendUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body)
    });
    return res.json();
  }

  /**
   * Send items to the backend. Anything not delivered stays queued.
   * @returns {{ ok:boolean, sent:number, queued:number, error?:string, usedFallback?:boolean }}
   */
  async function push(items, opts) {
    opts = opts || {};
    if (!items || !items.length) return { ok: true, sent: 0, queued: pendingCount() };
    if (!backendUrl()) {
      enqueue(items);
      return { ok: false, sent: 0, queued: pendingCount(), error: 'Backend not configured — saved on this device only.' };
    }
    const token = getToken(opts.askToken !== false);
    if (!token) {
      enqueue(items);
      return { ok: false, sent: 0, queued: pendingCount(), error: 'No teacher token — saved on this device, will sync later.' };
    }

    try {
      let res = await _post({ action: 'overrideScoresBatch', token, items });
      let usedFallback = false;

      if (!res.ok && /unknown action/i.test(res.error || '')) {
        // backend not redeployed yet → use the existing saveScore action
        usedFallback = true;
        let sent = 0;
        const failed = [];
        for (const it of items) {
          if (it.removed) continue; // old backend cannot delete a row — nothing to send
          try {
            const r = await _post(Object.assign({ action: 'saveScore' }, it));
            if (r.ok) sent++; else failed.push(it);
          } catch (e) { failed.push(it); }
        }
        if (failed.length) enqueue(failed);
        return { ok: failed.length === 0, sent, queued: pendingCount(), usedFallback,
          error: failed.length ? failed.length + ' item(s) not sent.' : undefined };
      }

      if (!res.ok) {
        if (/token/i.test(res.error || '')) clearToken();
        enqueue(items);
        return { ok: false, sent: 0, queued: pendingCount(), error: res.error || 'Backend error' };
      }
      // success — clear any stale queue entries for these items
      const q = _readQueue().filter((x) => !items.some((it) => it.lrn === x.lrn && it.assessmentId === x.assessmentId));
      _writeQueue(q);
      return { ok: true, sent: items.length, queued: q.length, usedFallback };
    } catch (err) {
      enqueue(items);
      return { ok: false, sent: 0, queued: pendingCount(), error: 'Offline — saved on this device, will sync later.' };
    }
  }

  async function flushPending() {
    const items = _readQueue();
    if (!items.length) return { ok: true, sent: 0, queued: 0 };
    _writeQueue([]);
    return push(items, { askToken: true });
  }

  /* ---------- convenience ---------- */
  async function saveOne(p) {
    const r = applyLocal(p);
    const sync = await push([r.push]);
    return { entry: r.entry, sync };
  }

  async function saveMany(list) {
    const items = [];
    const errors = [];
    list.forEach((p) => {
      try { items.push(applyLocal(p).push); }
      catch (e) { errors.push({ lrn: p.lrn, error: e.message }); }
    });
    const sync = items.length ? await push(items) : { ok: true, sent: 0, queued: pendingCount() };
    return { saved: items.length, errors, sync };
  }

  async function revert(lrn, subject, code) {
    const r = revertLocal(lrn, subject, code);
    const sync = await push([r.push]);
    return { entry: r.entry, removed: r.removed, sync };
  }

  /* ---------- merge guard for backend pulls ---------- */
  /**
   * Decide which entry to keep when an incoming (backend) entry meets a
   * local one. A local manual override is kept unless the incoming entry
   * is a newer override, or a genuinely newer online result.
   */
  function mergeEntry(local, incoming) {
    if (!local) return incoming;
    if (!incoming) return local;
    const lo = local.override;
    if (!lo) return incoming;
    const io = incoming.override;
    if (io) return (io.at || '') >= (lo.at || '') ? incoming : local;
    const incTs = incoming.timestamp || '';
    return incTs > (lo.at || '') ? incoming : local;
  }

  /** Merge a whole {id: entry} map (quizzes/st/pt/te). */
  function mergeTypeMap(localMap, incomingMap) {
    const out = Object.assign({}, localMap || {});
    Object.keys(incomingMap || {}).forEach((id) => {
      out[id] = mergeEntry(out[id], incomingMap[id]);
    });
    return out;
  }

  return {
    getCatalog, findItem, assessmentId,
    getEntry, isOverridden, validate,
    applyLocal, revertLocal,
    saveOne, saveMany, revert,
    push, flushPending, pendingCount, pendingItems,
    getToken, clearToken,
    mergeEntry, mergeTypeMap
  };
})();
