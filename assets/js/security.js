/* ============================================================
   security.js — HMAC-SHA256 signing + anti-cheat hooks
   Version: 1.1.0  (tab switch counted once; seeded shuffle for resume)
   ============================================================ */

const Security = (() => {
  'use strict';

  // v1: client-side secret (move to Apps Script backend in v2)
  const SECRET = 'GB-APP-2026-DEPED-SECRET-KEY-v1';

  /* ---------- HMAC-SHA256 ---------- */
  async function _getKey() {
    const enc = new TextEncoder();
    return crypto.subtle.importKey(
      'raw',
      enc.encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
  }

  function _bufToHex(buf) {
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function sign(payload) {
    const key = await _getKey();
    const enc = new TextEncoder();
    const data = enc.encode(JSON.stringify(payload));
    const sig = await crypto.subtle.sign('HMAC', key, data);
    return _bufToHex(sig);
  }

  async function verify(payload, signature) {
    const expected = await sign(payload);
    return expected === signature;
  }

  /* ---------- Anti-Cheat: Tab-Switch Detection ---------- */
  // One leave of the page fires both "blur" and "visibilitychange"; count it ONCE
  // (the old code counted 2 per switch). initialCount: violations already recorded
  // before a page reload, so reloading does not reset the counter.
  function startTabMonitor(onViolation, threshold = 3, initialCount = 0) {
    let count = Number(initialCount) || 0;
    let active = true;
    let away = false;
    let lastAt = 0;

    let unloading = false;               // reloading/closing the page is not a tab switch
    const leave = () => {
      if (!active || away || unloading) return;
      const now = Date.now();
      if (now - lastAt < 1500) return;
      away = true; lastAt = now;
      count++;
      onViolation?.(count, false);
      if (count >= threshold) {
        stopTabMonitor();
        onViolation?.(count, true); // final
      }
    };
    const back = () => { away = false; };
    const onVis = () => { if (document.hidden) leave(); else back(); };
    const onBlur = () => { setTimeout(() => { if (!document.hasFocus()) leave(); }, 250); };

    const onUnload = () => { unloading = true; };
    const onShow = () => { unloading = false; };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', back);
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('pageshow', onShow);

    function stopTabMonitor() {
      active = false;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', back);
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('pagehide', onUnload);
      window.removeEventListener('pageshow', onShow);
    }

    return { stop: stopTabMonitor, getCount: () => count };
  }

  /* ---------- Anti-Cheat: Copy/Paste/Cut Disable ---------- */
  function disableCopyPaste(rootEl = document) {
    const block = (e) => {
      e.preventDefault();
      if (window.APP?.toast) {
        APP.toast('Copying is disabled during assessments.', 'warning', 2000);
      }
      return false;
    };
    rootEl.addEventListener('copy', block);
    rootEl.addEventListener('cut', block);
    rootEl.addEventListener('paste', block);
    rootEl.addEventListener('contextmenu', block);
  }

  /* ---------- Anti-Cheat: Keyboard shortcuts ---------- */
  function disableDevShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + C, V, X, A, P, S, U
      const blocked = ['c', 'v', 'x', 'a', 'p', 's', 'u'];
      if ((e.ctrlKey || e.metaKey) && blocked.includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
      // F12, Ctrl+Shift+I/J/C
      if (e.key === 'F12' ||
          ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(e.key.toLowerCase()))) {
        e.preventDefault();
      }
    });
  }

  /* ---------- Question + Option Shuffle ---------- */
  function shuffle(arr, rng) {
    const r = rng || Math.random;
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function seededRng(seedStr) {
    let h = 2166136261;
    const str = String(seedStr);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    let a = h >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // seed (optional): same seed -> same order (used to resume an attempt after a reload)
  function shuffleQuestions(questions, seed) {
    const rng = seed ? seededRng(seed) : null;
    return shuffle(questions, rng).map((q) => ({
      ...q,
      options: shuffle(q.options || [], rng)
    }));
  }

  /* ---------- Timer ---------- */
  function createTimer(seconds, onTick, onExpire) {
    let remaining = seconds;
    const interval = setInterval(() => {
      remaining--;
      onTick?.(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onExpire?.();
      }
    }, 1000);

    return {
      stop: () => clearInterval(interval),
      getRemaining: () => remaining
    };
  }

  /* ---------- Public API ---------- */
  return {
    sign, verify,
    startTabMonitor,
    disableCopyPaste,
    disableDevShortcuts,
    shuffle, shuffleQuestions, seededRng,
    createTimer
  };
})();
