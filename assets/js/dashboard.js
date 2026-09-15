/* ============================================================
   dashboard.js — Student dashboard logic
   Version: 1.0.0
   ============================================================ */

(() => {
  'use strict';

  /* ---------- Auth guard ---------- */
  const user = Store.getCurrentUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  /* ---------- User pill ---------- */
  APP.$('#user-pill').textContent =
    `${user.firstName} ${user.lastName.charAt(0)}. · ${user.section}`;

  /* ---------- Greeting ---------- */
  APP.$('#greeting-name').textContent = `Hello, ${user.firstName}! 👋`;
  APP.$('#greeting-meta').textContent =
    `LRN: ${APP.formatLRN(user.lrn)} · Grade ${user.gradeLevel} — ${user.section}`;

  /* ---------- Compute standing ---------- */
  function computeStanding() {
    const scores = Store.getScores(user.lrn);
    const allSTs = [];

    ['biol1', 'biol2'].forEach((subj) => {
      const st = scores[subj]?.st || {};
      Object.values(st).forEach((s) => {
        if (s && s.total) allSTs.push((s.score / s.total) * 100);
      });
    });

    if (!allSTs.length) return { label: 'No data yet', key: 'on-track', avg: null };

    const avg = allSTs.reduce((a, b) => a + b, 0) / allSTs.length;
    return { ...Transmutation.classifyStudent(avg), avg };
  }

  const standing = computeStanding();

  APP.$('#standing-badge').innerHTML = `
    <div style="text-align:right;">
      <div class="badge badge-${standing.key}" style="font-size:0.9rem;padding:8px 16px;">
        ${standing.label}
      </div>
      ${standing.avg !== null ? `<div class="text-small text-muted" style="margin-top:4px;">ST Average: ${standing.avg.toFixed(1)}%</div>` : ''}
    </div>
  `;

  /* ---------- Quick stats ---------- */
  const progress = Store.getProgress(user.lrn);
  const badges = Store.getBadges(user.lrn);

  const stats = [
    { value: (progress.biol1?.completed?.length || 0), label: 'Bio 1 Days Done' },
    { value: (progress.biol2?.completed?.length || 0), label: 'Bio 2 Days Done' },
    { value: (badges.biol1?.length || 0) + (badges.biol2?.length || 0), label: 'Total Badges' },
    { value: standing.avg !== null ? `${standing.avg.toFixed(0)}%` : '—', label: 'ST Average' }
  ];

  APP.$('#quick-stats').innerHTML = stats.map((s) => `
    <div class="stat-card">
      <div class="stat-value">${s.value}</div>
      <div class="stat-label">${s.label}</div>
    </div>
  `).join('');

  /* ---------- Subjects ---------- */
  const subjects = [
    {
      id: 'biol1',
      title: 'General Biology 1',
      desc: 'Cell · Cell Cycle · Transport · Biomolecules · Energy',
      icon: '🔬',
      totalWeeks: 10
    },
    {
      id: 'biol2',
      title: 'General Biology 2',
      desc: 'Organismal Biology · Genetics · Evolution · Systematics',
      icon: '🌱',
      totalWeeks: 10
    }
  ];

  APP.$('#subjects-grid').innerHTML = subjects.map((s) => {
    const done = progress[s.id]?.completed?.length || 0;
    const totalDays = s.totalWeeks * 4;
    const pct = Math.round((done / totalDays) * 100);

    return `
      <div class="subject-card" data-subject="${s.id}">
        <div style="font-size:2rem;">${s.icon}</div>
        <h3>${s.title}</h3>
        <p class="text-muted text-small">${s.desc}</p>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;"></div></div>
        <p class="text-small text-muted">${done}/${totalDays} days · ${pct}% complete</p>
      </div>
    `;
  }).join('');

  document.querySelectorAll('[data-subject]').forEach((card) => {
    card.addEventListener('click', () => {
      const subj = card.dataset.subject;
      window.location.href = `${subj}/index.html`;
    });
  });

  /* ---------- Badges ---------- */
  const allBadges = [
    { id: 'historian',        icon: '🏆', name: 'Historian' },
    { id: 'speed-scholar',    icon: '⚡', name: 'Speed Scholar' },
    { id: 'perfect-run',      icon: '🎯', name: 'Perfect Run' },
    { id: 'postulate-master', icon: '🧠', name: 'Postulate Master' },
    { id: 'quick-thinker',    icon: '⚡', name: 'Quick Thinker' },
    { id: 'flawless',         icon: '💎', name: 'Flawless' },
    { id: 'system-master',    icon: '🏆', name: 'System Master' },
    { id: 'classifier-pro',   icon: '🧠', name: 'Classifier Pro' }
  ];

  const earnedSet = new Set([...(badges.biol1 || []), ...(badges.biol2 || [])]);

  APP.$('#badge-total').textContent = `🏆 ${earnedSet.size} badges earned`;
  APP.$('#badge-week').textContent = `This week: ${earnedSet.size}`;

  APP.$('#badge-gallery').innerHTML = allBadges.map((b) => {
    const earned = earnedSet.has(b.id);
    return `
      <div class="badge-item ${earned ? '' : 'locked'}">
        <div class="badge-icon">${b.icon}</div>
        <div class="badge-name">${b.name}</div>
      </div>
    `;
  }).join('');

  /* ---------- Sync: Generate Code ---------- */
  APP.$('#btn-sync-code').addEventListener('click', async () => {
    try {
      const result = await Sync.generateSyncCode(user.lrn, null);
      APP.$('#sync-output').innerHTML = `
        <div class="alert alert-success">
          <strong>✅ Sync Code Generated!</strong>
          <div style="font-family:monospace;font-size:1.4rem;margin:12px 0;text-align:center;padding:12px;background:#fff;border-radius:6px;">
            ${result.code}
          </div>
          <p class="text-small">Send this code to your teacher. It's valid for the records saved on this device.</p>
        </div>
      `;
      APP.toast('Sync code generated!', 'success');
    } catch (e) {
      APP.toast('Failed: ' + e.message, 'danger');
    }
  });

  /* ---------- Sync: Export JSON ---------- */
  APP.$('#btn-export-json').addEventListener('click', async () => {
    try {
      const fn = await Sync.exportAsFile(user.lrn, null);
      APP.toast(`Saved: ${fn}`, 'success');
    } catch (e) {
      APP.toast('Export failed: ' + e.message, 'danger');
    }
  });

  /* ---------- Sync: Import JSON ---------- */
  APP.$('#btn-import-json').addEventListener('click', () => {
    APP.$('#import-file').click();
  });

  APP.$('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = await Backup.uploadBackup(file);
      APP.toast(`Backup restored for ${data.user.firstName}!`, 'success');
      setTimeout(() => location.reload(), 900);
    } catch (err) {
      APP.toast('Import failed: ' + err.message, 'danger');
    }
    e.target.value = '';
  });

  /* ---------- Logout ---------- */
  APP.$('#btn-logout').addEventListener('click', async () => {
    const choice = await Backup.promptOnLogout(user);
    if (choice === 'cancel') return;
    Store.clearSession();
    window.location.href = 'login.html';
  });

})();
