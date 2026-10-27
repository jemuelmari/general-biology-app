/* ============================================================
   dashboard.js — Student dashboard logic
   Version: 2.0.3 (White Bold Sync Status)
   ============================================================ */

(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const NS = 'gba_v1_';

  function getCurrentUser() {
    try {
      const sessionRaw = localStorage.getItem(`${NS}session`);
      if (!sessionRaw) return null;
      const session = JSON.parse(sessionRaw);
      const usersRaw = localStorage.getItem(`${NS}users`);
      if (!usersRaw) return null;
      const users = JSON.parse(usersRaw);
      const normalizedLrn = String(session.lrn).replace(/\D/g, '').padStart(12, '0');
      
      const user = users.find(u => {
        const uLrn = String(u.LRN || u.lrn || '').replace(/\D/g, '').padStart(12, '0');
        return uLrn === normalizedLrn;
      });
      
      if (!user) return null;
      
      return {
        lrn: user.LRN || user.lrn,
        firstName: user.FirstName || user.firstName,
        lastName: user.LastName || user.lastName,
        middleName: user.MiddleName || user.middleName || '',
        gradeLevel: user.GradeLevel || user.gradeLevel,
        section: user.Section || user.section,
        sex: user.Sex || user.sex || '',
      };
    } catch (e) { return null; }
  }

  function getProgress(lrn) {
    try {
      const raw = localStorage.getItem(`${NS}progress_${lrn}`);
      if (raw) return JSON.parse(raw);
      const users = JSON.parse(localStorage.getItem(`${NS}users`) || '[]');
      const user = users.find(u => String(u.LRN || u.lrn) === String(lrn));
      if (user && user.ProgressObj) return user.ProgressObj;
      if (user && user.ProgressJSON) return JSON.parse(user.ProgressJSON);
      return { biol1: { completed: [], weeks: {} }, biol2: { completed: [], weeks: {} } };
    } catch (e) {
      return { biol1: { completed: [], weeks: {} }, biol2: { completed: [], weeks: {} } };
    }
  }

  function getScores(lrn) {
    try {
      const raw = localStorage.getItem(`${NS}scores_${lrn}`);
      if (raw) return JSON.parse(raw);
      const users = JSON.parse(localStorage.getItem(`${NS}users`) || '[]');
      const user = users.find(u => String(u.LRN || u.lrn) === String(lrn));
      if (user && user.ScoresObj) return user.ScoresObj;
      if (user && user.ScoresJSON) return JSON.parse(user.ScoresJSON);
      return { biol1: { quizzes: {}, st: {}, pt: {}, te: null }, biol2: { quizzes: {}, st: {}, pt: {}, te: null } };
    } catch (e) {
      return { biol1: { quizzes: {}, st: {}, pt: {}, te: null }, biol2: { quizzes: {}, st: {}, pt: {}, te: null } };
    }
  }

  function getBadges(lrn) {
    try {
      const raw = localStorage.getItem(`${NS}badges_${lrn}`);
      if (raw) return JSON.parse(raw);
      const users = JSON.parse(localStorage.getItem(`${NS}users`) || '[]');
      const user = users.find(u => String(u.LRN || u.lrn) === String(lrn));
      if (user && user.BadgesObj) return user.BadgesObj;
      if (user && user.BadgesJSON) return JSON.parse(user.BadgesJSON);
      return { biol1: [], biol2: [] };
    } catch (e) {
      return { biol1: [], biol2: [] };
    }
  }

  const user = getCurrentUser();
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  function formatLRN(lrn) {
    return String(lrn).replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  }

  const firstName = user.firstName || 'Student';
  const lastName = user.lastName || '';
  const section = user.section || '';
  const gradeLevel = user.gradeLevel || '';
  const lrn = user.lrn;

  const userPill = $('#user-pill');
  if (userPill) userPill.textContent = `${firstName} ${lastName.charAt(0)}. · ${section}`;

  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  const dashAvatar = $('#dash-avatar');
  if (dashAvatar) dashAvatar.textContent = initials || '?';

  const greetingName = $('#greeting-name');
  if (greetingName) greetingName.textContent = `Hello, ${firstName}! 👋`;

  const greetingMeta = $('#greeting-meta');
  if (greetingMeta) {
    greetingMeta.innerHTML = `
      <span>🎓 LRN: ${formatLRN(lrn)}</span>
      <span>📘 Grade ${gradeLevel} — ${section}</span>
    `;
  }

  const progress = getProgress(lrn);
  const scores = getScores(lrn);
  const badges = getBadges(lrn);

  function computeStanding() {
    const allSTs = [];
    ['biol1', 'biol2'].forEach((subj) => {
      const st = scores[subj]?.st || {};
      Object.values(st).forEach((s) => {
        if (s && s.total) allSTs.push((s.score / s.total) * 100);
      });
    });
    if (!allSTs.length) return { label: 'No data yet', key: 'on-track', avg: null };
    const avg = allSTs.reduce((a, b) => a + b, 0) / allSTs.length;
    let label = 'On Track', key = 'on-track';
    if (avg >= 90) { label = 'Enrichment'; key = 'enrichment'; }
    else if (avg >= 80) { label = 'On Track'; key = 'on-track'; }
    else if (avg >= 75) { label = 'Remediation'; key = 'remediation'; }
    else { label = 'Urgent'; key = 'urgent'; }
    return { label, key, avg };
  }

  const standing = computeStanding();

  const standingBadge = $('#standing-badge');
  if (standingBadge) {
    standingBadge.innerHTML = `
      <div class="dash-hero-badge ${standing.key}">
        <span class="dot"></span>
        <span>${standing.label}${standing.avg !== null ? ` · ${standing.avg.toFixed(1)}%` : ''}</span>
      </div>
    `;
  }

  const stats = [
    { value: (progress.biol1?.completed?.length || 0), label: 'Bio 1 Days Done', icon: '🔬', color: 'green' },
    { value: (progress.biol2?.completed?.length || 0), label: 'Bio 2 Days Done', icon: '🌱', color: 'blue' },
    { value: (badges.biol1?.length || 0) + (badges.biol2?.length || 0), label: 'Total Badges', icon: '🏆', color: 'amber' },
    { value: standing.avg !== null ? `${standing.avg.toFixed(0)}%` : '—', label: 'ST Average', icon: '📊', color: 'purple' }
  ];

  const quickStats = $('#quick-stats');
  if (quickStats) {
    quickStats.innerHTML = stats.map((s) => `
      <div class="qs-card ${s.color}">
        <div class="qs-icon">${s.icon}</div>
        <div class="qs-info">
          <div class="qs-value">${s.value}</div>
          <div class="qs-label">${s.label}</div>
        </div>
      </div>
    `).join('');
  }

  const subjects = [
    { id: 'biol1', title: 'General Biology 1', desc: 'Cell · Cell Cycle · Transport · Biomolecules · Energy', icon: '🔬', totalWeeks: 10 },
    { id: 'biol2', title: 'General Biology 2', desc: 'Organismal Biology · Genetics · Evolution · Systematics', icon: '🌱', totalWeeks: 10 }
  ];

  const subjectsGrid = $('#subjects-grid');
  if (subjectsGrid) {
    subjectsGrid.innerHTML = subjects.map((s) => {
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
  }

  document.querySelectorAll('[data-subject]').forEach((card) => {
    card.addEventListener('click', () => {
      window.location.href = `${card.dataset.subject}/index.html`;
    });
  });

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

  const badgeTotal = $('#badge-total');
  if (badgeTotal) badgeTotal.textContent = `🏆 ${earnedSet.size} badges earned`;
  const badgeWeek = $('#badge-week');
  if (badgeWeek) badgeWeek.textContent = `This week: ${earnedSet.size}`;

  const badgeGallery = $('#badge-gallery');
  if (badgeGallery) {
    badgeGallery.innerHTML = allBadges.map((b) => {
      const earned = earnedSet.has(b.id);
      return `
        <div class="badge-item ${earned ? '' : 'locked'}">
          <div class="badge-icon">${b.icon}</div>
          <div class="badge-name">${b.name}</div>
        </div>
      `;
    }).join('');
  }

  /* ============================================================
     Sync Status System — White Bold Text
     ============================================================ */

  const statusPill = $('#sync-status-pill');
  const statusBanner = $('#sync-status-banner');
  const forceSyncBtn = $('#btn-force-sync');

  function getSyncState() {
    const online = navigator.onLine;
    const queue = { count: 0 };
    const lastPush = localStorage.getItem(`${NS}last_push_at`);
    if (!online) return { key: 'offline', label: 'Offline', color: '#ed6c02', queue };
    if (queue.count > 0) return { key: 'pending', label: queue.count + ' pending', color: '#ed6c02', queue, lastPush };
    if (lastPush) {
      const ago = Math.round((Date.now() - new Date(lastPush).getTime()) / 1000);
      const agoStr = ago < 60 ? ago + 's ago' : ago < 3600 ? Math.floor(ago / 60) + 'm ago' : Math.floor(ago / 86400) + 'd ago';
      return { key: 'synced', label: 'Synced ' + agoStr, color: '#2e7d32', queue, lastPush };
    }
    return { key: 'unknown', label: 'Not yet synced', color: '#78909c', queue };
  }

  function renderSyncStatus() {
    const state = getSyncState();
    if (statusPill) {
      statusPill.style.display = 'inline-flex';
      // ITO ANG BINAGO: Solid background, white bold text
      statusPill.style.background = state.color;
      statusPill.style.color = '#ffffff';
      statusPill.style.fontWeight = 'bold';
      statusPill.style.border = '1px solid ' + state.color;
      statusPill.textContent =
        state.key === 'synced' ? '🟢 ' + state.label :
        state.key === 'pending' ? '🟡 ' + state.label :
        state.key === 'offline' ? '📴 ' + state.label : '🔵 ' + state.label;
    }
  }

  setInterval(renderSyncStatus, 10000);
  window.addEventListener('online', renderSyncStatus);
  window.addEventListener('offline', renderSyncStatus);
  window.addEventListener('sync-queue-changed', renderSyncStatus);
  renderSyncStatus();

  const logoutBtn = $('#btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (!confirm('Are you sure you want to log out?')) return;
      localStorage.removeItem(`${NS}session`);
      window.location.replace('login.html');
    });
  }

})();
