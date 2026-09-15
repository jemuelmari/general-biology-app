/* ============================================================
   auth.js — Login, register, multi-user session handling
   Version: 1.0.0
   ============================================================ */

(() => {
  'use strict';

  /* ---------- Tab switching ---------- */
  const tabs = APP.$$('.sync-tab');
  const panels = {
    login: APP.$('#tab-login'),
    register: APP.$('#tab-register'),
    saved: APP.$('#tab-saved')
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      Object.values(panels).forEach((p) => p?.classList.add('hidden'));
      const key = tab.dataset.tab;
      panels[key]?.classList.remove('hidden');
      if (key === 'saved') renderSavedUsers();
    });
  });

  /* ---------- LRN input formatting ---------- */
  function attachLRNFormatter(input) {
    input.addEventListener('input', () => {
      let v = input.value.replace(/\D/g, '').slice(0, 12);
      v = v.replace(/(\d{4})(\d{4})(\d{4})/, '$1-$2-$3');
      input.value = v;
    });
  }

  attachLRNFormatter(APP.$('#login-lrn'));
  attachLRNFormatter(APP.$('#reg-lrn'));

  /* ---------- Login ---------- */
  const loginForm = APP.$('#login-form');
  const loginError = APP.$('#login-error');

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');

    const lrn = APP.$('#login-lrn').value.replace(/\D/g, '');

    if (!APP.validateLRN(lrn)) {
      return showError(loginError, 'LRN must be exactly 12 digits.');
    }

    const user = Store.getUser(lrn);
    if (!user) {
      return showError(loginError, 'No saved profile found for this LRN. Please register as a new student.');
    }

    Store.setSession(lrn);
    APP.toast(`Welcome back, ${user.firstName}!`, 'success');
    setTimeout(() => (window.location.href = 'dashboard.html'), 600);
  });

  /* ---------- Register ---------- */
  const registerForm = APP.$('#register-form');
  const registerError = APP.$('#register-error');

  registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    registerError.classList.add('hidden');

    const lastName = APP.$('#reg-lastname').value.trim();
    const firstName = APP.$('#reg-firstname').value.trim();
    const middleName = APP.$('#reg-middlename').value.trim();
    const lrn = APP.$('#reg-lrn').value.replace(/\D/g, '');
    const gradeLevel = APP.$('#reg-grade').value;
    const section = APP.$('#reg-section').value;

    // Validations
    if (!APP.validateName(lastName)) return showError(registerError, 'Please enter a valid last name.');
    if (!APP.validateName(firstName)) return showError(registerError, 'Please enter a valid first name.');
    if (!APP.validateLRN(lrn)) return showError(registerError, 'LRN must be exactly 12 digits.');
    if (!gradeLevel) return showError(registerError, 'Please select a grade level.');
    if (!section) return showError(registerError, 'Please select a section.');

    // Duplicate LRN check
    if (Store.getUser(lrn)) {
      return showError(registerError, 'A profile with this LRN already exists. Please log in instead.');
    }

    const user = {
      lrn,
      lastName,
      firstName,
      middleName,
      gradeLevel,
      section,
      createdAt: new Date().toISOString()
    };

    Store.saveUser(user);
    Store.setSession(lrn);
    APP.toast(`Profile created! Welcome, ${firstName}.`, 'success');
    setTimeout(() => (window.location.href = 'dashboard.html'), 700);
  });

  /* ---------- Saved Users ---------- */
  function renderSavedUsers() {
    const list = APP.$('#saved-users-list');
    const users = Store.getAllUsers();

    if (!users.length) {
      list.innerHTML = `<div class="alert alert-info">No saved users on this device yet.</div>`;
      return;
    }

    list.innerHTML = '';
    users.forEach((u) => {
      const card = APP.el('div', { class: 'intervention-card on-track' });
      card.innerHTML = `
        <div class="student-name">${u.lastName}, ${u.firstName} ${u.middleName || ''}</div>
        <div class="student-meta">LRN: ${APP.formatLRN(u.lrn)} · Grade ${u.gradeLevel} — ${u.section}</div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn btn-primary" data-login="${u.lrn}" style="flex:1;font-size:0.85rem;padding:6px 12px;">Log In</button>
          <button class="btn btn-danger" data-delete="${u.lrn}" style="flex:1;font-size:0.85rem;padding:6px 12px;">Delete</button>
        </div>
      `;
      list.appendChild(card);
    });

    list.querySelectorAll('[data-login]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lrn = btn.dataset.login;
        Store.setSession(lrn);
        APP.toast('Logged in!', 'success');
        setTimeout(() => (window.location.href = 'dashboard.html'), 500);
      });
    });

    list.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lrn = btn.dataset.delete;
        if (!confirm('Delete this profile and all its progress on this device?')) return;
        Store.deleteUser(lrn);
        APP.toast('Profile deleted.', 'info');
        renderSavedUsers();
      });
    });
  }

  /* ---------- Helpers ---------- */
  function showError(el, msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
    APP.toast(msg, 'danger', 3000);
  }

  /* ---------- Init ---------- */
  APP.$('#login-lrn').focus();
})();