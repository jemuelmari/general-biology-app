/* ============================================================
   teacher.js — Teacher dashboard, item analysis, intervention
   Version: 1.0.0
   ============================================================ */

(() => {
  'use strict';

  const users = Store.getAllUsers();

  /* ---------- Stats ---------- */
  function computeStats() {
    let totalStudents = users.length;
    let totalAssessments = 0;
    let totalPassing = 0;
    let totalUrgent = 0;
    let stScores = [];

    users.forEach((u) => {
      const scores = Store.getScores(u.lrn);
      ['biol1', 'biol2'].forEach((s) => {
        const st = scores[s]?.st || {};
        Object.values(st).forEach((stData) => {
          if (stData && stData.total) {
            totalAssessments++;
            if (stData.passed) totalPassing++;
            stScores.push(stData.percent);

            // Urgent
            if (stData.percent < 65) totalUrgent++;
          }
        });
      });
    });

    const avg = stScores.length ? stScores.reduce((a, b) => a + b, 0) / stScores.length : 0;
    const passRate = totalAssessments ? Math.round((totalPassing / totalAssessments) * 100) : 0;

    return {
      totalStudents,
      totalAssessments,
      passRate,
      avgST: Math.round(avg * 10) / 10,
      urgent: totalUrgent
    };
  }

  const stats = computeStats();

  document.getElementById('teacher-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${stats.totalStudents}</div>
      <div class="stat-label">Students on Device</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.totalAssessments}</div>
      <div class="stat-label">ST Submissions</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.passRate}%</div>
      <div class="stat-label">Pass Rate</div>
    </div>
    <div class="stat-card" style="border-left-color:${stats.urgent > 0 ? 'var(--color-urgent)' : 'var(--color-success)'};">
      <div class="stat-value">${stats.avgST}%</div>
      <div class="stat-label">Avg ST Score</div>
    </div>
    <div class="stat-card" style="border-left-color:var(--color-danger);">
      <div class="stat-value">${stats.urgent}</div>
      <div class="stat-label">Urgent Cases</div>
    </div>
  `;

  /* ---------- Quick Actions ---------- */
  const actions = [
    { icon: '📥', title: 'Sync Center',    desc: 'Import student progress',       href: 'teacher/sync-center.html' },
    { icon: '📊', title: 'Item Analysis',  desc: 'Per-item difficulty & MPS',     href: 'teacher/item-analysis.html' },
    { icon: '🎯', title: 'Intervention',   desc: 'Students needing support',      href: 'teacher/intervention.html' },
    { icon: '📋', title: 'Class Record',   desc: 'Grades & transmutation',        href: 'classrecord.html' }
  ];

  document.getElementById('teacher-actions').innerHTML = actions.map((a) => `
    <a href="${a.href}" class="subject-card" style="text-decoration:none;border-top-color:#0d47a1;">
      <div style="font-size:2rem;">${a.icon}</div>
      <h3>${a.title}</h3>
      <p class="text-muted text-small">${a.desc}</p>
    </a>
  `).join('');

  /* ---------- Urgent List ---------- */
  function getUrgentStudents() {
    const urgent = [];
    users.forEach((u) => {
      const scores = Store.getScores(u.lrn);
      ['biol1', 'biol2'].forEach((s) => {
        const st = scores[s]?.st || {};
        Object.entries(st).forEach(([stId, stData]) => {
          if (stData && stData.percent < 65) {
            urgent.push({ user: u, subject: s, stId, percent: stData.percent });
          }
        });
      });
    });
    return urgent.sort((a, b) => a.percent - b.percent);
  }

  const urgent = getUrgentStudents();
  const urgentEl = document.getElementById('urgent-list');

  if (!urgent.length) {
    urgentEl.innerHTML = `<div class="alert alert-success">🎉 No urgent cases at this time.</div>`;
  } else {
    urgentEl.innerHTML = urgent.slice(0, 5).map((u) => `
      <div class="intervention-card urgent">
        <div class="student-name">${u.user.lastName}, ${u.user.firstName} ${u.user.middleName || ''}</div>
        <div class="student-meta">LRN: ${APP.formatLRN(u.user.lrn)} · ${u.user.section} · ${u.subject.toUpperCase()} · ${u.stId.toUpperCase()}</div>
        <div class="suggested-action">
          <strong>Score: ${u.percent}%</strong> — Immediate remediation and parent-teacher conference recommended.
        </div>
      </div>
    `).join('');
  }

  /* ---------- Recent Submissions ---------- */
  function getRecentSubs() {
    const subs = [];
    users.forEach((u) => {
      const scores = Store.getScores(u.lrn);
      ['biol1', 'biol2'].forEach((s) => {
        ['quiz', 'st', 'te'].forEach((type) => {
          const list = scores[s]?.[type] || {};
          Object.entries(list).forEach(([id, data]) => {
            if (data && data.timestamp) {
              subs.push({ user: u, subject: s, type, id, data });
            }
          });
        });
      });
    });
    return subs.sort((a, b) => new Date(b.data.timestamp) - new Date(a.data.timestamp));
  }

  const subs = getRecentSubs();
  const subsEl = document.getElementById('recent-subs');

  if (!subs.length) {
    subsEl.innerHTML = `<div class="alert alert-info">No submissions yet.</div>`;
  } else {
    subsEl.innerHTML = subs.slice(0, 10).map((s) => {
      const data = s.data;
      const cls = data.passed ? 'on-track' : 'remediation';
      return `
        <div class="intervention-card ${cls}">
          <div class="student-name">${s.user.lastName}, ${s.user.firstName}</div>
          <div class="student-meta">${s.subject.toUpperCase()} · ${s.id.toUpperCase()} · ${APP.formatDate(data.timestamp)}</div>
          <div class="suggested-action">
            Score: <strong>${data.score}/${data.total}</strong> (${data.percent}%)
            ${data.tabViolations ? `· ⚠️ ${data.tabViolations} tab switch(es)` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

})();
