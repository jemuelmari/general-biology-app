/* ============================================================
   backup.js — Student backup file (download / upload)
   Version: 1.1.2
   ------------------------------------------------------------
   v1.1.2:
   - uploadBackup now also accepts { payload, signature } files
     (Sync Center format) in addition to { user, ... } files.
   ============================================================ */

const Backup = (() => {
  'use strict';

  /* ---------- Download Backup ---------- */
  function downloadBackup(lrn) {
    const data = Store.exportAll(lrn);
    if (!data) throw new Error('No data to export');

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);

    const filename = `GBA_Backup_${data.user.lrn}_${stamp}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    return filename;
  }

  /* ---------- Upload Backup (accepts both formats) ---------- */
  function uploadBackup(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const parsed = JSON.parse(e.target.result);

          /* ---------- Format 1: { user, progress, scores, badges } ---------- */
          if (parsed.user && parsed.user.lrn) {
            Store.importAll(parsed);
            return resolve(parsed);
          }

          /* ---------- Format 2: { payload, signature } ---------- */
          if (parsed.payload && parsed.payload.student && parsed.payload.student.lrn) {
            const { payload, signature } = parsed;

            // Try verify — but don't block if it fails
            let verified = false;
            if (signature && typeof Security !== 'undefined' && typeof Security.verify === 'function') {
              try {
                verified = await Security.verify(payload, signature);
              } catch (_) { verified = false; }
            }

            // Convert payload shape → backup.js shape
            const asBackup = {
              version: payload.version || '1.0.0',
              exportedAt: payload.generatedAt || new Date().toISOString(),
              user: payload.student,
              progress: payload.progress || {},
              scores: payload.scores || {},
              badges: payload.badges || {}
            };

            Store.importAll(asBackup);
            return resolve(asBackup);
          }

          /* ---------- Unknown shape ---------- */
          throw new Error('Unrecognized backup file format');
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('File read error'));
      reader.readAsText(file);
    });
  }

  /* ---------- Prompt: Keep or Delete on Logout ---------- */
  function promptOnLogout(user) {
    return new Promise((resolve) => {
      let resolved = false;
      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(autoTimer);
        overlay.remove();
        resolve(value);
      };

      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,0.6);
        display:flex;align-items:center;justify-content:center;
        z-index:9999;padding:20px;
      `;

      const modal = document.createElement('div');
      modal.style.cssText = `
        background:#fff;border-radius:12px;padding:24px;
        max-width:480px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.3);
        font-family:'Segoe UI',sans-serif;
      `;

      modal.innerHTML = `
        <h2 style="margin:0 0 8px;color:#1b7a3d;">Before you go, ${user.firstName}!</h2>
        <p style="margin:0 0 16px;color:#5f6368;font-size:0.9rem;">
          Do you want to keep your progress on this device, or delete it?
        </p>
        <div style="background:#f8f9fa;border-radius:8px;padding:12px;margin-bottom:16px;font-size:0.85rem;">
          <strong>${user.lastName}, ${user.firstName} ${user.middleName || ''}</strong><br>
          LRN: ${APP.formatLRN(user.lrn)}<br>
          Grade ${user.gradeLevel} — ${user.section}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button id="bk-keep" style="padding:12px;background:#1b7a3d;color:#fff;border:none;border-radius:6px;font-size:0.95rem;font-weight:600;cursor:pointer;">
            💾 Keep my data (I'll download a backup file)
          </button>
          <button id="bk-delete" style="padding:12px;background:#c62828;color:#fff;border:none;border-radius:6px;font-size:0.95rem;font-weight:600;cursor:pointer;">
            🗑️ Delete my data from this device
          </button>
          <button id="bk-cancel" style="padding:10px;background:transparent;color:#5f6368;border:1px solid #dadce0;border-radius:6px;font-size:0.9rem;cursor:pointer;">
            Cancel
          </button>
        </div>
        <p style="margin:12px 0 0;font-size:0.75rem;color:#9aa0a6;text-align:center;">
          Auto-logging out in <span id="bk-countdown">10</span>s...
        </p>
      `;

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      let secondsLeft = 10;
      const countdownEl = modal.querySelector('#bk-countdown');
      const countdownInterval = setInterval(() => {
        secondsLeft--;
        if (countdownEl) countdownEl.textContent = secondsLeft;
        if (secondsLeft <= 0) {
          clearInterval(countdownInterval);
          finish('timeout');
        }
      }, 1000);

      const autoTimer = setTimeout(() => {
        clearInterval(countdownInterval);
        finish('timeout');
      }, 11000);

      modal.querySelector('#bk-keep').onclick = () => {
        clearInterval(countdownInterval);
        try {
          const fn = downloadBackup(user.lrn);
          APP.toast(`Backup saved: ${fn}`, 'success', 3000);
        } catch (e) {
          APP.toast('Backup failed: ' + e.message, 'danger');
        }
        finish('keep');
      };

      modal.querySelector('#bk-delete').onclick = () => {
        clearInterval(countdownInterval);
        if (confirm('Are you sure? This will delete ALL progress for this student on this device.')) {
          Store.deleteUser(user.lrn);
          finish('delete');
        }
      };

      modal.querySelector('#bk-cancel').onclick = () => {
        clearInterval(countdownInterval);
        finish('cancel');
      };
    });
  }

  /* ---------- Public API ---------- */
  return { downloadBackup, uploadBackup, promptOnLogout };
})();
