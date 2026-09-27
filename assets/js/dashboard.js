/* ============================================================
   dashboard.js — Student dashboard logic
   Version: 1.5.1
   ------------------------------------------------------------
   v1.5.1:
   - Fixed statePill scope bug (was declared after usage)
   - All DOM refs resolved at top of sync-status block
   ============================================================ */

(() => {
  'use strict';

  /* ---------- Auth guard ---------- */
  const user = Store.getCurrentUser();
  if (!user) {
    window.location.replace('login.html');
    return;
  }

  /* ---------- User pill ---------- */
  APP.$('#user-pill').textContent =
    `${user.firstName} ${user.lastName.charAt(0)}. · ${user.section}`;

  /* ---------- Hero greeting ---------- */
  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
  APP.$('#dash-avatar').textContent = initials;
  APP.$('#greeting-name').textContent = `Hello, ${user.firstName}! 👋`;
  APP.$('#greeting-meta').innerHTML = `
    <span>🎓 LRN: ${APP.formatLRN(user.lrn)}</span>
    <span>📘 Grade ${user.gradeLevel} — ${user.section}</span>
  `;

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
    <div class="dash-hero-badge ${standing.key}">
      <span class="dot"></span>
      <span>${standing.label}${standing.avg !== null ? ` · ${standing.avg.toFixed(1)}%` : ''}</span>
    </div>
  `;

  /* ---------- Quick stats ---------- */
  const progress = Store.getProgress(user.lrn);
  const badges = Store.getBadges(user.lrn);

  const stats = [
    { value: (progress.biol1?.completed?.length || 0), label: 'Bio 1 Days Done', icon: '🔬', color: 'green' },
    { value: (progress.biol2?.completed?.length || 0), label: 'Bio 2 Days Done', icon: '🌱', color: 'blue' },
    { value: (badges.biol1?.length || 0) + (badges.biol2?.length || 0), label: 'Total Badges', icon: '🏆', color: 'amber' },
    { value: standing.avg !== null ? `${standing.avg.toFixed(0)}%` : '—', label: 'ST Average', icon: '📊', color: 'purple' }
  ];

  APP.$('#quick-stats').innerHTML = stats.map((s) => `
    <div class="qs-card ${s.color}">
      <div class="qs-icon">${s.icon}</div>
      <div class="qs-info">
        <div class="qs-value">${s.value}</div>
        <div class="qs-label">${s.label}</div>
      </div>
    </div>
  `).join('');

  /* ---------- Subjects ---------- */
  const subjects = [
    { id: 'biol1', title: 'General Biology 1', desc: 'Cell · Cell Cycle · Transport · Biomolecules · Energy', icon: '🔬', totalWeeks: 10 },
    { id: 'biol2', title: 'General Biology 2', desc: 'Organismal Biology · Genetics · Evolution · Systematics', icon: '🌱', totalWeeks: 10 }
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
      window.location.href = `${card.dataset.subject}/index.html`;
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

  /* ============================================================
     Sync Status System
     ============================================================ */

  // Resolve ALL DOM refs first, before any usage
  const statusPill = document.getElementById('sync-status-pill');
  const statusBanner = document.getElementById('sync-status-banner');
  const queueDetails = document.getElementById('queue-details');
  const forceSyncBtn = document.getElementById('btn-force-sync');

  function getSyncState() {
    const backendOn = typeof Sync !== 'undefined' && Sync.backendEnabled && Sync.backendEnabled();
    const online = navigator.onLine;
    const queue = (typeof Sync !== 'undefined' && Sync.getQueueStatus && Sync.getQueueStatus()) || { count: 0, items: [] };
    const lastPush = localStorage.getItem('gba_last_push_at');

    if (!backendOn) {
      return { key: 'disabled', label: 'Sync disabled', color: '#90a4ae', queue };
    }
    if (!online) {
      return { key: 'offline', label: 'Offline', color: '#ed6c02', queue };
    }
    if (queue.count > 0) {
      return { key: 'pending', label: queue.count + ' pending', color: '#ed6c02', queue, lastPush };
    }
    if (lastPush) {
      const ago = Math.round((Date.now() - new Date(lastPush).getTime()) / 1000);
      const agoStr = ago < 60 ? ago + 's ago'
                    : ago < 3600 ? Math.floor(ago / 60) + 'm ago'
                    : ago < 86400 ? Math.floor(ago / 3600) + 'h ago'
                    : Math.floor(ago / 86400) + 'd ago';
      return { key: 'synced', label: 'Synced ' + agoStr, color: '#2e7d32', queue, lastPush };
    }
    return { key: 'unknown', label: 'Not yet synced', color: '#78909c', queue };
  }

  function renderSyncStatus() {
    const state = getSyncState();

    // --- Pill (header) ---
    if (statusPill) {
      statusPill.style.display = 'inline-flex';
      statusPill.style.background = state.color + '22';
      statusPill.style.color = state.color;
      statusPill.style.border = '1px solid ' + state.color;
      statusPill.textContent =
        state.key === 'synced' ? '🟢 ' + state.label
        : state.key === 'pending' ? '🟡 ' + state.label
        : state.key === 'offline' ? '📴 ' + state.label
        : state.key === 'disabled' ? '⚪ ' + state.label
        : '🔵 ' + state.label;
    }

    // --- Banner ---
    if (statusBanner) {
      if (state.key === 'synced' || state.key === 'disabled') {
        statusBanner.style.display = 'none';
      } else {
        statusBanner.style.display = 'block';
        const bannerConfig = {
          pending: {
            bg: '#fff3e0', border: '#ed6c02', icon: '⏳',
            title: state.queue.count + ' item(s) waiting to sync',
            body: 'Your scores are saved locally. The app will push them to your teacher automatically when the connection is stable.',
            btn: '🔄 Retry Now'
          },
          offline: {
            bg: '#fff3e0', border: '#ed6c02', icon: '📴',
            title: 'You are offline',
            body: 'Your progress is saved on this device. It will sync automatically when you go back online.',
            btn: null
          },
          unknown: {
            bg: '#e1f5fe', border: '#0277bd', icon: 'ℹ️',
            title: 'Not yet synced',
            body: 'Complete a lesson or take a quiz — your progress will sync to your teacher automatically.',
            btn: null
          }
        }[state.key];

        if (bannerConfig) {
          statusBanner.innerHTML = `
            <div style="background:${bannerConfig.bg};border-left:4px solid ${bannerConfig.border};border-radius:10px;padding:14px 18px;">
              <div style="display:flex;gap:12px;align-items:flex-start;">
                <span style="font-size:1.5rem;">${bannerConfig.icon}</span>
                <div style="flex:1;">
                  <div style="font-weight:700;color:#1a1a1a;margin-bottom:4px;">${bannerConfig.title}</div>
                  <div style="font-size:0.85rem;color:#37474f;">${bannerConfig.body}</div>
                  ${bannerConfig.btn ? '<button id="banner-retry-btn" class="btn btn-primary" style="margin-top:10px;font-size:0.8rem;padding:6px 14px;">' + bannerConfig.btn + '</button>' : ''}
                </div>
              </div>
            </div>
          `;
          const rb = document.getElementById('banner-retry-btn');
          if (rb) rb.addEventListener('click', doForceSync);
        }
      }
    }

    // --- Queue details ---
    if (queueDetails) {
      if (state.queue.count === 0) {
        queueDetails.innerHTML = '';
      } else {
        queueDetails.innerHTML = `
          <div style="background:#f8f9fa;border-radius:10px;padding:14px 18px;font-size:0.85rem;">
            <div style="font-weight:700;color:#5f6368;margin-bottom:8px;">
              ⏳ Pending sync queue (${state.queue.count})
            </div>
            <ul style="margin:0;padding-left:18px;color:#37474f;">
              ${state.queue.items.slice(0, 5).map((item) => `
                <li style="margin-bottom:4px;">
                  <span style="font-family:Consolas,monospace;font-size:0.75rem;color:#78909c;">
                    ${item.action}
                  </span>
                  ${item.assessmentId ? ' · ' + item.assessmentId : ''}
                  ${item.subject ? ' · ' + item.subject.toUpperCase() : ''}
                </li>
              `).join('')}
              ${state.queue.count > 5 ? '<li style="color:#90a4ae;">…and ' + (state.queue.count - 5) + ' more</li>' : ''}
            </ul>
          </div>
        `;
      }
    }
  }

  async function doForceSync() {
    if (typeof Sync === 'undefined' || !Sync.backendEnabled || !Sync.backendEnabled()) {
      return APP.toast('Backend not configured.', 'warning');
    }
    if (!navigator.onLine) {
      return APP.toast('Still offline — try again later.', 'warning');
    }

    if (forceSyncBtn) {
      forceSyncBtn.disabled = true;
      forceSyncBtn.textContent = '⏳ Syncing...';
    }

    try {
      const result = await Sync.flushQueue();
      if (result.flushed > 0) {
        localStorage.setItem('gba_last_push_at', new Date().toISOString());
        APP.toast('✅ Synced ' + result.flushed + ' item(s)', 'success');
      } else if (result.remaining > 0) {
        APP.toast(result.remaining + ' item(s) still pending', 'warning');
      } else {
        APP.toast('Nothing to sync — you are up to date.', 'info');
      }
      renderSyncStatus();
    } catch (err) {
      APP.toast('Sync failed: ' + err.message, 'danger');
    } finally {
      if (forceSyncBtn) {
        forceSyncBtn.disabled = false;
        forceSyncBtn.textContent = '🔄 Force Sync Now';
      }
    }
  }

  if (forceSyncBtn) {
    forceSyncBtn.addEventListener('click', doForceSync);
  }

  setInterval(renderSyncStatus, 10000);
  window.addEventListener('online', () => { renderSyncStatus(); setTimeout(doForceSync, 500); });
  window.addEventListener('offline', renderSyncStatus);
  window.addEventListener('sync-queue-changed', renderSyncStatus);

  renderSyncStatus();

  /* ============================================================
     Sync Code / JSON / Import
     ============================================================ */
  const syncBtnCode = APP.$('#btn-sync-code');

  if (syncBtnCode) {
    const backendOn = typeof Sync !== 'undefined' && Sync.backendEnabled && Sync.backendEnabled();
    syncBtnCode.textContent = backendOn
      ? '🔑 Generate Sync Code (works anywhere)'
      : '🔑 Generate Sync Code (this device only)';

    syncBtnCode.addEventListener('click', async () => {
      syncBtnCode.disabled = true;
      syncBtnCode.textContent = '⏳ Generating...';
      try {
        const result = await Sync.generateSyncCode(user.lrn, null);
        const modeLabel = result.mode === 'backend'
          ? '<span style="color:var(--color-success);">✅ Works across devices</span>'
          : '<span style="color:var(--color-warning);">⚠️ Only works on THIS device</span>';
        APP.$('#sync-output').innerHTML =
          '<div class="alert alert-success"><strong>✅ Sync Code Generated!</strong>' +
          '<div style="font-family:monospace;font-size:1.4rem;margin:12px 0;text-align:center;padding:12px;background:#fff;border-radius:6px;letter-spacing:1px;">' +
          result.code + '</div>' +
          '<p class="text-small">Mode: ' + modeLabel + '</p></div>';
        APP.toast('Sync code generated!', 'success');
      } catch (e) {
        APP.toast('Failed: ' + e.message, 'danger');
      } finally {
        syncBtnCode.disabled = false;
        syncBtnCode.textContent = Sync.backendEnabled()
          ? '🔑 Generate Sync Code (works anywhere)'
          : '🔑 Generate Sync Code (this device only)';
      }
    });
  }

  APP.$('#btn-export-json').addEventListener('click', async () => {
    try {
      const fn = await Sync.exportAsFile(user.lrn, null);
      APP.toast('Saved: ' + fn, 'success');
    } catch (e) {
      APP.toast('Export failed: ' + e.message, 'danger');
    }
  });

  APP.$('#btn-import-json').addEventListener('click', () => {
    APP.$('#import-file').click();
  });

  APP.$('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = await Backup.uploadBackup(file);
      APP.toast('Backup restored for ' + data.user.firstName + '!', 'success');
      setTimeout(() => location.reload(), 900);
    } catch (err) {
      APP.toast('Import failed: ' + err.message, 'danger');
    }
    e.target.value = '';
  });

  /* ---------- Log Out ---------- */
  APP.$('#btn-logout').addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,0.95);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:Segoe UI,sans-serif;';
    overlay.innerHTML = '<div style="text-align:center;"><div style="font-size:2rem;">👋</div><div style="font-weight:600;color:#1b7a3d;margin-top:8px;">Logging out...</div></div>';
    document.body.appendChild(overlay);

    sessionStorage.setItem('gba_logout_pending', JSON.stringify({ lrn: user.lrn, at: Date.now() }));
    Store.clearSession();
    setTimeout(() => { window.location.replace('login.html'); }, 150);
  });

})();
