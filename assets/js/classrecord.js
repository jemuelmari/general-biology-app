/* ============================================================
   classrecord.js — Gradebook, reports, transmutation display
   Version: 1.0.0
   ============================================================ */

(() => {
  'use strict';

  let currentSubject = 'biol1';
  let currentSY = '2026-2027';

  const WEIGHTS = { ww: 0.25, pt: 0.50, ex: 0.25 };
  const EX_INTERNAL = { st1: 0.30, st2: 0.30, te: 0.40 };

  /* ---------- Helpers ---------- */
  function pctOf(score, total) {
    if (!total) return 0;
    return (score / total) * 100;
  }

  function getStudentsData() {
    const users = Store.getAllUsers();
    return users.map((u) => {
      const scores = Store.getScores(u.lrn)[currentSubject] || {};

      // Written Works (Quizzes) — average
      const quizzes = Object.values(scores.quizzes || {}).filter((q) => q && q.total);
      const wwAvg = quizzes.length
        ? quizzes.reduce((a, q) => a + pctOf(q.score, q.total), 0) / quizzes.length
        : 0;

      // Performance Tasks — average
      const pts = Object.values(scores.pt || {}).filter((p) => p && p.score != null);
      const ptAvg = pts.length
        ? pts.reduce((a, p) => a + pctOf(p.score, p.maxScore || 100), 0) / pts.length
        : 0;

      // Summative Tests
      const st1 = scores.st?.[`${currentSubject}-st1`];
      const st2 = scores.st?.[`${currentSubject}-st2`];
      const te = scores.te?.[`${currentSubject}-te`];

      const st1Pct = st1 ? pctOf(st1.score, st1.total) : 0;
      const st2Pct = st2 ? pctOf(st2.score, st2.total) : 0;
      const tePct = te ? pctOf(te.score, te.total) : 0;

      // EX = ST1*0.30 + ST2*0.30 + TE*0.40
      const ex = (st1Pct * EX_INTERNAL.st1) + (st2Pct * EX_INTERNAL.st2) + (tePct * EX_INTERNAL.te);

      // Final grade
      const final = Transmutation.computeFinalGrade(wwAvg, ptAvg, ex, WEIGHTS);

      return {
        user: u,
        ww: Math.round(wwAvg * 10) / 10,
        pt: Math.round(ptAvg * 10) / 10,
        st1: st1 ? `${st1.score}/${st1.total}` : '—',
        st1Pct: Math.round(st1Pct),
        st2: st2 ? `${st2.score}/${st2.total}` : '—',
        st2Pct: Math.round(st2Pct),
        te: te ? `${te.score}/${te.total}` : '—',
        tePct: Math.round(tePct),
        ex: Math.round(ex * 10) / 10,
        final: final.transmuted,
        rawFinal: final.raw,
        passing: final.passing
      };
    });
  }

  /* ---------- Render Summary Stats ---------- */
  function renderStats(students) {
    const withGrades = students.filter((s) => s.final > 0);
    const passing = withGrades.filter((s) => s.passing).length;
    const avg = withGrades.length
      ? withGrades.reduce((a, s) => a + s.final, 0) / withGrades.length
      : 0;

    document.getElementById('cr-stats').innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${students.length}</div>
        <div class="stat-label">Total Students</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${passing}</div>
        <div class="stat-label">Passing</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${withGrades.length - passing}</div>
        <div class="stat-label">Failing</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${avg.toFixed(1)}</div>
        <div class="stat-label">Class Average</div>
      </div>
    `;
  }

  /* ---------- Render Gradebook ---------- */
  function renderGradebook(students) {
    if (!students.length) {
      document.getElementById('gradebook-container').innerHTML =
        '<p class="text-muted">No students registered on this device.</p>';
      return;
    }

    const rows = students.map((s) => `
      <tr>
        <td class="student-name">${s.user.lastName}, ${s.user.firstName}</td>
        <td class="text-small">${s.user.section}</td>
        <td>${s.ww || '—'}</td>
        <td>${s.pt || '—'}</td>
        <td>${s.st1}</td>
        <td>${s.st2}</td>
        <td>${s.te}</td>
        <td>${s.ex || '—'}</td>
        <td class="final-grade ${s.passing ? 'passing' : 'failing'}">${s.final || '—'}</td>
        <td>${s.passing ? '✅' : '❌'}</td>
      </tr>
    `).join('');

    document.getElementById('gradebook-container').innerHTML = `
      <table class="gradebook-table">
        <thead>
          <tr>
            <th>Student</th>
            <th>Section</th>
            <th>WW (25%)</th>
            <th>PT (50%)</th>
            <th>ST1</th>
            <th>ST2</th>
            <th>TE</th>
            <th>EX (25%)</th>
            <th>Final</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  /* ---------- Render Reports ---------- */
  function renderReports(students) {
    const withGrades = students.filter((s) => s.final > 0);

    // Distribution: 70-75, 76-80, 81-85, 86-90, 91-95, 96-100
    const brackets = [
      { label: '70–75', min: 70, max: 75 },
      { label: '76–80', min: 76, max: 80 },
      { label: '81–85', min: 81, max: 85 },
      { label: '86–90', min: 86, max: 90 },
      { label: '91–95', min: 91, max: 95 },
      { label: '96–100', min: 96, max: 100 }
    ];

    const dist = brackets.map((b) => {
      const n = withGrades.filter((s) => s.final >= b.min && s.final <= b.max).length;
      return { ...b, count: n, pct: withGrades.length ? Math.round((n / withGrades.length) * 100) : 0 };
    });

    // Proficiency Level distribution
    const plMap = {};
    withGrades.forEach((s) => {
      const lvl = Transmutation.proficiencyLevel(s.final);
      plMap[lvl.level] = (plMap[lvl.level] || 0) + 1;
    });

    document.getElementById('cr-reports').innerHTML = `
      <div class="report-card">
        <h4>📊 Score Distribution</h4>
        ${dist.map((b) => `
          <div class="distribution-row">
            <span class="distribution-label">${b.label}</span>
            <div class="distribution-bar">
              <div class="distribution-fill" style="width:${b.pct}%;">${b.pct}%</div>
            </div>
            <span class="distribution-count">${b.count} student${b.count === 1 ? '' : 's'}</span>
          </div>
        `).join('')}
      </div>

      <div class="report-card">
        <h4>🎓 Proficiency Level</h4>
        ${Object.entries(plMap).map(([lvl, n]) => `
          <div class="distribution-row">
            <span class="distribution-label">${lvl}</span>
            <div class="distribution-bar">
              <div class="distribution-fill" style="width:${Math.round((n / withGrades.length) * 100)}%;">
                ${Math.round((n / withGrades.length) * 100)}%
              </div>
            </div>
            <span class="distribution-count">${n}</span>
          </div>
        `).join('') || '<p class="text-muted text-small">No data yet.</p>'}
      </div>

      <div class="report-card">
        <h4>📋 Component Averages</h4>
        ${withGrades.length ? `
          <div class="distribution-row">
            <span class="distribution-label">WW</span>
            <span class="distribution-count">${(withGrades.reduce((a, s) => a + s.ww, 0) / withGrades.length).toFixed(1)}</span>
          </div>
          <div class="distribution-row">
            <span class="distribution-label">PT</span>
            <span class="distribution-count">${(withGrades.reduce((a, s) => a + s.pt, 0) / withGrades.length).toFixed(1)}</span>
          </div>
          <div class="distribution-row">
            <span class="distribution-label">EX</span>
            <span class="distribution-count">${(withGrades.reduce((a, s) => a + s.ex, 0) / withGrades.length).toFixed(1)}</span>
          </div>
          <div class="distribution-row">
            <span class="distribution-label"><strong>Final</strong></span>
            <span class="distribution-count"><strong>${(withGrades.reduce((a, s) => a + s.final, 0) / withGrades.length).toFixed(1)}</strong></span>
          </div>
        ` : '<p class="text-muted text-small">No data yet.</p>'}
      </div>
    `;
  }

  /* ---------- Render Transmutation Table ---------- */
  function renderTransmutation() {
    const tbody = document.getElementById('transmutation-tbody');
    const entries = Object.entries(Transmutation.TABLE)
      .map(([raw, fin]) => ({ raw: Number(raw), fin }))
      .sort((a, b) => b.raw - a.raw);

    // Group 3 columns per row
    const rows = [];
    for (let i = 0; i < entries.length; i += 3) {
      const chunk = entries.slice(i, i + 3);
      while (chunk.length < 3) chunk.push(null);
      rows.push(chunk);
    }

    tbody.innerHTML = rows.map((chunk) => `
      <tr>
        ${chunk.map((e) => e ? `
          <td class="raw">${e.raw}</td>
          <td class="final">${e.fin}</td>
        ` : '<td></td><td></td>').join('')}
      </tr>
    `).join('');
  }

  /* ---------- CSV Export ---------- */
  function exportCSV() {
    const students = getStudentsData();
    const headers = ['LRN', 'Last Name', 'First Name', 'Middle Name', 'Grade', 'Section',
                     'WW', 'PT', 'ST1', 'ST2', 'TE', 'EX', 'Raw Final', 'Transmuted', 'Status'];

    const rows = students.map((s) => [
      s.user.lrn,
      s.user.lastName,
      s.user.firstName,
      s.user.middleName || '',
      s.user.gradeLevel,
      s.user.section,
      s.ww, s.pt,
      s.st1, s.st2, s.te,
      s.ex,
      s.rawFinal,
      s.final,
      s.passing ? 'Passing' : 'Failing'
    ]);

    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ClassRecord_${currentSubject}_${currentSY}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    APP.toast('CSV exported!', 'success');
  }

  /* ---------- Render All ---------- */
  function renderAll() {
    const students = getStudentsData();
    renderStats(students);
    renderGradebook(students);
    renderReports(students);
  }

  /* ---------- Init ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    const subjectSel = document.getElementById('cr-subject');
    const sySel = document.getElementById('cr-sy');

    subjectSel.addEventListener('change', () => {
      currentSubject = subjectSel.value;
      renderAll();
    });
    sySel.addEventListener('change', () => {
      currentSY = sySel.value;
      renderAll();
    });

    document.getElementById('btn-export-csv').addEventListener('click', exportCSV);

    renderAll();
    renderTransmutation();
  });
})();
