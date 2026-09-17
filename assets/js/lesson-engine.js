/* ============================================================
   lesson-engine.js — Shared gamified activity + formative check
   Version: 1.0.0
   ============================================================ */

const Lesson = (() => {
  'use strict';

  let ctx = null; // { lrn, subject, week, day, points, badges, startTime }

  /* ---------- Init ---------- */
  function init(config) {
    const user = Store.getCurrentUser();
    if (!user) {
      window.location.href = '../../../student/login.html';
      return;
    }

    ctx = {
      lrn: user.lrn,
      subject: config.subject,       // 'biol1' | 'biol2'
      week: config.week,             // number
      day: config.day,               // number
      points: 0,
      maxPoints: config.maxPoints || 300,
      badges: [],
      startTime: Date.now()
    };

    renderScoreBar(config.title);
    startLiveTimer();

    // Register this lesson with the activity gate (if loaded)
    if (window.ActivityGate) ActivityGate.init(config);
  }

  /* ---------- Daily Score Bar ---------- */
  function renderScoreBar(title) {
    const bar = document.getElementById('daily-score-bar');
    if (!bar) return;
    bar.innerHTML = `
      <div class="score-bar-left">
        <span class="score-bar-label">Week ${ctx.week} · Day ${ctx.day}</span>
        <span class="score-bar-title">${title}</span>
      </div>
      <div class="score-bar-right">
        <div class="score-bar-stat">
          <span class="value" id="sb-points">0</span>
          <span class="label">Points</span>
        </div>
        <div class="score-bar-stat">
          <span class="value" id="sb-max">/${ctx.maxPoints}</span>
          <span class="label">Max</span>
        </div>
        <div class="score-bar-stat">
          <span class="value" id="sb-badges">0</span>
          <span class="label">Badges</span>
        </div>
        <div class="score-bar-stat">
          <span class="value" id="sb-timer">00:00</span>
          <span class="label">Time</span>
        </div>
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
    if (el) {
      el.textContent = ctx.points;
      el.style.transform = 'scale(1.3)';
      setTimeout(() => (el.style.transform = 'scale(1)'), 200);
    }
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

  /* ---------- Match Game ---------- */
  function renderMatchGame(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const { pairs, timeLimit = 120, pointsCorrect = 10, pointsWrong = -3, bonusFast = 15, badgeId, badgeName, badgeIcon } = config;

    let leftItems = [...pairs].sort(() => Math.random() - 0.5);
    let rightItems = [...pairs].sort(() => Math.random() - 0.5);
    let selectedLeft = null;
    let matches = 0;
    let wrongCount = 0;
    let timeLeft = timeLimit;
    let timerInterval = null;

    container.innerHTML = `
      <div class="activity-header">
        <span class="activity-title">🔗 Match the pairs</span>
        <span class="activity-timer" id="match-timer">${APP.formatTime(timeLeft)}</span>
      </div>
      <div class="match-grid">
        <div class="match-column">
          <h4>Left</h4>
          <div id="match-left"></div>
        </div>
        <div class="match-column">
          <h4>Right</h4>
          <div id="match-right"></div>
        </div>
      </div>
      <div class="text-center mt-md">
        <span id="match-score" class="badge badge-info">Matches: 0 / ${pairs.length}</span>
      </div>
    `;

    const leftEl = container.querySelector('#match-left');
    const rightEl = container.querySelector('#match-right');

    leftItems.forEach((item) => {
      const el = APP.el('div', { class: 'match-item', 'data-key': item.key, text: item.left });
      el.addEventListener('click', () => onLeftClick(el));
      leftEl.appendChild(el);
    });

    rightItems.forEach((item) => {
      const el = APP.el('div', { class: 'match-item', 'data-key': item.key, text: item.right });
      el.addEventListener('click', () => onRightClick(el));
      rightEl.appendChild(el);
    });

    function onLeftClick(el) {
      if (el.classList.contains('correct')) return;
      leftEl.querySelectorAll('.match-item').forEach((n) => n.classList.remove('selected'));
      el.classList.add('selected');
      selectedLeft = el;
    }

    function onRightClick(el) {
      if (!selectedLeft || el.classList.contains('correct')) return;

      const leftKey = selectedLeft.dataset.key;
      const rightKey = el.dataset.key;

      if (leftKey === rightKey) {
        selectedLeft.classList.remove('selected');
        selectedLeft.classList.add('correct');
        el.classList.add('correct');
        addPoints(pointsCorrect);
        matches++;
        updateScore();
        if (matches === pairs.length) endGame(true);
      } else {
        el.classList.add('wrong');
        selectedLeft.classList.add('wrong');
        addPoints(pointsWrong);
        wrongCount++;
        const l = selectedLeft;
        setTimeout(() => {
          l.classList.remove('wrong', 'selected');
          el.classList.remove('wrong');
        }, 500);
      }
      selectedLeft = null;
    }

    function updateScore() {
      const el2 = container.querySelector('#match-score');
      if (el2) el2.textContent = `Matches: ${matches} / ${pairs.length}`;
    }

    function endGame(won) {
      clearInterval(timerInterval);
      if (won && wrongCount === 0) {
        addPoints(bonusFast);
        awardBadge(badgeId + '-flawless', 'Flawless', '🎯');
      }
      if (won && (timeLimit - timeLeft) < timeLimit * 0.5) {
        awardBadge(badgeId + '-fast', 'Speed Scholar', '⚡');
      }
      if (won && wrongCount === 0 && (timeLimit - timeLeft) < timeLimit * 0.5) {
        awardBadge(badgeId, badgeName, badgeIcon);
      }
      if (won) {
        APP.toast('🎉 Activity complete!', 'success');
      }
    }

    timerInterval = setInterval(() => {
      timeLeft--;
      const el = container.querySelector('#match-timer');
      if (el) el.textContent = APP.formatTime(timeLeft);
      if (timeLeft <= 0) endGame(false);
    }, 1000);
  }

  /* ---------- Scenario Choice Game ---------- */
  function renderScenarioGame(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const { scenarios, timePerCard = 15, pointsCorrect = 8, bonusFast = 3, badgeId, badgeName, badgeIcon } = config;

    let index = 0;
    let correct = 0;
    let fastAnswers = 0;
    let cardStart = Date.now();
    let cardTimer = null;

    renderCard();

    function renderCard() {
      if (index >= scenarios.length) return endGame();
      const sc = scenarios[index];
      cardStart = Date.now();

      container.innerHTML = `
        <div class="activity-header">
          <span class="activity-title">🎯 ${sc.prompt || 'Choose the best answer'}</span>
          <span class="activity-timer" id="scenario-timer">${APP.formatTime(timePerCard)}</span>
        </div>
        <div class="scenario-card">
          <p class="scenario-text">${sc.text}</p>
          <div class="choice-row" id="choice-row"></div>
        </div>
        <div class="text-center mt-md">
          <span class="badge badge-info">Question ${index + 1} / ${scenarios.length}</span>
        </div>
      `;

      const row = container.querySelector('#choice-row');
      sc.choices.forEach((choice) => {
        const btn = APP.el('button', { class: 'choice-btn', text: choice.label });
        btn.addEventListener('click', () => onChoice(btn, choice, sc));
        row.appendChild(btn);
      });

      startCardTimer();
    }

    function startCardTimer() {
      let t = timePerCard;
      clearInterval(cardTimer);
      cardTimer = setInterval(() => {
        t--;
        const el = container.querySelector('#scenario-timer');
        if (el) el.textContent = APP.formatTime(t);
        if (t <= 0) {
          clearInterval(cardTimer);
          nextCard();
        }
      }, 1000);
    }

    function onChoice(btn, choice, sc) {
      clearInterval(cardTimer);
      const elapsed = (Date.now() - cardStart) / 1000;

      container.querySelectorAll('.choice-btn').forEach((b) => (b.disabled = true));

      if (choice.correct) {
        btn.classList.add('correct');
        addPoints(pointsCorrect);
        correct++;
        if (elapsed <= 5) {
          addPoints(bonusFast);
          fastAnswers++;
        }
      } else {
        btn.classList.add('wrong');
        sc.choices.forEach((c, i) => {
          if (c.correct) {
            container.querySelectorAll('.choice-btn')[i].classList.add('correct');
          }
        });
      }

      setTimeout(nextCard, 1200);
    }

    function nextCard() {
      index++;
      renderCard();
    }

    function endGame() {
      clearInterval(cardTimer);
      if (correct === scenarios.length) {
        awardBadge(badgeId, badgeName, badgeIcon);
      }
      if (fastAnswers >= Math.ceil(scenarios.length * 0.66)) {
        awardBadge(badgeId + '-fast', 'Quick Thinker', '⚡');
      }
      APP.toast(`Activity done! ${correct}/${scenarios.length} correct.`, 'info');
    }
  }

  /* ---------- Escape Room (Formative Check) ---------- */
  function renderEscapeRoom(containerId, config) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const { questions, badgeId, badgeName, badgeIcon, lives = 3 } = config;

    let currentLives = lives;
    let earnedKeys = [];
    let index = 0;
    let locked = false;

    renderIntro();

    function renderIntro() {
      container.innerHTML = `
        <div class="escape-container">
          <div class="escape-header">
            <div>
              <div class="score-bar-label">Formative Check</div>
              <div style="font-size:1.2rem;font-weight:600;">🔐 Escape the Cell</div>
            </div>
            <div class="escape-lives" id="escape-lives">❤️❤️❤️</div>
          </div>
          <div class="escape-result">
            <div class="result-emoji">🗝️</div>
            <div class="result-title">Unlock 3 keys to escape!</div>
            <p class="result-message">Answer all ${questions.length} questions correctly. Wrong answers cost 1 life.</p>
            <button id="escape-start" class="btn btn-accent" style="margin-top:16px;">Start Challenge →</button>
          </div>
        </div>
      `;
      container.querySelector('#escape-start').addEventListener('click', renderQuestion);
    }

    function renderQuestion() {
      if (index >= questions.length) return renderVictory();
      const q = questions[index];

      container.innerHTML = `
        <div class="escape-container">
          <div class="escape-header">
            <div>
              <div class="score-bar-label">Question ${index + 1} / ${questions.length}</div>
              <div style="font-size:1rem;">🔐 Escape the Cell</div>
            </div>
            <div class="escape-lives" id="escape-lives">${'❤️'.repeat(currentLives)}${'🖤'.repeat(lives - currentLives)}</div>
          </div>
          <div class="escape-keys" style="justify-content:center;margin-bottom:12px;">
            ${questions.map((_, i) => `<span class="key-icon ${earnedKeys.includes(i) ? 'earned' : ''}">🗝️</span>`).join('')}
          </div>
          <div class="escape-question">
            <h4>${q.text}</h4>
            <div class="escape-options" id="escape-options"></div>
          </div>
        </div>
      `;

      const opts = container.querySelector('#escape-options');
      q.choices.forEach((c, i) => {
        const btn = APP.el('button', { class: 'escape-option', text: `${String.fromCharCode(65 + i)}. ${c.label}` });
        btn.addEventListener('click', () => onAnswer(btn, c, i));
        opts.appendChild(btn);
      });
    }

    function onAnswer(btn, choice, choiceIdx) {
      if (locked) return;
      locked = true;

      const all = container.querySelectorAll('.escape-option');
      all.forEach((b) => (b.disabled = true));

      if (choice.correct) {
        btn.classList.add('correct');
        earnedKeys.push(index);
        APP.toast('🔑 Key earned!', 'success', 1500);
        setTimeout(() => {
          index++;
          locked = false;
          renderQuestion();
        }, 900);
      } else {
        btn.classList.add('wrong');
        currentLives--;
        // Reveal correct
        const correctIdx = questions[index].choices.findIndex((c) => c.correct);
        all[correctIdx].classList.add('correct');

        if (currentLives <= 0) {
          setTimeout(renderFailure, 1200);
        } else {
          setTimeout(() => {
            locked = false;
            renderQuestion();
          }, 1400);
        }
      }
    }

    function renderVictory() {
      container.innerHTML = `
        <div class="escape-container">
          <div class="escape-result">
            <div class="result-emoji">🎉</div>
            <div class="result-title">You escaped!</div>
            <p class="result-message">All 3 keys collected. Day unlocked.</p>
            <button id="escape-next" class="btn btn-accent" style="margin-top:16px;">Continue to Next Day →</button>
          </div>
        </div>
      `;

      if (currentLives === lives) {
        awardBadge(badgeId, badgeName, badgeIcon);
      }

      markDayComplete();
      container.querySelector('#escape-next').addEventListener('click', () => {
        const next = document.body.dataset.next;
        if (next) window.location.href = next;
        else window.location.href = 'index.html';
      });
    }

    function renderFailure() {
      container.innerHTML = `
        <div class="escape-container">
          <div class="escape-result">
            <div class="result-emoji">💀</div>
            <div class="result-title">Out of lives!</div>
            <p class="result-message">Review the lesson content and try again.</p>
            <button id="escape-retry" class="btn btn-accent" style="margin-top:16px;">Try Again</button>
          </div>
        </div>
      `;
      container.querySelector('#escape-retry').addEventListener('click', () => {
        currentLives = lives;
        earnedKeys = [];
        index = 0;
        locked = false;
        renderIntro();
      });
    }
  }

  /* ---------- Mark Day Complete ---------- */
  function markDayComplete() {
    Store.markDayComplete(ctx.lrn, ctx.subject, ctx.week, ctx.day);
  }

  /* ---------- Public API ---------- */
  return { init, addPoints, awardBadge, renderMatchGame, renderScenarioGame, renderEscapeRoom, markDayComplete };
})();
