/* ============================================================
   teacher.js — Teacher dashboard logic
   Version: 2.3.7
   ============================================================ */

(() => {
  'use strict';

  let users = Store.getAllUsers();
  users = APP.sortStudents(users, 'last', 'asc');

  /* ============================================================
     HERO META
     ============================================================ */
  (function renderHeroMeta() {
    const el = document.getElementById('hero-meta');
    if (!el) return;

    const activityData = ActivityTracker.getAllActivity();
    const totalStudents = users.length;
    const totalAssessments = users.reduce((a, u) => {
      const scores = Store.getScores(u.lrn);
      let count = 0;
      ['biol1', 'biol2'].forEach((s) => {
        count += Object.keys(scores[s]?.quizzes || {}).length;
        count += Object.keys(scores[s]?.st || {}).length;
        count += Object.keys(scores[s]?.te || {}).length;
      });
      return a + count;
    }, 0);
    const maleCount = users.filter((u) => APP.getSexValue(u.sex) === 'Male').length;
    const femaleCount = users.filter((u) => APP.getSexValue(u.sex) === 'Female').length;
    const totalActivities = activityData.reduce((a, s) =>
      a + s.summary.biol1.activitiesDone + s.summary.biol2.activitiesDone, 0);

    el.innerHTML = `
      <div class="teacher-hero-stat">👥 <strong>${totalStudents}</strong> Students</div>
      <div class="teacher-hero-stat">♂ <strong>${maleCount}</strong> Male</div>
      <div class="teacher-hero-stat">♀ <strong>${femaleCount}</strong> Female</div>
      <div class="teacher-hero-stat">📝 <strong>${totalAssessments}</strong> Submissions</div>
      <div class="teacher-hero-stat">🎮 <strong>${totalActivities}</strong> Activities</div>
    `;
  })();

  /* ============================================================
     COMPUTE STATS
     ============================================================ */
  function computeStats() {
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
            if (stData.percent < 65) totalUrgent++;
          }
        });
      });
    });

    const avg = stScores.length ? stScores.reduce((a, b) => a + b, 0) / stScores.length : 0;
    const passRate = totalAssessments ? Math.round((totalPassing / totalAssessments) * 100) : 0;

    return {
      totalStudents: users.length,
      totalAssessments,
      passRate,
      avgST: Math.round(avg * 10) / 10,
      urgent: totalUrgent
    };
  }

  const stats = computeStats();

  /* ============================================================
     KEY STATS
     ============================================================ */
  const keyStatsEl = document.getElementById('key-stats');
  if (keyStatsEl) {
    keyStatsEl.innerHTML = [
      UI.renderStatCard({
        value: stats.totalStudents,
        label: 'Total Students',
        icon: '👥',
        color: 'blue'
      }),
      UI.renderStatCard({
        value: stats.totalAssessments,
        label: 'ST Submissions',
        icon: '📝',
        color: 'purple'
      }),
      UI.renderStatCard({
        value: stats.passRate + '%',
        label: 'Pass Rate',
        icon: '✅',
        color: stats.passRate >= 75 ? 'green' : 'amber'
      }),
      UI.renderStatCard({
        value: stats.avgST + '%',
        label: 'Avg ST Score',
        icon: '📊',
        color: stats.avgST >= 80 ? 'green' : 'amber'
      }),
      UI.renderStatCard({
        value: stats.urgent,
        label: 'Urgent Cases',
        icon: '🚨',
        color: stats.urgent > 0 ? 'red' : 'green'
      })
    ].join('');
  }

  /* ============================================================
     QUICK ACTIONS
     ============================================================ */
  const lockedCount = (() => {
    let count = 0;
    users.forEach((u) => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(`gba_v1_lock_${u.lrn}_`));
      count += keys.length;
    });
    return count;
  })();

  const actions = [
    { icon: '🎮', title: 'Activity Tracker', desc: 'Track lesson activity completion, badges, and points', href: 'teacher/activity-tracker.html', color: '#1b7a3d', badge: null },
    { icon: '📝', title: 'Assessment Tracker', desc: 'Track quiz, ST, and term exam performance', href: 'teacher/assessment-tracker.html', color: '#0277bd', badge: null },
    { icon: '🔒', title: 'Locked Assessments', desc: 'Manage locked submissions — unlock for retakes', href: 'teacher/locked-assessments.html', color: '#c62828', badge: lockedCount > 0 ? { text: lockedCount + ' locked', type: 'alert' } : null },
    { icon: '📥', title: 'Sync Center', desc: 'Import student progress from other devices', href: 'teacher/sync-center.html', color: '#ed6c02', badge: { text: 'Cross-device', type: 'info' } },
    { icon: '📊', title: 'Item Analysis', desc: 'Per-item difficulty and Most/Least Learned competencies', href: 'teacher/item-analysis.html', color: '#6a1b9a', badge: null },
    { icon: '🎯', title: 'Intervention', desc: 'Students needing support, auto-classified', href: 'teacher/intervention.html', color: '#c62828', badge: stats.urgent > 0 ? { text: stats.urgent + ' urgent', type: 'alert' } : null },
    { icon: '🔤', title: 'Normalize Names', desc: 'Standardize record format across all students', href: 'teacher/normalize-names.html', color: '#00695c', badge: null },
    { icon: '📋', title: 'Class Record', desc: 'Complete gradebook with transmutation and reports', href: 'classrecord.html', color: '#455a64', badge: null }
  ];

  const quickActionsEl = document.getElementById('quick-actions');
  if (quickActionsEl) {
    quickActionsEl.innerHTML = actions.map((a) => `
      <a href="${a.href}" class="action-card">
        ${a.badge ? `<span class="action-badge ${a.badge.type}">${a.badge.text}</span>` : ''}
        <div class="action-icon" style="background:${hexToRgba(a.color, 0.1)};color:${a.color};">
          ${a.icon}
        </div>
        <h3>${a.title}</h3>
        <p>${a.desc}</p>
      </a>
    `).join('');
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /* ============================================================
     DISTRIBUTION REPORTS
     ============================================================ */
  function collectStudentStats() {
    return users.map((u) => {
      const scores = Store.getScores(u.lrn);
      const stAll = [];
      let subCount = 0;

      ['biol1', 'biol2'].forEach((s) => {
        Object.values(scores[s]?.st || {}).forEach((st) => {
          if (st && st.total) stAll.push(st.percent);
        });
        subCount += Object.keys(scores[s]?.quizzes || {}).length;
        subCount += Object.keys(scores[s]?.st || {}).length;
        subCount += Object.keys(scores[s]?.te || {}).length;
      });

      const avg = stAll.length ? stAll.reduce((a, b) => a + b, 0) / stAll.length : 0;
      return { user: u, stAvg: avg, stCount: stAll.length, subCount };
    });
  }

  // 1. ST Average Distribution
  (function renderDistSTAvg() {
    const el = document.getElementById('dist-st-avg');
    if (!el) return;

    const data = collectStudentStats().filter((d) => d.stCount > 0);
    const brackets = [
      { label: '96–100', min: 96, max: 100, color: 'linear-gradient(90deg, #1b5e20, #4caf50)' },
      { label: '86–95',  min: 86, max: 95,  color: 'linear-gradient(90deg, #2e7d32, #66bb6a)' },
      { label: '76–85',  min: 76, max: 85,  color: 'linear-gradient(90deg, #0277bd, #42a5f5)' },
      { label: '66–75',  min: 66, max: 75,  color: 'linear-gradient(90deg, #ed6c02, #ffb74d)' },
      { label: '0–65',   min: 0,  max: 65,  color: 'linear-gradient(90deg, #c62828, #ef5350)' }
    ];

    if (!data.length) {
      el.innerHTML = `
        <div style="text-align:center;padding:24px 12px;">
          <div style="font-size:2.5rem;opacity:0.4;">📝</div>
          <p style="color:#90a4ae;font-size:0.9rem;margin:8px 0 0;">No ST submissions yet</p>
        </div>
      `;
      return;
    }

    el.innerHTML = brackets.map((b) => {
      const count = data.filter((d) => d.stAvg >= b.min && d.stAvg <= b.max).length;
      return UI.renderDistributionRow(b.label, count, data.length, b.color);
    }).join('');
  })();

  // 2. Submission Status
  (function renderDistSubmissions() {
    const el = document.getElementById('dist-submissions');
    if (!el) return;

    const data = collectStudentStats();
    const full = data.filter((d) => d.subCount >= 4).length;
    const partial = data.filter((d) => d.subCount > 0 && d.subCount < 4).length;
    const none = data.filter((d) => d.subCount === 0).length;

    el.innerHTML = [
      UI.renderDistributionRow('Complete', full, data.length, 'linear-gradient(90deg, #1b5e20, #4caf50)'),
      UI.renderDistributionRow('Partial', partial, data.length, 'linear-gradient(90deg, #ed6c02, #ffb74d)'),
      UI.renderDistributionRow('No work', none, data.length, 'linear-gradient(90deg, #c62828, #ef5350)')
    ].join('');
  })();

  // 3. Activity Engagement
  (function renderDistActivity() {
    const el = document.getElementById('dist-activity');
    if (!el) return;

    const activity = ActivityTracker.getAllActivity();
    if (!activity.length) {
      el.innerHTML = `
        <div style="text-align:center;padding:24px 12px;">
          <div style="font-size:2.5rem;opacity:0.4;">🎮</div>
          <p style="color:#90a4ae;font-size:0.9rem;margin:8px 0 0;">No activity data yet</p>
        </div>
      `;
      return;
    }

    const avg = activity.reduce((a, s) => {
      const s1 = s.summary.biol1.completionPct;
      const s2 = s.summary.biol2.completionPct;
      return a + (s1 + s2) / 2;
    }, 0) / activity.length;

    const high = activity.filter((s) => ((s.summary.biol1.completionPct + s.summary.biol2.completionPct) / 2) >= 75).length;
    const mid = activity.filter((s) => {
      const avg = (s.summary.biol1.completionPct + s.summary.biol2.completionPct) / 2;
      return avg >= 40 && avg < 75;
    }).length;
    const low = activity.length - high - mid;

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px;">
        ${UI.renderProgressRing(avg, { size: 64, stroke: 7, color: UI.getPctHex(avg) })}
        <div>
          <div style="font-size:1.5rem;font-weight:800;color:#1a1a1a;">${Math.round(avg)}%</div>
          <div style="font-size:0.75rem;color:#78909c;text-transform:uppercase;font-weight:700;letter-spacing:0.5px;">Class Average</div>
        </div>
      </div>
      ${UI.renderDistributionRow('High', high, activity.length, 'linear-gradient(90deg, #1b5e20, #4caf50)')}
      ${UI.renderDistributionRow('Mid', mid, activity.length, 'linear-gradient(90deg, #ed6c02, #ffb74d)')}
      ${UI.renderDistributionRow('Low', low, activity.length, 'linear-gradient(90deg, #c62828, #ef5350)')}
    `;
  })();

  /* ============================================================
     URGENT LIST
     ============================================================ */
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
    return urgent.sort((a, b) => {
      if (a.percent !== b.percent) return a.percent - b.percent;
      return (a.user.lastName || '').localeCompare(b.user.lastName || '');
    });
  }

  const urgent = getUrgentStudents();
  const urgentEl = document.getElementById('urgent-list');

  if (urgentEl) {
    if (!urgent.length) {
      urgentEl.innerHTML = `
        <div style="background:#fff;border-radius:14px;padding:32px 24px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.05);border:1px solid rgba(0,0,0,0.04);">
          <div style="font-size:3rem;">🎉</div>
          <h3 style="margin:12px 0 6px;color:#2e7d32;">All Clear!</h3>
          <p style="color:#5f6368;font-size:0.9rem;margin:0;">No urgent cases. All students are performing above the 65% threshold.</p>
        </div>
      `;
    } else {
      urgentEl.innerHTML = urgent.slice(0, 5).map((u) => {
        const avatar = UI.renderAvatar(u.user.firstName, u.user.lastName, u.user.lrn);
        return `
          <div style="background:#fff;border-radius:12px;padding:16px 20px;box-shadow:0 2px 8px rgba(0,0,0,0.05);border-left:4px solid #c62828;margin-bottom:12px;display:flex;gap:14px;align-items:flex-start;">
            ${avatar}
            <div style="flex:1;">
              <div style="font-weight:700;font-size:0.95rem;color:#1a1a1a;margin-bottom:4px;">
                ${APP.formatFullName(u.user.lastName, u.user.firstName, u.user.middleName)}
                ${APP.getSexBadge(u.user.sex)}
              </div>
              <div style="font-size:0.78rem;color:#78909c;margin-bottom:8px;">
                LRN: ${APP.formatLRN(u.user.lrn)} · ${u.user.section} · ${u.subject.toUpperCase()} · ${u.stId.toUpperCase()}
              </div>
              <div style="font-size:0.85rem;padding:10px 12px;background:#fef2f2;border-radius:8px;color:#991b1b;">
                <strong>Score: ${u.percent}%</strong> — Immediate remediation and parent-teacher conference recommended.
              </div>
            </div>
            ${UI.renderProgressRing(u.percent, { size: 52, stroke: 5, color: '#c62828' })}
          </div>
        `;
      }).join('') + (urgent.length > 5 ? `
        <div style="text-align:center;margin-top:12px;">
          <a href="teacher/intervention.html" class="btn btn-outline" style="font-size:0.85rem;">
            View all ${urgent.length} urgent cases →
          </a>
        </div>
      ` : '');
    }
  }

  /* ============================================================
     TOP PERFORMERS
     ============================================================ */
  (function renderTopPerformers() {
    const el = document.getElementById('top-performers');
    if (!el) return;

    const data = collectStudentStats().filter((d) => d.stCount > 0);
    if (!data.length) {
      el.innerHTML = `
        <div style="background:#fff;border-radius:14px;padding:32px 24px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.05);border:1px solid rgba(0,0,0,0.04);">
          <div style="font-size:3rem;">🏆</div>
          <h3 style="margin:12px 0 6px;color:#1a1a1a;">No Assessment Data Yet</h3>
          <p style="color:#5f6368;font-size:0.9rem;margin:0;">Top performers will appear here once students submit assessments.</p>
        </div>
      `;
      return;
    }

    const top = data
      .sort((a, b) => {
        if (b.stAvg !== a.stAvg) return b.stAvg - a.stAvg;
        return (a.user.lastName || '').localeCompare(b.user.lastName || '');
      })
      .slice(0, 5);

    el.innerHTML = `
      <div style="background:#fff;border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,0.06);overflow:hidden;">
        <div style="overflow-x:auto;">
          <table class="modern-table">
            <thead>
              <tr>
                <th style="width:50px;text-align:center;">#</th>
                <th>Student</th>
                <th style="text-align:center;">Sex</th>
                <th style="text-align:center;">ST Submissions</th>
                <th style="text-align:center;">Average</th>
                <th style="text-align:center;">Proficiency</th>
              </tr>
            </thead>
            <tbody>
              ${top.map((d, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
                return `
                  <tr>
                    <td style="text-align:center;font-size:1.1rem;">${medal}</td>
                    <td>${UI.renderStudentCell(d.user)}</td>
                    <td style="text-align:center;">${APP.getSexBadge(d.user.sex)}</td>
                    <td style="text-align:center;font-weight:600;">${d.stCount}</td>
                    <td style="text-align:center;font-weight:800;color:${UI.getPctHex(d.stAvg)};font-size:0.95rem;">
                      ${d.stAvg.toFixed(1)}%
                    </td>
                    <td style="text-align:center;">${UI.renderPLBadge(d.stAvg)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  })();

  /* ============================================================
     RECENT SUBMISSIONS
     ============================================================ */
  function getRecentSubs() {
    const subs = [];
    users.forEach((u) => {
      const scores = Store.getScores(u.lrn);
      ['biol1', 'biol2'].forEach((s) => {
        ['quiz', 'quizzes', 'st', 'te'].forEach((type) => {
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

  if (subsEl) {
    if (!subs.length) {
      subsEl.innerHTML = `
        <div style="background:#fff;border-radius:14px;padding:32px 24px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.05);border:1px solid rgba(0,0,0,0.04);">
          <div style="font-size:3rem;">📭</div>
          <h3 style="margin:12px 0 6px;color:#1a1a1a;">No Submissions Yet</h3>
          <p style="color:#5f6368;font-size:0.9rem;margin:0;">Student submissions will appear here once they complete quizzes or STs.</p>
        </div>
      `;
    } else {
      subsEl.innerHTML = subs.slice(0, 10).map((s) => {
        const data = s.data;
        const passed = data.passed;
        const cls = passed ? '#2e7d32' : '#c62828';
        const avatar = UI.renderAvatar(s.user.firstName, s.user.lastName, s.user.lrn);
        return `
          <div style="background:#fff;border-radius:12px;padding:14px 18px;box-shadow:0 2px 8px rgba(0,0,0,0.05);border-left:4px solid ${cls};margin-bottom:10px;display:flex;gap:14px;align-items:center;">
            ${avatar}
            <div style="flex:1;">
              <div style="font-weight:700;font-size:0.9rem;color:#1a1a1a;">
                ${APP.formatFullName(s.user.lastName, s.user.firstName, s.user.middleName)}
                ${APP.getSexBadge(s.user.sex)}
              </div>
              <div style="font-size:0.75rem;color:#78909c;margin-top:2px;">
                ${s.subject.toUpperCase()} · ${s.id.toUpperCase()} · ${UI.fmtDateRelative(data.timestamp)}
              </div>
            </div>
            <div style="text-align:center;min-width:80px;">
              <div style="font-weight:800;color:${cls};font-size:1.1rem;">${data.percent}%</div>
              <div style="font-size:0.7rem;color:#90a4ae;">${data.score}/${data.total}</div>
            </div>
            ${data.tabViolations ? `<span style="font-size:1.2rem;" title="${data.tabViolations} tab switch(es)">⚠️</span>` : ''}
          </div>
        `;
      }).join('');
    }
  }

})();
