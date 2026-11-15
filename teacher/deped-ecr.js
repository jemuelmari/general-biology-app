/* ============================================================
   deped-ecr.js — Fill the official DepEd SHS ECR (.xlsx) with app scores
   Version: 1.0.0
   ------------------------------------------------------------
   - The teacher's own ECR file is opened IN THE BROWSER (JSZip) and never uploaded.
   - Only input cells are written (learners' LRN/names in INPUT DATA, highest
     possible scores and raw scores in the Term sheet). Every formula, the
     protection, validation and formatting of the DepEd file stay as they are;
     Excel recomputes the grades when the file is opened (fullCalcOnLoad).
   - Layout (SHS ECR 2026, "ECRSHS2026"):
       INPUT DATA  N/O = male LRN/name, R/S = female LRN/name, rows 11–60
                   F25 section, F30 subject, F33 no. of terms, H33 term block
       Term n      row 14 = highest possible score
                   males rows 17–66, females rows 68–117
                   WW D–M, PT Q–Z, ST1 AD, ST2 AE, TE AF
   ============================================================ */
(function () {
  'use strict';

  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const L = {
    input: { maleLrn: 'N', maleName: 'O', femaleLrn: 'R', femaleName: 'S', first: 11, slots: 50,
             section: 'F25', subject: 'F30', terms: 'F33', block: 'H33', teacher: 'F22' },
    term: { hps: 14, male: 17, female: 68, slots: 50, ww: 'D', pt: 'Q', st1: 'AD', st2: 'AE', te: 'AF', wwSlots: 10, ptSlots: 10 }
  };
  const TERM_BLOCKS = ['FIRST TERM', 'SECOND TERM', 'THIRD TERM'];

  // App assessments per subject (in ECR column order)
  const SUBJECTS = {
    biol1: { label: 'General Biology 1', detect: /BIOLOGY\s*1\b/i },
    biol2: { label: 'General Biology 2', detect: /BIOLOGY\s*2\b/i }
  };
  const ids = (subj) => ({
    ww: [1, 2, 3].map((n) => ({ id: `${subj}-quiz${n}`, bucket: 'quizzes', label: `Quiz ${n}` })),
    pt: [1, 2, 3].map((n) => ({ id: `${subj}-pt${n}`, bucket: 'pt', label: `PT ${n}` })),
    ex: [
      { key: 'st1', id: `${subj}-st1`, bucket: 'st', label: 'ST 1' },
      { key: 'st2', id: `${subj}-st2`, bucket: 'st', label: 'ST 2' },
      { key: 'te', id: `${subj}-te`, bucket: 'te', label: 'TE' }
    ]
  });

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colNum = (c) => c.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const colName = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const shiftCol = (c, k) => colName(colNum(c) + k);
  const digits = (v) => String(v || '').replace(/\D/g, '');
  const norm = (v) => String(v || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/Ñ/g, 'N').replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();

  const openWorkbook = (file) => XlsxLite.openWorkbook(file);

  /* ============================================================
     State
     ============================================================ */
  const state = { file: null, wb: null, info: null, plan: null };

  function users(section) {
    return Store.getAllUsers().filter((u) => !section || u.section === section);
  }
  const sexOf = (u) => /^m/i.test(String(u.sex || '').trim()) ? 'M' : /^f/i.test(String(u.sex || '').trim()) ? 'F' : '';
  const ecrName = (u) => {
    const first = [u.firstName, u.middleName].filter(Boolean).join(' ').trim();
    return (String(u.lastName || '').trim().toUpperCase() + (first ? ', ' + first : '')).trim();
  };

  async function readTemplate(file) {
    const wb = await openWorkbook(file);
    const need = ['INPUT DATA', 'Term 1', 'Term 2', 'Term 3'];
    const missing = need.filter((n) => !wb.sheetPaths[n]);
    if (missing.length) throw new Error('Hindi ito ang DepEd SHS ECR template (wala ang sheet: ' + missing.join(', ') + ').');
    const inp = await wb.sheet('INPUT DATA');
    const I = L.input;
    const learners = { M: [], F: [] };
    for (let i = 0; i < I.slots; i++) {
      const r = I.first + i;
      learners.M.push({ slot: i, lrn: digits(inp.get(I.maleLrn + r)), name: String(inp.get(I.maleName + r) || '').trim() });
      learners.F.push({ slot: i, lrn: digits(inp.get(I.femaleLrn + r)), name: String(inp.get(I.femaleName + r) || '').trim() });
    }
    const subjectText = String(inp.get(I.subject) || '');
    const subject = Object.keys(SUBJECTS).find((k) => SUBJECTS[k].detect.test(subjectText)) || '';
    const block = String(inp.get(I.block) || '').trim().toUpperCase();
    const terms = Number(inp.get(I.terms)) || 1;
    const termIdx = TERM_BLOCKS.indexOf(block);
    return {
      wb, learners, subject, subjectText,
      section: String(inp.get(I.section) || '').trim(),
      teacher: String(inp.get(I.teacher) || '').trim(),
      terms, block, termNo: termIdx >= 0 ? termIdx + 1 : 1
    };
  }

  /* ============================================================
     Plan: who goes in which row, what goes in which cell
     ============================================================ */
  function buildPlan() {
    const info = state.info;
    const subject = $('ecr-subject').value;
    const section = $('ecr-section').value;
    const termNo = Number($('ecr-term').value) || info.termNo;
    const wwStart = Number($('ecr-ww-start').value) || 1;
    const ptStart = Number($('ecr-pt-start').value) || 1;
    const addMissing = $('ecr-add-missing').checked;
    const zeroMissing = $('ecr-zero-missing').checked;
    const A = ids(subject);
    const roster = users(section);
    const scoresOf = (u) => (Store.getScores(u.lrn) || {})[subject] || {};
    const given = Transmutation.givenAssessments(roster.map(scoresOf));
    const warnings = [];

    // ---- assign learners to slots ----
    const slots = { M: info.learners.M.map((x) => ({ ...x, user: null })), F: info.learners.F.map((x) => ({ ...x, user: null })) };
    const hasNames = slots.M.some((x) => x.name) || slots.F.some((x) => x.name);
    const used = new Set();
    const noSex = [];
    const overrideSex = state.sexOverride || {};
    const userSex = (u) => overrideSex[u.lrn] || sexOf(u);

    if (hasNames) {
      ['M', 'F'].forEach((sx) => slots[sx].forEach((slot) => {
        if (!slot.name && !slot.lrn) return;
        let u = slot.lrn ? roster.find((x) => !used.has(x.lrn) && digits(x.lrn) === slot.lrn) : null;
        if (!u && slot.name) {
          const parts = slot.name.split(',');
          const tl = norm(parts[0]), tf = norm(parts.slice(1).join(' '));
          u = roster.find((x) => !used.has(x.lrn) && norm(x.lastName) === tl && tf && (tf.startsWith(norm(x.firstName)) || norm(x.firstName).startsWith(tf.split(' ')[0])));
        }
        if (u) { slot.user = u; used.add(u.lrn); }
      }));
    }
    const rest = roster.filter((u) => !used.has(u.lrn))
      .sort((a, b) => ecrName(a).localeCompare(ecrName(b)));
    const notPlaced = [];
    if (!hasNames || addMissing) {
      rest.forEach((u) => {
        const sx = userSex(u);
        if (!sx) { noSex.push(u); return; }
        const free = slots[sx].find((s) => !s.name && !s.lrn && !s.user);
        if (!free) { notPlaced.push(u); return; }
        free.user = u; free.isNew = true; used.add(u.lrn);
      });
    } else {
      rest.forEach((u) => notPlaced.push(u));
    }
    if (noSex.length) warnings.push(`${noSex.length} estudyante ang walang Sex sa app — piliin sa ibaba para maisama.`);
    if (notPlaced.length) warnings.push(`${notPlaced.length} estudyante ang hindi nailagay${hasNames && !addMissing ? ' (wala sila sa listahan ng ECR)' : ' (puno na ang 50 slots)'}: ${notPlaced.map(ecrName).join('; ')}`);
    const unmatched = ['M', 'F'].flatMap((sx) => slots[sx].filter((s) => (s.name || s.lrn) && !s.user).map((s) => s.name || s.lrn));
    if (unmatched.length) warnings.push(`${unmatched.length} pangalan sa ECR ang walang katugma sa app (hindi gagalawin ang row nila): ${unmatched.join('; ')}`);
    if (info.subject && info.subject !== subject) warnings.push(`Ang subject sa ECR ay "${info.subjectText}", pero ${SUBJECTS[subject].label} ang napili mo.`);
    if (info.section && section && norm(info.section) !== norm(section)) warnings.push(`Ang section sa ECR ay "${info.section}", pero "${section}" ang napili mo.`);

    // ---- columns ----
    const cols = [];
    A.ww.forEach((a, k) => { if (wwStart + k <= L.term.wwSlots) cols.push({ ...a, col: shiftCol(L.term.ww, wwStart - 1 + k), comp: 'WW' }); });
    A.pt.forEach((a, k) => { if (ptStart + k <= L.term.ptSlots) cols.push({ ...a, col: shiftCol(L.term.pt, ptStart - 1 + k), comp: 'PT', isPt: true }); });
    A.ex.forEach((a) => cols.push({ ...a, col: L.term[a.key], comp: 'EX' }));
    cols.forEach((c) => {
      c.given = given[c.bucket].has(c.id);
      c.hps = c.given ? given.hps[c.id] : null;
    });

    const scoreCell = (u, c) => {
      if (!c.given) return '';
      const e = (scoresOf(u)[c.bucket] || {})[c.id];
      if (!e || e.removed || e.score === null || e.score === undefined || e.score === '') return zeroMissing ? 0 : '';
      const v = Number(e.score);
      return isFinite(v) ? Math.max(0, Math.min(Math.round(v), c.hps || v)) : '';
    };
    const rows = [];
    ['M', 'F'].forEach((sx) => slots[sx].forEach((s, i) => {
      if (!s.user) return;
      const row = (sx === 'M' ? L.term.male : L.term.female) + i;
      const g = Transmutation.computeTermGrade(scoresOf(s.user), subject, given);
      rows.push({ sx, slot: s, row, user: s.user, values: cols.map((c) => scoreCell(s.user, c)), grade: g });
    }));
    return { subject, section, termNo, cols, rows, slots, hasNames, noSex, warnings };
  }

  /* ============================================================
     Render
     ============================================================ */
  function renderInfo() {
    const i = state.info;
    const named = i.learners.M.filter((x) => x.name).length + i.learners.F.filter((x) => x.name).length;
    $('ecr-info').innerHTML = `
      <div class="ecr-facts">
        <div><span>Subject sa ECR</span><b>${esc(i.subjectText || '—')}</b></div>
        <div><span>Section</span><b>${esc(i.section || '—')}</b></div>
        <div><span>Teacher</span><b>${esc(i.teacher || '—')}</b></div>
        <div><span>Term</span><b>${esc(i.block || '—')} (${i.terms} term)</b></div>
        <div><span>Learners sa ECR</span><b>${named ? named + ' na pangalan' : 'Blangko — pupunuin mula sa app'}</b></div>
      </div>`;
  }

  function renderPlan() {
    const p = state.plan = buildPlan();
    const cols = p.cols;
    const head = cols.map((c) => `<th class="${c.given ? '' : 'muted'}" title="${esc(c.comp)} · ${esc(c.col)}">${esc(c.label)}<br><small>${c.given ? 'HPS ' + c.hps : 'hindi pa naibigay'}</small></th>`).join('');
    const body = p.rows.map((r) => `<tr>
        <td class="n">${r.sx === 'M' ? '♂' : '♀'} ${r.slot.slot + 1}</td>
        <td>${esc(ecrName(r.user))}${r.slot.isNew ? ' <span class="tag">bago</span>' : ''}</td>
        ${r.values.map((v) => `<td class="n">${v === '' ? '<span class="muted">—</span>' : esc(v)}</td>`).join('')}
        <td class="n"><b>${r.grade.final === null ? '—' : esc(r.grade.final)}</b>${r.grade.complete ? '' : '<sup title="Projection: may components o exams na hindi pa naibigay">*</sup>'}</td>
      </tr>`).join('');
    const sexPick = p.noSex.map((u) => `<label class="sexpick">${esc(ecrName(u))}
        <select data-lrn="${esc(u.lrn)}"><option value="">—</option><option value="M">Male</option><option value="F">Female</option></select></label>`).join('');
    $('ecr-plan').innerHTML = `
      ${p.warnings.map((w) => `<div class="alert alert-warning">⚠️ ${esc(w)}</div>`).join('')}
      ${sexPick ? `<div class="card" style="padding:12px;"><b>Sex ng mga estudyanteng ito:</b><div class="sexgrid">${sexPick}</div></div>` : ''}
      <p class="text-small text-muted">Ilalagay sa sheet na <b>Term ${p.termNo}</b>: ${p.rows.length} estudyante. Ang "Grade (app)" ay kung ano ang dapat lumabas sa ECR pagbukas mo sa Excel.</p>
      <div style="overflow:auto;"><table class="ecr-table"><thead><tr><th>#</th><th>Learner (sa ECR)</th>${head}<th>Grade (app)</th></tr></thead><tbody>${body || `<tr><td colspan="${cols.length + 3}" class="muted">Walang estudyanteng tugma.</td></tr>`}</tbody></table></div>`;
    $('ecr-plan').querySelectorAll('.sexpick select').forEach((sel) => sel.addEventListener('change', () => {
      state.sexOverride = state.sexOverride || {};
      state.sexOverride[sel.dataset.lrn] = sel.value;
      renderPlan();
    }));
    $('ecr-download').disabled = !p.rows.length;
  }

  /* ============================================================
     Write + download
     ============================================================ */
  async function download() {
    const p = state.plan; const btn = $('ecr-download');
    btn.disabled = true; btn.textContent = '⏳ Ginagawa...';
    try {
      // Re-open the original file so repeated downloads start clean.
      const info = await readTemplate(state.file);
      const wb = info.wb;
      const inp = await wb.sheet('INPUT DATA');
      const I = L.input;
      // Term setting so the chosen Term sheet is the valid one
      if (info.terms === 1 && TERM_BLOCKS[p.termNo - 1] !== info.block) inp.set(I.block, TERM_BLOCKS[p.termNo - 1]);
      // Learners added by the app
      ['M', 'F'].forEach((sx) => p.slots[sx].forEach((s, i) => {
        if (!s.user || !s.isNew) return;
        const r = I.first + i;
        inp.set((sx === 'M' ? I.maleLrn : I.femaleLrn) + r, String(s.user.lrn));
        inp.set((sx === 'M' ? I.maleName : I.femaleName) + r, ecrName(s.user));
      }));
      const term = await wb.sheet('Term ' + p.termNo);
      p.cols.forEach((c) => term.set(c.col + L.term.hps, c.given ? c.hps : ''));
      p.rows.forEach((r) => p.cols.forEach((c, k) => term.set(c.col + r.row, r.values[k])));
      const blob = await wb.save();
      const a = document.createElement('a');
      const base = (state.file.name || 'ECR.xlsx').replace(/\.xlsx$/i, '');
      a.href = URL.createObjectURL(blob);
      a.download = `${base} - filled ${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      $('ecr-status').innerHTML = `<div class="alert alert-success">✅ Na-download na. Buksan sa Excel at i-check ang Term ${p.termNo} at FINAL GRADES. Kapag lumabas ang "Enable Editing", pindutin ito para mag-compute ang grades. (Sa WPS o LibreOffice: pindutin ang Ctrl+Shift+F9 para mag-recalculate.)</div>`;
    } catch (e) {
      $('ecr-status').innerHTML = `<div class="alert alert-danger">❌ ${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = '⬇️ I-download ang napunang ECR';
    }
  }

  /* ============================================================
     Wire up
     ============================================================ */
  function fillSections() {
    const sel = $('ecr-section'); const cur = sel.value;
    const secs = Array.from(new Set(Store.getAllUsers().map((u) => u.section).filter(Boolean))).sort();
    sel.innerHTML = '<option value="">Lahat ng section</option>' + secs.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    if (cur && secs.includes(cur)) sel.value = cur;
  }

  async function onFile(file) {
    if (!file) return;
    $('ecr-status').innerHTML = '';
    $('ecr-plan').innerHTML = '<p class="text-muted">Binabasa ang ECR...</p>';
    try {
      state.file = file;
      state.info = await readTemplate(file);
      state.sexOverride = {};
      if (state.info.subject) $('ecr-subject').value = state.info.subject;
      $('ecr-term').value = String(state.info.termNo);
      const sec = Array.from($('ecr-section').options).find((o) => o.value && norm(o.value) === norm(state.info.section));
      if (sec) $('ecr-section').value = sec.value;
      renderInfo();
      $('ecr-step2').style.display = '';
      renderPlan();
    } catch (e) {
      state.info = null;
      $('ecr-step2').style.display = 'none';
      $('ecr-plan').innerHTML = `<div class="alert alert-danger">❌ ${esc(e.message)}</div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    fillSections();
    $('ecr-file').addEventListener('change', (e) => onFile(e.target.files[0]));
    ['ecr-subject', 'ecr-section', 'ecr-term', 'ecr-ww-start', 'ecr-pt-start', 'ecr-add-missing', 'ecr-zero-missing'].forEach((id) =>
      $(id).addEventListener('change', () => { if (state.info) renderPlan(); }));
    $('ecr-download').addEventListener('click', download);
    window.addEventListener('teacher-students-updated', () => { fillSections(); if (state.info) renderPlan(); });
  });

  window.DepEdECR = { openWorkbook, readTemplate, buildPlan, _state: state };
})();
