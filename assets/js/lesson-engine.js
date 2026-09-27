/* ============================================================
   lesson-engine.js — Shared gamified activity + formative check
   Version: 2.3.3
   ------------------------------------------------------------
   v2.3.3:
   - Push progress to backend after formative passes
   ============================================================ */

const Lesson = (() => {
  'use strict';

  let ctx = null;
  let pendingActivities = {};
  let currentAttempts = {};
  let readyFlag = false;
  let timeoutHandle = null;
  let gateReady = false;

  const PASS_THRESHOLD = 0.75;

  function init(config) {
    const user = Store.getCurrentUser();
    if (!user) {
      window.location.href = '../../../student/login.html';
      return;
    }

    ctx = {
      lrn: user.lrn,
      subject: config.subject,
      week: config.week,
      day: config.day,
      points: 0,
      maxPoints: config.maxPoints || 300,
      badges: [],
      startTime: Date.now()
    };

    renderScoreBar(config.title);
    startLiveTimer();
    showLoadingOverlay();

    timeoutHandle = setTimeout(() => {
      if (!readyFlag) showTimeoutError();
    }, 15000);

    document.addEventListener('activity:start', (e) => {
      startActivity(e.detail.activity);
    });

    document.addEventListener('activity-gate:ready', () => {
      gateReady = true;
      setTimeout(() => {
        hideLoadingOverlay();
        readyFlag = true;
        clearTimeout(timeoutHandle);
      }, 100);
    });

    tryInitGate(config);
  }

  function tryInitGate(config) {
    if (window.ActivityGate && !window.ActivityGate.isInitialized()) {
      window.ActivityGate.init(config);
      return;
    }

    if (window.ActivityGate && window.ActivityGate.isInitialized()) {
      setTimeout(() => {
        hideLoadingOverlay();
        readyFlag = true;
        clearTimeout(timeoutHandle);
      }, 100);
      return;
    }

    let attempts = 0;
    const maxAttempts = 100;
    const interval = setInterval(() => {
      attempts++;
      if (window.ActivityGate && !window.ActivityGate.isInitialized()) {
        clearInterval(interval);
        window.ActivityGate.init(config);
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        fallbackRenderAll();
      }
    }, 200);
  }

  function fallbackRenderAll() {
    hideLoadingOverlay();
    readyFlag = true;
    clearTimeout(timeoutHandle);
    APP.toast('⚠️ Loaded in fallback mode — reload to enable activity locking', 'warning', 5000);
  }

  function showLoadingOverlay() {
    if (document.getElementById('lesson-loading-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'lesson-loading-overlay';
    overlay.style.cssText = `position:fixed;inset:0;z-index:9998;background:rgba(255,255,255,0.92);display:flex;align-items:center;justify-content:center;transition:opacity 0.3s ease;`;
    overlay.innerHTML = `
      <div style="text-align:center;max-width:320px;padding:24px;">
        <div style="font-size:2.5rem;">⏳</div>
        <div style="font-size:1.1rem;font-weight:600;color:#1b7a3d;margin-top:12px;">Loading activities...</div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  function hideLoadingOverlay() {
    const overlay = document.getElementById('lesson-loading-overlay');
    if (!overlay) return;
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 300);
  }

  function showTimeoutError() {
    const overlay = document.getElementById('lesson-loading-overlay');
    if (!overlay) return;
    overlay.innerHTML = `<div style="text-align:center;max-width:380px;padding:24px;"><div style="font-size:2.5rem;">📡</div><div style="font-size:1.1rem;font-weight:600;color:#c62828;margin-top:12px;">Slow connection detected</div><button id="lesson-retry-btn" style="padding:10px 20px;background:#1b7a3d;color:#fff;border:none;border-radius:8px;font-size:0.9rem;font-weight:600;cursor:pointer;margin-top:16px;">🔄 Retry</button></div>`;
    document.getElementById('lesson-retry-btn').addEventListener('click', () => location.reload());
  }

  function calculateTimeLimit(type, count) {
    const MIN_SECONDS = 300;
    if (type === 'match') return Math.max(MIN_SECONDS, count * 20);
    if (type === 'scenario') return Math.max(MIN_SECONDS, count * 25);
    if (type === 'escape') return Math.max(MIN_SECONDS, count * 60);
    return MIN_SECONDS;
  }

  function registerMatchGame(containerId, config) {
    const timeLimit = calculateTimeLimit('match', config.pairs.length);
    pendingActivities[containerId] = { type: 'match', config: { ...config, timeLimit } };
  }

  function registerScenarioGame(containerId, config) {
    const timeLimit = calculateTimeLimit('scenario', config.scenarios.length);
    pendingActivities[containerId] = { type: 'scenario', config: { ...config, timeLimit } };
  }

  function registerEscapeRoom(containerId, config) {
    const timeLimit = calculateTimeLimit('escape', config.questions.length);
    pendingActivities[containerId] = { type: 'escape', config: { ...config, timeLimit } };
  }

  function startActivity(stateKey) {
    const containerId = stateKey === 'activity1' ? 'activity-1'
                      : stateKey === 'activity2' ? 'activity-2'
                      : 'formative';
    const pending = pendingActivities[containerId];
    if (!pending) return;
    currentAttempts[containerId] = (currentAttempts[containerId] || 0) + 1;
    // ... (rendering functions same as before)
  }

  function renderScoreBar(title) {
    const bar = document.getElementById('daily-score-bar');
    if (!bar) return;
    bar.innerHTML = `
      <div class="score-bar-left">
        <span class="score-bar-label">Week ${ctx.week} · Day ${ctx.day}</span>
        <span class="score-bar-title">${title}</span>
      </div>
      <div class="score-bar-right">
        <div class="score-bar-stat"><span class="value" id="sb-points">0</span><span class="label">Points</span></div>
        <div class="score-bar-stat"><span class="value" id="sb-badges">0</span><span class="label">Badges</span></div>
        <div class="score-bar-stat"><span class="value" id="sb-timer">00:00</span><span class="label">Time</span></div>
      </div>
    `;
  }

  function startLiveTimer() {
    const el = document.getElementById('sb-timer');
    if (!el) return;
    setInterval(() => {
      const s = Math.floor((Date.now() - ctx.startTime) / 1000);
      el.textContent = APP.formatTime(s);
    }, 1000);
  }

  function addPoints(n) {
    ctx.points += n;
    const el = document.getElementById('sb-points');
    if (el) el.textContent = ctx.points;
    Store.addDailyPoints(ctx.lrn, ctx.subject, ctx.week, ctx.day, n);
  }

  function awardBadge(badgeId, badgeName, icon) {
    if (ctx.badges.includes(badgeId)) return;
    const newBadge = Store.awardBadge(ctx.lrn, ctx.subject, badgeId);
    if (!newBadge) return;
    ctx.badges.push(badgeId);
    const el = document.getElementById('sb-badges');
    if (el) el.textContent = ctx.badges.length;
    APP.toast(`🏆 Badge earned: ${icon} ${badgeName}`, 'success', 4000);
  }

  /**
   * Called when formative completes — pushes progress to backend.
   */
  function pushProgressAfterDayComplete() {
    if (!ctx) return;
    if (window.Sync && typeof Sync.pushProgressToBackend === 'function') {
      Sync.pushProgressToBackend(ctx.lrn, ctx.subject)
        .then((res) => {
          if (res && res.ok) {
            console.log('[AutoPush] ✅ Progress synced for', ctx.subject, `w${ctx.week}d${ctx.day}`);
          }
        })
        .catch((err) => console.warn('[AutoPush] Progress sync failed:', err));
    }
  }

  // ... (all renderers: renderMatchGameNow, renderScenarioGameNow, renderEscapeRoomNow)

  return {
    init,
    pushProgressAfterDayComplete,
    renderMatchGame: registerMatchGame,
    renderScenarioGame: registerScenarioGame,
    renderEscapeRoom: registerEscapeRoom
  };
})();

window.Lesson = Lesson;
