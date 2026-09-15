/* ============================================================
   app.js — Router, state, and global initialization
   Version: 1.0.0
   ============================================================ */

const APP = (() => {
  'use strict';

  const VERSION = '1.0.0';
  const APP_NAME = 'General Biology Online Modular Application';

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

  /* ---------- Init ---------- */
  function init() {
    console.log(`[${APP_NAME}] v${VERSION}`);
    const vEls = $$('.version');
    vEls.forEach((e) => (e.textContent = `v${VERSION}`));
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
    init
  };
})();

document.addEventListener('DOMContentLoaded', APP.init);
