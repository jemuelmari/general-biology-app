/* ============================================================
   pt-rubric.js — guide + analytic rubric for a Performance Task option
   Version: 1.0.0 (data: data/performance-tasks.json → option.guide / deliverables / rubric)
   ============================================================ */
(function () {
  'use strict';
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  function html(opt, taskTitle) {
    if (!opt || !Array.isArray(opt.rubric) || !opt.rubric.length) {
      return '<div class="alert alert-info" style="margin-top:16px;">Ask your teacher for the rubric of this option.</div>';
    }
    var levels = opt.rubric[0].levels.map(function (l) { return l.label; });
    var total = opt.rubric.reduce(function (a, c) { return a + (Number(c.points) || 0); }, 0);
    var head = '<tr><th style="text-align:left;min-width:150px;">Criteria</th>' +
      levels.map(function (lv, i) {
        return '<th>' + esc(lv) + '</th>';
      }).join('') + '</tr>';
    var rows = opt.rubric.map(function (c) {
      return '<tr><td style="text-align:left;"><strong>' + esc(c.name) + '</strong><br><span class="pt-rb-pts">' + esc(c.points) + ' pts</span></td>' +
        c.levels.map(function (l) {
          return '<td><div class="pt-rb-pts">' + esc(l.points) + '</div>' + esc(l.desc) + '</td>';
        }).join('') + '</tr>';
    }).join('');
    return '' +
      '<div class="pt-rb" style="margin-top:18px;">' +
      '<style>' +
      '.pt-rb-guide{background:#f1f8e9;border-left:4px solid var(--color-primary,#2e7d32);border-radius:8px;padding:14px 16px;margin-bottom:14px;}' +
      '.pt-rb-guide ul{margin:8px 0 0 18px;padding:0;}' +
      '.pt-rb-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;}' +
      '.pt-rb table{width:100%;border-collapse:collapse;font-size:0.82rem;min-width:620px;}' +
      '.pt-rb th,.pt-rb td{border:1px solid #cfd8dc;padding:8px;vertical-align:top;text-align:left;}' +
      '.pt-rb th{background:var(--color-primary-dark,#1b5e20);color:#fff;text-align:center;}' +
      '.pt-rb-pts{font-weight:800;color:var(--color-primary-dark,#1b5e20);}' +
      '@media print{body *{visibility:hidden;} .pt-rb, .pt-rb *{visibility:visible;} .pt-rb{position:absolute;left:0;top:0;width:100%;} .pt-rb-noprint{display:none!important;} .pt-rb th{color:#000;background:#eee;}}' +
      '</style>' +
      '<div class="pt-rb-guide">' +
        '<div style="font-weight:800;color:var(--color-primary-dark,#1b5e20);">📌 Option ' + esc(opt.key) + ' · ' + esc(opt.label) + (opt.type ? ' <span style="font-weight:600;font-size:0.8rem;background:#fff;border:1px solid #c5e1a5;border-radius:999px;padding:2px 8px;margin-left:4px;">' + esc(opt.type) + '</span>' : '') + '</div>' +
        (taskTitle ? '<div class="text-small text-muted" style="margin-top:2px;">' + esc(taskTitle) + '</div>' : '') +
        '<p style="margin:8px 0 0;">' + esc(opt.guide || '') + '</p>' +
        (opt.deliverables && opt.deliverables.length ? '<div style="margin-top:8px;font-weight:700;">What to submit:</div><ul>' + opt.deliverables.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">' +
        '<strong>📊 Rubric (' + esc(total) + ' points)</strong>' +
        '<button type="button" class="btn btn-outline pt-rb-noprint" style="padding:4px 12px;font-size:0.8rem;" onclick="window.print()">🖨️ Print rubric</button>' +
      '</div>' +
      '<div class="pt-rb-wrap"><table><thead>' + head + '</thead><tbody>' + rows + '</tbody>' +
      '<tfoot><tr><td style="text-align:left;"><strong>Total</strong></td><td colspan="' + levels.length + '"><strong>' + esc(total) + ' points</strong></td></tr></tfoot></table></div>' +
      '</div>';
  }

  window.PTRubric = { html: html };
})();
