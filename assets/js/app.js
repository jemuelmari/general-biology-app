/* ============================================================
   app.js — Router, state, and global initialization
   Version: 2.4.1
   ============================================================ */

const APP = (() => {
  'use strict';

  const VERSION = (typeof CONFIG !== 'undefined' && CONFIG.VERSION) || '2.4.1';
  const APP_NAME = (typeof CONFIG !== 'undefined' && CONFIG.APP_NAME) || 'General Biology Online Modular Application';

  const state = { /* ... */ };

  // ... [Router, $, $$, el, toast, formatDate, formatTime, formatLRN, etc. unchanged] ...

  /**
   * Compute the correct relative prefix to reach the repo root
   * from the current page, based on the actual folder depth.
   */
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
    // Use the robust root prefix function
    link.href = getRootPrefix() + 'manifest.json';
    document.head.appendChild(link);

    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#1b7a3d';
    document.head.appendChild(meta);
  }

  // ... [init, renderVersions, renderDeveloperFooter, etc. unchanged] ...

  return {
    VERSION, APP_NAME, state, Router,
    $, $$, el, toast,
    formatDate, formatTime, formatLRN,
    toTitleCase, toLastNameFormat,
    formatFullName, formatFullNameFMM,
    getSexValue, getSexCode, getSexIcon, getSexBadge,
    sortStudents, validateLRN, validateName,
    renderVersions, renderDeveloperFooter,
    getRootPrefix, injectManifest, init
  };
})();

document.addEventListener('DOMContentLoaded', APP.init);
