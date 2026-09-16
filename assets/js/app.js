/* ============================================================
   app.js — Router, state, and global initialization
   Version: 1.1.0
   ============================================================ */

const APP = (() => {
  'use strict';

  const VERSION = (typeof CONFIG !== 'undefined' && CONFIG.VERSION) || '1.1.0';
  const APP_NAME = (typeof CONFIG !== 'undefined' && CONFIG.APP_NAME) || 'General Biology Online Modular Application';

  /* ---------- State ---------- */
  const state = {
    currentUser: null,
    currentSubject: null,
    currentWeek: null,
    currentDay: null,
    sessionStart: null
  };

  /* ---------- Router ---------- */
  const Router = {
    routes: {},
    current: null,

    register(path, handler) {
      this.routes[path] = handler;
    },

    navigate(path, params = {}) {
      const [base, query] = path.split('?');
      const handler = this.routes[base];
      if (!handler) {
        console.warn(`[Router] No route for: ${base}`);
        return;
      }
      this.current = base;
      window.history.pushState({ path: base, params }, '', `#${base}`);
      handler(params);
    },

    init() {
      window.addEventListener('popstate', (e) => {
        const path = e.state?.path || window.location.hash.slice(1) || '/';
        const handler = this.routes[path];
        if (handler) handler(e.state?.params || {});
      });

      const initial = window.location.hash.slice(1) || '/';
      const handler = this.routes[initial];
      if (handler) handler({});
    }
  };

  /* ---------- Helpers ---------- */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else {
        node.setAttribute(k, v);
      }
    });
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    });
    return node;
  }

  /* ---------- Toast Notifications ---------- */
  function toast(message, type = 'info', duration = 3000) {
    const container = $('#toast-container') || (() => {
      const c = el('div', { id: 'toast-container', style: 'position:fixed;top:80px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;' });
      document.body.appendChild(c);
      return c;
    })();

    const colors = {
      success: '#2e7d32',
      warning: '#ed6c02',
      danger: '#c62828',
      info: '#0277bd'
    };

    const t = el('div', {
      style: `
        background:${colors[type] || colors.info};
        color:#fff;
        padding:12px 20px;
        border-radius:8px;
        box-shadow:0 4px 16px rgba(0,0,0,0.2);
        font-size:0.9rem;
        font-weight:500;
        animation:slideIn 0.3s ease-out;
        max-width:320px;
      `,
      text: message
    });

    container.appendChild(t);
    setTimeout(() => {
      t.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => t.remove(), 300);
    }, duration);
  }

  /* ---------- Formatters ---------- */
  function formatDate(date) {
    const d = new Date(date);
    return d.toLocaleDateString('en-PH', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatLRN(lrn) {
    return String(lrn).replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  }

  /* ---------- Validation ---------- */
  function validateLRN(lrn) {
    return /^\d{12}$/.test(String(lrn).replace(/\D/g, ''));
  }

  function validateName(name) {
    return typeof name === 'string' && name.trim().length >= 2;
  }

  /* ---------- Developer Footer ---------- */
  function renderDeveloperFooter() {
    if (typeof CONFIG === 'undefined' || !CONFIG.DEVELOPER) return;
    const dev = CONFIG.DEVELOPER;

    document.querySelectorAll('.app-footer, footer').forEach((footer) => {
      // Avoid duplicate injection
      if (footer.querySelector('.dev-credit')) return;

      const credit = document.createElement('div');
      credit.className = 'dev-credit';
      credit.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid var(--color-border);font-size:0.75rem;line-height:1.6;';
      credit.innerHTML = `
        <div style="font-weight:600;color:var(--color-primary-dark);">${dev.name}</div>
        <div>${dev.position}</div>
        <div>${dev.school} · ${dev.district}</div>
        <div>${dev.division} · ${dev.region}</div>
        <div>${dev.department}</div>
      `;
      footer.appendChild(credit);
    });
  }

  /* ---------- Inject Manifest Meta (for installability) ---------- */
  function injectManifest() {
    if (document.querySelector('link[rel="manifest"]')) return;
    const link = document.createElement('link');
    link.rel = 'manifest';
    // Compute relative path to root based on current depth
    const path = window.location.pathname;
    let prefix = '';
    if (path.includes('/student/')) prefix = path.includes('/week') ? '../../' : '../';
    else if (path.includes('/teacher/') || path.includes('/classrecord/')) prefix = '../';

    link.href = prefix + 'manifest.json';
    document.head.appendChild(link);

    // Theme color
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#1b7a3d';
    document.head.appendChild(meta);
  }

  /* ---------- Init ---------- */
  function init() {
    console.log(`[${APP_NAME}] v${VERSION}`);
    const vEls = $$('.version');
    vEls.forEach((e) => (e.textContent = `v${VERSION}`));

    injectManifest();
    renderDeveloperFooter();
    Router.init();
  }

  /* ---------- Public API ---------- */
  return {
    VERSION,
    APP_NAME,
    state,
    Router,
    $, $$, el,
    toast,
    formatDate,
    formatTime,
    formatLRN,
    validateLRN,
    validateName,
    renderDeveloperFooter,
    init
  };
})();

document.addEventListener('DOMContentLoaded', APP.init);
