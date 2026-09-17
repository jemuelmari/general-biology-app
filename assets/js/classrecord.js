/* ============================================================
   classrecord.js — Gradebook, reports, transmutation
   Version: 2.0.0
   ============================================================ */

(() => {
  'use strict';

  let currentSubject = 'biol1';
  let currentSection = '';
  let currentSearch = '';

  const WEIGHTS = { ww: 0.25, pt: 0.50, ex: 0.25 };
  const EX_INTERNAL = { st1: 0.30, st2: 0.30, te: 0.40 };

  /* ============================================================
     TAB SWITCHING
     ============================================================ */
  const tabs = document.querySelectorAll('.cr-tab');
  const panels = {
    grades: document.getElementById('tab-grades'),
    activities: document.getElementById('tab-activities'),
    reports: document.getElementById('tab-reports'),
    transmutation: document.getElementById('tab-transmutation')
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const key = tab.dataset.tab;
      Object.entries(panels).forEach(([k, p]) => {
        p.classList.toggle('hidden', k !== key);
      });
      if (key === 'activities') renderActivityTab();
      if (key === 'reports') renderReports();
    });
  });

  /* ============================================================
     HELPERS
     ============================================================ */
  function pctOf(score, total) {
    if (!total) return 0;
    return (score / total) * 100;
  }

  function getStudentsData() {
    const users = Store.getAllUsers();
    return users.map((u) => {
      const scores = Store.getScores(u.lrn)[currentSubject] || {};

      // Written Works (Quizzes)
      const quizzes = Object.values(scores.quizzes || {}).filter((q) => q && q.total);
      const wwAvg = quizzes.length
        ? quizzes.reduce((a, q) => a + pctOf(q.score, q.total), 0) / quizzes.length
        : 0;

      // Performance Tasks
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

      const ex = (st1Pct * EX_INTERNAL.st1) + (st2Pct * EX_INTERNAL.st2) + (tePct * EX_INTERNAL.te);
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

  function applyFilters(students) {
    let result = students;
    if (currentSection) {
      result = result.filter((s) => s.user.section === currentSection);
    }
    if (currentSearch) {
      const q = currentSearch.toLowerCase();
      result = result.filter((s) =>
        `${s.user.lastName} ${s.user.firstName} ${s.user.middleName || ''} ${s.user.lrn}`
          .toLowerCase()
          .includes(q)
      );
    }
    return result;
  }

  /* ============================================================
     SUBJECT / SECTION / SEARCH FILTERS
     ============================================================ */
  document.getElementById('cr-subject').addEventListener('change', (e) => {
    currentSubject = e.target.value;
    renderGrades();
  });

  document.getElementById('cr-section').addEventListener('change', (e) => {
    currentSection = e.target.value;
    renderGrades();
  });

  document.getElementById('cr-search').addEventListener('input', (e) => {
    currentSearch = e.target.value;
    renderGrades();
  });

  document.getElementById('btn-clear-filters').addEventListener('click', () => {
    currentSection = '';
    currentSearch = '';
    document.getElementById('cr-section').value = '';
    document.getElementById('cr-search').value = '';
    renderGrades();
  });

  /* Populate section dropdown */
  (function populateSections() {
    const sections = [...new Set(Store.getAllUsers().map((u) => u.section).filter(Boolean))].sort();
    const sel = document.getElementById('cr-section');
    sections.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      sel.appendChild(opt);
    });
  })();

  /* ============================================================
     TAB 1: GRADES
     ============================================================ */
  function renderGrades() {
    const allStudents = getStudentsData();
    const students = applyFilters(allStudents);

    renderGradesStats(students);
    renderGradebookTable(students);
  }

  function renderGradesStats(students) {
    const withGrades = students.filter((s) => s.final > 0);
    const passing = withGrades.filter((s) => s.passing).length;
    const avg = withGrades.length
      ? withGrades.reduce((a, s) => a + s.final, 0) / withGrades.length
      : 0;
    const highest = withGrades.length
      ? Math.max(...withGrades.map((s) => s.final))
      : 0;

    const el = document.getElementById('cr-stats');
    el.innerHTML = `
      <div class="cr-stat-card blue">
        <div class="cs-icon">👥</div>
        <div class="cs-value">${students.length}</div>
        <div class="cs-label">Total Students</div>
      </div>
      <div class="cr-stat-card green">
        <div class="cs-icon">✅</div>
        <div class="cs-value">${passing}</div>
        <div class="cs-label">Passing</div>
      </div>
      <div class="cr-stat-card red">
        <div class="cs-icon">⚠️</div>
        <div class="cs-value">${withGrades.length - passing}</div>
        <div class="cs-label">Failing</div>
      </div>
      <div class="cr-stat-card amber">
        <div class="cs-icon">📊</div>
        <div class="cs-value">${avg.toFixed(1)}</div>
        <div class="cs-label">Class Average</div>
      </div>
      <div class="cr-stat-card green">
        <div class="cs-icon">🏆</div>
        <div class="cs-value">${highest}</div>
        <div class="cs-label">Highest Grade</div>
      </div>
    `;
  }

  function renderGradebookTable(students) {
    const head = document.getElementById('gradebook-head');
    const body = document.getElementById('gradebook-body');

    head.innerHTML = `
      <tr>
        <th rowspan="2" style="vertical-align:bottom;">Student</th>
        <th rowspan="2" style="vertical-align:bottom;">Section</th>
        <th colspan="3" class="col-group">Written Works (25%)</th>
        <th colspan="2" class="col-group">Summative Tests (30%)</th>
        <th colspan="1" class="col-group">Term Exam (40%)</th>
        <th colspan="1" class="col-group">PT (50%)</th>
        <th colspan="2" class="col-group">Final</th>
      </tr>
      <tr>
        <th>Q1</th>
        <th>Q2</th>
        <th>Q3</th>
        <th>ST1</th>
        <th>ST2</th>
        <th>TE</th>
        <th>Avg</th>
        <th>Grade</th>
        <th>Status</th>
      </tr>
    `;

    if (!students.length) {
      body.innerHTML = `
        <tr><td colspan="11" style="text-align:center;padding:40px;color:#90a4ae;">
          No students match the current filters.
        </td></tr>
      `;
      return;
    }

    body.innerHTML = students.map((s) => {
      const scoreCell = (v) => v === '—'
        ? '<td class="empty-cell">—</td>'
        : `<td class="grade-cell">${v}</td>`;

      const q1 = s.user.lrn ? '—' : '—'; // placeholder for individual quiz columns if needed
      // Simplified: use WW average in Q1 column, blank Q2/Q3 if we don't track per-quiz separately
      const scores = Store.getScores(s.user.lrn)[currentSubject] || {};
      const quizIds = ['quiz1', 'quiz2', 'quiz3'].map((id) => {
        const key = `${currentSubject}-${id}`;
        return scores.quizzes?.[key];
      });

      const colQuiz = (q) => {
        if (!q || !q.total) return '<td class="empty-cell">—</td>';
        return `<td class="grade-cell">${q.score}/${q.total}</td>`;
      };

      const statusBadge = s.passing
        ? '<span class="status-badge pass">✓</span>'
        : '<span class="status-badge fail">✗</span>';

      return `
        <tr>
          <td class="student-cell">${UI.renderStudentCell(s.user)}</td>
          <td class="section-cell">${s.user.section}</td>
          ${colQuiz(quizIds[0])}
          ${colQuiz(quizIds[1])}
          ${colQuiz(quizIds[2])}
          ${scoreCell(s.st1)}
          ${scoreCell(s.st2)}
          ${scoreCell(s.te)}
          <td class="grade-cell">${s.pt || '—'}</td>
          <td class="final-grade ${s.passing ? 'passing' : 'failing'}">${s.final || '—'}</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');
  }

  /* ============================================================
     TAB 2: ACTIVITIES
     ============================================================ */
  function renderActivityTab() {
    const subject = document.getElementById('at-subject').value;
    const filter = document.getElementById('at-filter').value;
    const all = ActivityTracker.getAllActivity();

    let filtered = all;
    if (filter === 'behind') {
      filtered = all.filter((s) => s.summary[subject].completionPct < 50);
    } else if (filter === 'ontrack') {
      filtered = all.filter((s) => {
        const pct = s.summary[subject].completionPct;
        return pct >= 50 && pct < 90;
      });
    } else if (filter === 'complete') {
      filtered = all.filter((s) => s.summary[subject].completionPct >= 90);
    }

    // Stats
    const avgCompletion = all.length
      ? Math.round(all.reduce((a, s) => a + s.summary[subject].completionPct, 0) / all.length)
      : 0;
    const totalActivities = all.reduce((a, s) => a + s.summary[subject].activitiesDone, 0);
    const totalBadges = all.reduce((a, s) => a + s.summary[subject].badgesEarned, 0);
    const behind = all.filter((s) => s.summary[subject].completionPct < 50).length;

    document.getElementById('at-stats').innerHTML = `
      <div class="cr-stat-card blue">
        <div class="cs-icon">👥</div>
        <div class="cs-value">${all.length}</div>
        <div class="cs-label">Students</div>
      </div>
      <div class="cr-stat-card green">
        <div class="cs-icon">📊</div>
        <div class="cs-value">${avgCompletion}%</div>
        <div class="cs-label">Avg Completion</div>
      </div>
      <div class="cr-stat-card amber">
        <div class="cs-icon">🎮</div>
        <div class="cs-value">${totalActivities}</div>
        <div class="cs-label">Activities Done</div>
      </div>
      <div class="cr-stat-card amber">
        <div class="cs-icon">🏆</div>
        <div class="cs-value">${totalBadges}</div>
        <div class="cs-label">Badges Earned</div>
      </div>
      <div class="cr-stat-card ${behind > 0 ? 'red' : 'green'}">
        <div class="cs-icon">⚠️</div>
        <div class="cs-value">${behind}</div>
        <div class="cs-label">Behind &lt; 50%</div>
      </div>
    `;

    if (!filtered.length) {
      document.getElementById('at-table').innerHTML = `
        <div style="padding:40px;text-align:center;color:#90a4ae;">
          No students match this filter.
        </div>
      `;
      return;
    }

    document.getElementById('at-table').innerHTML = `
      <table class="modern-table">
        <thead>
          <tr>
            <th>Student</th>
            <th>Section</th>
            <th style="text-align:center;">Days Done</th>
            <th style="text-align:center;">Activities</th>
            <th style="text-align:center;min-width:200px;">Completion</th>
            <th style="text-align:center;">Badges</th>
            <th style="text-align:center;">Points</th>
            <th style="text-align:center;">Progress</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((s) => {
            const sm = s.summary[subject];
            const color = UI.getPctHex(sm.completionPct);
            return `
              <tr>
                <td>${UI.renderStudentCell(s.user)}</td>
                <td class="section-cell">${s.user.section}</td>
                <td style="text-align:center;font-weight:600;">${sm.completedDays}/${sm.totalDays}</td>
                <td style="text-align:center;">${sm.activitiesDone}</td>
                <td>
                  ${UI.renderProgressBar(sm.completionPct)}
                  <div style="text-align:right;font-size:0.75rem;color:${color};font-weight:700;margin-top:4px;">
                    ${sm.completionPct}%
                  </div>
                </td>
                <td style="text-align:center;">🏆 ${sm.badgesEarned}</td>
                <td style="text-align:center;">⭐ ${sm.points}</td>
                <td style="text-align:center;">
                  ${UI.renderProgressRing(sm.completionPct, { size: 44, stroke: 5, color })}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  document.getElementById('at-subject').addEventListener('change', renderActivityTab);
  document.getElementById('at-filter').addEventListener('change', renderActivityTab);

  /* ============================================================
     TAB 3: REPORTS
     ============================================================ */
  function renderReports() {
    const students = applyFilters(getStudentsData());
    const withGrades = students.filter((s) => s.final > 0);

    // 1. Distribution by grade bracket
    const brackets = [
      { label: '96–100', min: 96, max: 100, color: 'linear-gradient(90deg, #1b5e20, #4caf50)' },
      { label: '86–95',  min: 86, max: 95,  color: 'linear-gradient(90deg, #2e7d32, #66bb6a)' },
      { label: '81–85',  min: 81, max: 85,  color: 'linear-gradient(90deg, #0277bd, #42a5f5)' },
      { label: '76–80',  min: 76, max: 80,  color: 'linear-gradient(90deg, #0288d1, #4fc3f7)' },
      { label: '70–75',  min: 70, max: 75,  color: 'linear-gradient(90deg, #ed6c02, #ffb74d)' },
      { label: 'Below 70', min: 0, max: 69, color: 'linear-gradient(90deg, #c62828, #ef5350)' }
    ];

    const dist = brackets.map((b) => {
      const count = withGrades.filter((s) => s.final >= b.min && s.final <= b.max).length;
      return { ...b, count };
    });

    // 2. Proficiency Level distribution
    const plMap = {};
    withGrades.forEach((s) => {
      const lvl = Transmutation.proficiencyLevel(s.final);
      plMap[lvl.level] = (plMap[lvl.level] || 0) + 1;
    });

    // 3. Component averages
    const avg = (key) => withGrades.length
      ? (withGrades.reduce((a, s) => a + s[key], 0) / withGrades.length).toFixed(1)
      : '—';

    const reportsGrid = document.getElementById('reports-grid');
    reportsGrid.innerHTML = `
      <div class="report-card">
        <h4>📊 Grade Distribution</h4>
        ${dist.map((b) => UI.renderDistributionRow(b.label, b.count, withGrades.length, b.color)).join('')}
      </div>

      <div class="report-card">
        <h4>🎓 Proficiency Level</h4>
        ${Object.entries(plMap).length
          ? Object.entries(plMap).map(([lvl, n]) =>
              UI.renderDistributionRow(lvl, n, withGrades.length, 'linear-gradient(90deg, #6a1b9a, #ab47bc)')
            ).join('')
          : '<div style="color:#90a4ae;font-size:0.85rem;">No data yet.</div>'}
      </div>

      <div class="report-card">
        <h4>📈 Component Averages</h4>
        <div class="distribution-row">
          <span class="distribution-label">WW (25%)</span>
          <div class="distribution-bar">
            <div class="distribution-fill" style="width:${avg('ww')}%;">${avg('ww')}</div>
          </div>
        </div>
        <div class="distribution-row">
          <span class="distribution-label">PT (50%)</span>
          <div class="distribution-bar">
            <div class="distribution-fill" style="width:${avg('pt')}%;background:linear-gradient(90deg, #0277bd, #42a5f5);">${avg('pt')}</div>
          </div>
        </div>
        <div class="distribution-row">
          <span class="distribution-label">EX (25%)</span>
          <div class="distribution-bar">
            <div class="distribution-fill" style="width:${avg('ex')}%;background:linear-gradient(90deg, #ed6c02, #ffb74d);">${avg('ex')}</div>
          </div>
        </div>
        <div class="distribution-row" style="margin-top:12px;border-top:2px solid #f3e5f5;padding-top:12px;">
          <span class="distribution-label" style="font-weight:800;">Final</span>
          <div class="distribution-bar">
            <div class="distribution-fill" style="width:${avg('final')}%;background:linear-gradient(90deg, #1b5e20, #4caf50);font-weight:800;">${avg('final')}</div>
          </div>
        </div>
      </div>
    `;

    // Per-student scores table
    const head = document.getElementById('report-head');
    const body = document.getElementById('report-body');

    head.innerHTML = `
      <tr>
        <th>Student</th>
        <th style="text-align:center;">Section</th>
        <th style="text-align:center;">WW</th>
        <th style="text-align:center;">PT</th>
        <th style="text-align:center;">ST1</th>
        <th style="text-align:center;">ST2</th>
        <th style="text-align:center;">TE</th>
        <th style="text-align:center;">EX</th>
        <th style="text-align:center;">Raw</th>
        <th style="text-align:center;">Final</th>
        <th style="text-align:center;">PL</th>
        <th style="text-align:center;">Status</th>
      </tr>
    `;

    body.innerHTML = withGrades
      .sort((a, b) => b.final - a.final)
      .map((s) => `
        <tr>
          <td>${UI.renderStudentCell(s.user)}</td>
          <td style="text-align:center;" class="section-cell">${s.user.section}</td>
          <td style="text-align:center;" class="grade-cell">${s.ww}</td>
          <td style="text-align:center;" class="grade-cell">${s.pt}</td>
          <td style="text-align:center;" class="grade-cell">${s.st1}</td>
          <td style="text-align:center;" class="grade-cell">${s.st2}</td>
          <td style="text-align:center;" class="grade-cell">${s.te}</td>
          <td style="text-align:center;" class="grade-cell">${s.ex}</td>
          <td style="text-align:center;color:#90a4ae;font-size:0.8rem;">${s.rawFinal}</td>
          <td style="text-align:center;font-weight:800;color:${s.passing ? '#2e7d32' : '#c62828'};font-size:0.95rem;">${s.final}</td>
          <td style="text-align:center;">${UI.renderPLBadge(s.final)}</td>
          <td style="text-align:center;">
            ${s.passing ? '<span class="status-badge pass">✓</span>' : '<span class="status-badge fail">✗</span>'}
          </td>
        </tr>
      `).join('') || `
        <tr><td colspan="12" style="text-align:center;padding:40px;color:#90a4ae;">No data yet.</td></tr>
      `;
  }

  /* ============================================================
     TAB 4: TRANSMUTATION TABLE
     ============================================================ */
  function renderTransmutation() {
    const tbody = document.getElementById('transmutation-tbody');
    const entries = Object.entries(Transmutation.TABLE)
      .map(([raw, fin]) => ({ raw: Number(raw), fin }))
      .sort((a, b) => b.raw - a.raw);

    const rows = [];
    for (let i = 0; i < entries.length; i += 3) {
      const chunk = entries.slice(i, i + 3);
      while (chunk.length < 3) chunk.push(null);
      rows.push(chunk);
    }

    tbody.innerHTML = rows.map((chunk) => `
      <tr>
        ${chunk.map((e) => e
          ? `<td class="raw">${e.raw}</td><td class="final">${e.fin}</td>`
          : '<td></td><td></td>'
        ).join('')}
      </tr>
    `).join('');
  }

  /* ============================================================
     CSV EXPORT
     ============================================================ */
  document.getElementById('btn-export-csv').addEventListener('click', () => {
    const students = applyFilters(getStudentsData());
    const headers = [
      'LRN', 'Last Name', 'First Name', 'Middle Name', 'Grade', 'Section',
      'WW', 'PT', 'ST1', 'ST2', 'TE', 'EX', 'Raw Final', 'Transmuted', 'Status'
    ];
    const rows = students.map((s) => [
      s.user.lrn,
      s.user.lastName,
      s.user.firstName,
      s.user.middleName || '',
      s.user.gradeLevel,
      s.user.section,
      s.ww, s.pt, s.st1, s.st2, s.te, s.ex,
      s.rawFinal, s.final,
      s.passing ? 'Passing' : 'Failing'
    ]);
    const filename = `ClassRecord_${currentSubject}_${new Date().toISOString().slice(0, 10)}.csv`;
    UI.exportCSV(filename, headers, rows);
    UI.toast('CSV exported!', 'success');
  });

  /* ============================================================
     PRINT
     ============================================================ */
  document.getElementById('btn-print').addEventListener('click', () => {
    window.print();
  });

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    renderGrades();
    renderTransmutation();
  });
})();
