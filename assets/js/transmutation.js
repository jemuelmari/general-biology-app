/* ============================================================
   transmutation.js — Transmutation + term grade (one formula for every page)
   Version: 2.0.0
   ------------------------------------------------------------
   v2.0.0:
   - Linear transmutation: raw 70 -> 75 ... raw 100 -> 100; below 70 = raw + 5.
     (The old table was not monotonic: raw 70 -> 75 but raw 71-72 -> 74, raw 75 -> 76.)
   - Weights / passing come from CONFIG (WW 25 / PT 45 / QA 30, pass 70%).
   - computeTermGrade(): WW, PT and QA use every assessment that has been GIVEN to the
     class; a student's missing given assessment counts as 0 (DepEd: total raw score
     over highest possible score). Not-yet-given assessments are ignored.
   ============================================================ */

const Transmutation = (() => {
  'use strict';

  const PASSING = 75;
  const C = () => (typeof CONFIG !== 'undefined' ? CONFIG : {});
  const WEIGHTS = () => C().WEIGHTS || { ww: 0.25, pt: 0.45, ex: 0.30 };
  const EX_INTERNAL = () => C().EX_INTERNAL || { st1: 0.30, st2: 0.30, te: 0.40 };

  function transmute(raw) {
    const r = Number(raw);
    if (isNaN(r)) return 0;
    if (r >= 100) return 100;
    if (r <= 0) return 5;
    if (r >= 70) return Math.round(75 + (r - 70) * 25 / 30);
    return Math.round(r + 5);
  }

  // Kept for the Transmutation tab: { raw: transmuted } for 0..100
  const TABLE = (() => { const t = {}; for (let i = 100; i >= 0; i--) t[i] = transmute(i); return t; })();

  function isPassing(finalGrade) { return Number(finalGrade) >= PASSING; }

  function computeFinalGrade(wwPercent, ptPercent, exPercent, weights) {
    const w = weights || WEIGHTS();
    const raw = (wwPercent * w.ww) + (ptPercent * w.pt) + (exPercent * w.ex);
    const t = transmute(raw);
    return { raw: Math.round(raw * 100) / 100, transmuted: t, passing: isPassing(t) };
  }

  function computeEX(st1, st2, te) {
    const e = EX_INTERNAL();
    return (st1 * e.st1) + (st2 * e.st2) + (te * e.te);
  }

  /* ---------- helpers for the class-wide term grade ---------- */
  const pct = (e, isPt) => {
    if (!e || e.removed || e.score === null || e.score === undefined || e.score === '') return null;
    const tot = Number(isPt ? (e.maxScore || e.total || 100) : e.total);
    if (!(tot > 0)) return null;
    return Math.max(0, Math.min(100, Number(e.score) / tot * 100));
  };

  /**
   * Which assessments have been given to this group (at least one student has a score).
   * @param {Array} subjectScoresList  array of scores[subject] objects
   */
  function givenAssessments(subjectScoresList) {
    const given = { quizzes: new Set(), pt: new Set(), st: new Set(), te: new Set() };
    (subjectScoresList || []).forEach((s) => {
      if (!s) return;
      ['quizzes', 'pt', 'st', 'te'].forEach((b) => {
        Object.keys(s[b] || {}).forEach((id) => { if (pct(s[b][id], b === 'pt') !== null) given[b].add(id); });
      });
    });
    return given;
  }

  /**
   * @param {object} s      scores[subject] of one student
   * @param {string} subject 'biol1' | 'biol2'
   * @param {object} given  result of givenAssessments() for the class (optional)
   */
  function computeTermGrade(s, subject, given) {
    s = s || {};
    given = given || givenAssessments([s]);
    const avgOf = (bucket, isPt) => {
      const ids = Array.from(given[bucket]);
      if (!ids.length) return null;
      return ids.reduce((a, id) => a + (pct((s[bucket] || {})[id], isPt) || 0), 0) / ids.length;
    };
    const ww = avgOf('quizzes', false);
    const pt = avgOf('pt', true);
    const st1Id = subject + '-st1', st2Id = subject + '-st2', teId = subject + '-te';
    const st1 = pct((s.st || {})[st1Id]), st2 = pct((s.st || {})[st2Id]), te = pct((s.te || {})[teId]);
    // QA: only parts that were given; weights re-scaled over the given parts
    const e = EX_INTERNAL();
    const parts = [];
    if (given.st.has(st1Id)) parts.push([st1 || 0, e.st1]);
    if (given.st.has(st2Id)) parts.push([st2 || 0, e.st2]);
    if (given.te.has(teId)) parts.push([te || 0, e.te]);
    const wsum = parts.reduce((a, p) => a + p[1], 0);
    const ex = wsum ? parts.reduce((a, p) => a + p[0] * p[1], 0) / wsum : null;
    // Final: weights re-scaled over the components that exist so far
    const w = WEIGHTS();
    const comps = [[ww, w.ww], [pt, w.pt], [ex, w.ex]].filter((c) => c[0] !== null);
    const cw = comps.reduce((a, c) => a + c[1], 0);
    const raw = cw ? comps.reduce((a, c) => a + c[0] * c[1], 0) / cw : 0;
    const t = cw ? transmute(raw) : null;
    return {
      ww: ww === null ? null : Math.round(ww * 10) / 10,
      pt: pt === null ? null : Math.round(pt * 10) / 10,
      ex: ex === null ? null : Math.round(ex * 10) / 10,
      st1, st2, te,
      raw: Math.round(raw * 100) / 100,
      final: t,
      passing: t !== null && isPassing(t),
      complete: comps.length === 3
    };
  }

  function proficiencyLevel(mps) {
    const m = Number(mps);
    if (m >= 96) return { level: 'Mastered', key: 'mastered' };
    if (m >= 86) return { level: 'Closely Approximating Mastery', key: 'closely' };
    if (m >= 66) return { level: 'Moving Towards Mastery', key: 'moving' };
    if (m >= 35) return { level: 'Average', key: 'average' };
    if (m >= 15) return { level: 'Low', key: 'low' };
    if (m >= 5)  return { level: 'Very Low', key: 'verylow' };
    return { level: 'Absolutely No Mastery', key: 'nomastery' };
  }

  function classifyStudent(stAverage) {
    const avg = Number(stAverage);
    const pass = C().PASSING_PERCENT || 70;
    if (avg >= 90) return { label: 'Enrichment', key: 'enrichment' };
    if (avg >= pass) return { label: 'On Track', key: 'on-track' };
    if (avg >= pass - 10) return { label: 'Remediation Needed', key: 'remediation' };
    return { label: 'Urgent Intervention', key: 'urgent' };
  }

  return {
    TABLE, PASSING, transmute, isPassing,
    computeFinalGrade, computeEX, givenAssessments, computeTermGrade,
    proficiencyLevel, classifyStudent
  };
})();
