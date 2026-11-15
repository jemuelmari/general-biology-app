/* ============================================================
   transmutation.js — Transmutation + term grade (one formula for every page)
   Version: 2.1.0
   ------------------------------------------------------------
   v2.1.0:
   - Transmutation = the DepEd SHS ECR 2026 table (70 -> 75, 0 -> 60), and the term grade is
     computed exactly like the official ECR, so the app and the downloaded ECR agree.
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

  // DepEd SHS ECR 2026 transmutation table (HELPER sheet of the official ECR):
  // [lowest initial grade, transmuted grade]. Initial grades are rounded to 2 decimals.
  const DEPED_TABLE = [
    [99.5, 100], [98.32, 99], [97.14, 98], [95.96, 97], [94.78, 96], [93.6, 95], [92.42, 94],
    [91.24, 93], [90.06, 92], [88.88, 91], [87.7, 90], [86.52, 89], [85.34, 88], [84.16, 87],
    [82.98, 86], [81.8, 85], [80.62, 84], [79.44, 83], [78.26, 82], [77.08, 81], [75.9, 80],
    [74.72, 79], [73.54, 78], [72.36, 77], [71.18, 76], [70, 75], [65.34, 74], [60.67, 73],
    [56.01, 72], [51.34, 71], [46.67, 70], [42.01, 69], [37.34, 68], [32.68, 67], [28.01, 66],
    [23.35, 65], [18.68, 64], [14.01, 63], [9.35, 62], [4.68, 61], [0, 60]
  ];
  const r2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

  function transmute(raw) {
    const r = r2(raw);
    if (isNaN(r)) return 0;
    for (let i = 0; i < DEPED_TABLE.length; i++) if (r >= DEPED_TABLE[i][0]) return DEPED_TABLE[i][1];
    return 60;
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
    const given = { quizzes: new Set(), pt: new Set(), st: new Set(), te: new Set(), hps: {} };
    (subjectScoresList || []).forEach((s) => {
      if (!s) return;
      ['quizzes', 'pt', 'st', 'te'].forEach((b) => {
        Object.keys(s[b] || {}).forEach((id) => {
          const e = s[b][id];
          if (pct(e, b === 'pt') === null) return;
          given[b].add(id);
          const tot = Number(b === 'pt' ? (e.maxScore || e.total || 100) : e.total) || 0;
          given.hps[id] = Math.max(given.hps[id] || 0, tot);   // highest possible score
        });
      });
    });
    return given;
  }

  /**
   * Same computation as the DepEd SHS ECR (Term sheet):
   *   WW / PT: PS = total raw score / total highest possible score x 100 (2 decimals); WS = PS x weight.
   *   Exams:  WS ST1 = ST1/HPS x 30, WS ST2 = ST2/HPS x 30, WS TE = TE/HPS x 40; PS = their sum.
   *   Initial grade = WS(WW) + WS(PT) + WS(Exams) -> transmuted with the DepEd table.
   * A given assessment the student did not take counts as 0. While some components or exams have
   * not been given yet, the grade is a projection re-scaled over what has been given
   * (complete = false); once everything is given it equals the ECR exactly.
   * @param {object} s       scores[subject] of one student
   * @param {string} subject 'biol1' | 'biol2'
   * @param {object} given   result of givenAssessments() for the class (optional)
   */
  function computeTermGrade(s, subject, given) {
    s = s || {};
    given = given || givenAssessments([s]);
    const hpsOf = (id, e, isPt) => given.hps && given.hps[id] ? given.hps[id] : Number(isPt ? (e && (e.maxScore || e.total)) || 100 : e && e.total) || 0;
    const pooled = (bucket, isPt) => {
      const ids = Array.from(given[bucket]);
      if (!ids.length) return null;
      let raw = 0, hps = 0;
      ids.forEach((id) => {
        const e = (s[bucket] || {})[id];
        const h = hpsOf(id, e, isPt);
        hps += h;
        if (pct(e, isPt) !== null) raw += Math.min(Number(e.score), h);
      });
      return hps > 0 ? r2(raw / hps * 100) : null;
    };
    const ww = pooled('quizzes', false);
    const pt = pooled('pt', true);
    const st1Id = subject + '-st1', st2Id = subject + '-st2', teId = subject + '-te';
    const st1 = pct((s.st || {})[st1Id]), st2 = pct((s.st || {})[st2Id]), te = pct((s.te || {})[teId]);
    const e = EX_INTERNAL();
    const parts = [];
    if (given.st.has(st1Id)) parts.push([st1 || 0, e.st1 * 100]);
    if (given.st.has(st2Id)) parts.push([st2 || 0, e.st2 * 100]);
    if (given.te.has(teId)) parts.push([te || 0, e.te * 100]);
    const wsum = parts.reduce((a, p) => a + p[1], 0);
    const ex = wsum ? r2(parts.reduce((a, p) => a + r2(p[0] / 100 * p[1]), 0) / wsum * 100) : null;
    const w = WEIGHTS();
    const comps = [[ww, w.ww], [pt, w.pt], [ex, w.ex]].filter((c) => c[0] !== null);
    const cw = comps.reduce((a, c) => a + c[1], 0);
    const raw = cw ? r2(comps.reduce((a, c) => a + r2(c[0] * c[1]), 0) / cw) : 0;
    const t = cw ? transmute(raw) : null;
    return {
      ww, pt, ex, st1, st2, te,
      raw,
      final: t,
      passing: t !== null && isPassing(t),
      complete: comps.length === 3 && parts.length === 3
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
