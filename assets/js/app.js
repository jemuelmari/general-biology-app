/* ============================================================
   app.js — Router, state, and global initialization
   Version: 2.4.2
   ============================================================ */

const APP = (() => {
  'use strict';

  const VERSION = (typeof CONFIG !== 'undefined' && CONFIG.VERSION) || '2.4.2';
  const APP_NAME = (typeof CONFIG !== 'undefined' && CONFIG.APP_NAME) || 'General Biology Online Modular Application';

  const state = {
    currentUser: null,
    currentSubject: null,
    currentWeek: null,
    currentDay: null,
    sessionStart: null
  };

  const Router = {
    routes: {},
    current: null,
    register(path, handler) { this.routes[path] = handler; },
    navigate(path, params = {}) {
      const [base] = path.split('?');
      const handler = this.routes[base];
      if (!handler) return;
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

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    });
    return node;
  }

  function toast(message, type = 'info', duration = 3000) {
    const container = $('#toast-container') || (() => {
      const c = el('div', { id: 'toast-container', style: 'position:fixed;top:80px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;' });
      document.body.appendChild(c);
      return c;
    })();
    const colors = { success: '#2e7d32', warning: '#ed6c02', danger: '#c62828', info: '#0277bd' };
    const t = el('div', {
      style: `background:${colors[type] || colors.info};color:#fff;padding:12px 20px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.2);font-size:0.9rem;font-weight:500;max-width:320px;`,
      text: message
    });
    container.appendChild(t);
    setTimeout(() => t.remove(), duration);
  }

  function formatDate(date) {
    const d = new Date(date);
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  
  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatLRN(lrn) {
    return String(lrn).replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  }
  
  function toTitleCase(str) {
    if (!str) return '';
    return str.toString().trim().toLowerCase().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  
  function toLastNameFormat(str) { return str ? str.toString().trim().toUpperCase() : ''; }
  
  function formatFullName(lastName, firstName, middleName) {
    const last = toLastNameFormat(lastName);
    const first = toTitleCase(firstName);
    const middle = middleName ? ' ' + toTitleCase(middleName) : '';
    return `${last}, ${first}${middle}`.trim();
  }
  
  function getSexBadge(sex) {
    const v = String(sex || '').trim().toLowerCase();
    if (v === 'male' || v === 'm') {
      return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;background:#e3f2fd;color:#0d47a1;font-size:0.72rem;font-weight:700;letter-spacing:0.3px;">♂ M</span>';
    }
    if (v === 'female' || v === 'f') {
      return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;background:#fce4ec;color:#ad1457;font-size:0.72rem;font-weight:700;letter-spacing:0.3px;">♀ F</span>';
    }
    return '<span style="color:#bdbdbd;">—</span>';
  }
  
  function sortStudents(list, order = 'last', dir = 'asc') {
    const arr = [...list];
    const dirMult = dir === 'desc' ? -1 : 1;
    return arr.sort((a, b) => {
      const ua = a.user || a;
      const ub = b.user || b;
      const aLast = (ua.lastName || '').toUpperCase();
      const bLast = (ub.lastName || '').toUpperCase();
      const aFirst = (ua.firstName || '').toUpperCase();
      const bFirst = (ub.firstName || '').toUpperCase();
      if (order === 'first') {
        if (aFirst !== bFirst) return aFirst.localeCompare(bFirst) * dirMult;
        if (aLast !== bLast) return aLast.localeCompare(bLast) * dirMult;
      } else {
        if (aLast !== bLast) return aLast.localeCompare(bLast) * dirMult;
        if (aFirst !== bFirst) return aFirst.localeCompare(bFirst) * dirMult;
      }
      const aMid = (ua.middleName || '').toUpperCase();
      const bMid = (ub.middleName || '').toUpperCase();
      return aMid.localeCompare(bMid) * dirMult;
    });
  }

  function renderVersions() {
    const v = `v${VERSION}`;
    document.querySelectorAll('.version').forEach((e) => { e.textContent = v; });
    document.querySelectorAll('[data-version]').forEach((e) => { e.textContent = v; });
    document.querySelectorAll('.app-footer, footer').forEach((footer) => {
      footer.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const updated = node.textContent.replace(/v\d+\.\d+\.\d+/g, v);
          if (updated !== node.textContent) node.textContent = updated;
        }
      });
    });
  }
  
  function getRootPrefix() {
    const path = window.location.pathname;
    const clean = path.replace(/^\/+/, '');
    const segments = clean.split('/').filter(Boolean);
    const folderDepth = Math.max(0, segments.length - 1);
    if (folderDepth === 0) return '';
    return '../'.repeat(folderDepth);
  }
  
  function injectManifest() {
    if (document.querySelector('link[rel="manifest"]')) return;
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = getRootPrefix() + 'manifest.json';
    document.head.appendChild(link);
  }

  function init() {
    console.log(`[${APP_NAME}] v${VERSION}`);
    renderVersions();
    injectManifest();
    Router.init();
  }

  return {
    VERSION, APP_NAME, state, Router,
    $, $$, el, toast,
    formatDate, formatTime, formatLRN,
    toTitleCase, toLastNameFormat, formatFullName,
    getSexBadge, sortStudents,
    renderVersions, getRootPrefix, injectManifest, init
  };
})();

document.addEventListener('DOMContentLoaded', APP.init);
