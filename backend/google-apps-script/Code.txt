/**
 * ============================================================
 * Google Apps Script Backend — General Biology App
 * File: Code.gs
 * Version: 5.0.0  (Sync-complete: auto-create sheets, TE fix, overrides, atomic writes)
 * ============================================================
 *
 * ANO ANG BINAGO SA v5.0.0 (kumpara sa 4.0.1)
 *  1. AUTO-CREATE ng lahat ng sheet + headers (ensureAllSheets_). Kung may kulang na sheet o header,
 *     gagawa/mag-aayos ito kusa. Puwede ring patakbuhin nang manual: SETUP_ALL_SHEETS().
 *  2. Term Exam (TE) ay laging nested: scores.biolX.te = { "biolX-te": {...} }  (dati: flat sa backend,
 *     nested sa frontend -> hindi lumalabas ang TE scores sa teacher).
 *  3. saveScore / saveProgress / upsert ay nasa ISANG script lock (read-modify-write ay atomic) at
 *     nagbabalik ng error kapag pumalya (dati: "ok" kahit hindi na-save -> nawawalang score).
 *  4. Hindi na gumagamit ng TextFinder sa pag-hanap ng LRN (nagdudulot ng "not found" + duplicate rows).
 *  5. Bagong actions: overrideScoresBatch (teacher offline/override scores), saveActivity,
 *     pullTeacherDashboard (alias), diagnose, setupSheets.
 *  6. getAllStudentsAggregated ay galing na sa StudentsMasterlist (progress + scores + badges + points)
 *     at ginagamit ang Records bilang safety-net.
 *  7. LastUpdated ay ina-update na sa bawat save. Points (PointsJSON) ay naka-sync na.
 * ============================================================
 */

const VERSION = '5.0.0';

const SHEET_MASTERLIST      = 'StudentsMasterlist';
const SHEET_NAME_RECORDS    = 'Records';
const SHEET_NAME_CODES      = 'SyncCodes';
const SHEET_NAME_LOG        = 'SyncLog';
const SHEET_NAME_REQUESTS   = 'UnlockRequests';
const SHEET_NAME_ACTIVITIES = 'ActivityLog';
const SHEET_NAME_OVERRIDES  = 'ScoreOverrides';

const CODE_EXPIRY_DAYS = 7;
const MAX_RETAKES = 2;
const RATE_LIMIT_PER_MIN = 120;
const LOCK_WAIT_MS = 25000;
const SUBJECTS = ['biol1', 'biol2'];
const SCORE_TYPES = ['quizzes', 'st', 'pt', 'te', 'activities'];

// NOTE: bagong columns ay laging idinadagdag SA DULO para hindi masira ang lumang data.
const MASTERLIST_HEADERS = [
  'LRN', 'LastName', 'FirstName', 'MiddleName', 'GradeLevel', 'Section', 'Sex',
  'ProgressJSON', 'ScoresJSON', 'BadgesJSON', 'LocksJSON',
  'LastUpdated', 'CreatedAt', 'UpdatedAt', 'IntegrityHash', 'DeviceId',
  'PointsJSON'
];

const RECORD_HEADERS = [
  'LRN', 'LastName', 'FirstName', 'MiddleName', 'GradeLevel', 'Section',
  'Subject', 'Type', 'AssessmentId', 'Score', 'Total', 'Percent',
  'Passed', 'AutoSubmitted', 'TabViolations', 'Timestamp',
  'PayloadJSON', 'Signature', 'LastUpdated'
];

const CODE_HEADERS = ['Code', 'LRN', 'PayloadJSON', 'Signature', 'CreatedAt', 'ExpiresAt', 'Used'];
const LOG_HEADERS = ['Timestamp', 'Action', 'LRN', 'Details'];
const REQUEST_HEADERS = [
  'RequestId', 'LRN', 'StudentName', 'Section', 'AssessmentId',
  'Reason', 'Score', 'Total', 'RequestedAt',
  'Status', 'UnlockCode', 'CodeGeneratedAt', 'CodeExpiresAt', 'AppliedAt',
  'RetakeNumber', 'IsFinalAttempt'
];
const ACTIVITY_HEADERS = [
  'LRN', 'LastName', 'FirstName', 'Section', 'Subject', 'Week', 'Day',
  'Activity', 'Percent', 'Passed', 'Attempts', 'Timestamp', 'DeviceId'
];
const OVERRIDE_HEADERS = [
  'Timestamp', 'LRN', 'StudentName', 'Section', 'Subject', 'Type', 'AssessmentId',
  'Score', 'Total', 'Percent', 'Reason', 'TakenOn', 'Reverted', 'Removed', 'PreviousJSON'
];

// Lahat ng sheet na kailangan ng app. textCols = columns (1-based) na dapat TEXT (LRN, timestamps).
const SHEET_SPECS = [
  { name: SHEET_MASTERLIST,      headers: MASTERLIST_HEADERS, textCols: [1, 12, 13, 14] },
  { name: SHEET_NAME_RECORDS,    headers: RECORD_HEADERS,     textCols: [1, 16, 19] },
  { name: SHEET_NAME_CODES,      headers: CODE_HEADERS,       textCols: [] },
  { name: SHEET_NAME_LOG,        headers: LOG_HEADERS,        textCols: [] },
  { name: SHEET_NAME_REQUESTS,   headers: REQUEST_HEADERS,    textCols: [2] },
  { name: SHEET_NAME_ACTIVITIES, headers: ACTIVITY_HEADERS,   textCols: [1, 12] },
  { name: SHEET_NAME_OVERRIDES,  headers: OVERRIDE_HEADERS,   textCols: [1, 2] }
];

const WRITE_ACTIONS = [
  'saveProgress', 'saveScore', 'saveActivity', 'upsertStudentMaster', 'getStudentByLRN',
  'registerSyncCode', 'consumeSyncCode', 'requestRetake', 'approveRetake', 'cancelRequest',
  'redeemUnlockCode', 'migrateAllToMasterlist', 'overrideScoresBatch'
];

// ============================================================
// UTILITIES
// ============================================================
function normalizeLRN(lrn) {
  if (lrn === null || lrn === undefined) return '';
  let s = String(lrn).trim();
  if (s.endsWith('.0')) s = s.slice(0, -2);
  if (/e\+?\d+$/i.test(s)) { const n = Number(s); if (isFinite(n)) s = String(Math.round(n)); }
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length > 12) return digits.slice(0, 12);
  if (digits.length < 12) return digits.padStart(12, '0');
  return digits;
}

function getTeacherSecret() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('TEACHER_SECRET');
  if (!secret) {
    secret = 'DEPED-TEACHER-SECRET-2026';
    props.setProperty('TEACHER_SECRET', secret);
  }
  return secret;
}

function requireTeacherToken(token) {
  if (!token) throw new Error('ERR_UNAUTHORIZED: Teacher token required');
  if (token === getTeacherSecret()) return;
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8);
  const hex = hash.map((b) => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0')).join('');
  if (hex === '01d58c1ac3df6d023d869e50bf78e2f9185332c281f665fd53f6dbd7592df45e') return;
  throw new Error('ERR_UNAUTHORIZED: Invalid teacher token');
}

function toIso_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  return v === null || v === undefined ? '' : String(v);
}

function tsMs_(o) {
  if (!o) return 0;
  const t = new Date(o.timestamp || 0).getTime();
  return isNaN(t) ? 0 : t;
}

function parseJson_(s, fallback) {
  if (s === '' || s === null || s === undefined) return fallback;
  try { const v = JSON.parse(s); return (v && typeof v === 'object') ? v : fallback; } catch (e) { return fallback; }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function logEvent(action, lrn, details) {
  try {
    const sheet = getSheet_(SHEET_NAME_LOG);
    sheet.appendRow([new Date().toISOString(), action, lrn || '', String(details || '').slice(0, 2000)]);
  } catch (e) { /* silent */ }
}

function checkRateLimit(lrn) {
  const cache = CacheService.getScriptCache();
  const key = 'rate_' + lrn;
  const count = Number(cache.get(key) || 0);
  if (count >= RATE_LIMIT_PER_MIN) throw new Error('ERR_RATE_LIMITED: Please wait a minute');
  cache.put(key, String(count + 1), 60);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_WAIT_MS);
  } catch (e) {
    return { ok: false, error: 'ERR_BUSY: Server busy, will retry', code: 'BUSY' };
  }
  try { return fn(); } finally { lock.releaseLock(); }
}

// ============================================================
// SHEET MANAGEMENT  (auto-create + header repair)
// ============================================================
let SHEETS_READY_ = false;

function getSheet_(name) {
  const spec = SHEET_SPECS.filter((s) => s.name === name)[0];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet && spec) sheet = ensureSheet_(spec).sheet;
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

// Compat para sa lumang tawag
function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  const spec = SHEET_SPECS.filter((s) => s.name === name)[0];
  if (spec) return ensureSheet_(spec).sheet;
  const created = ss.insertSheet(name);
  if (headers) created.appendRow(headers);
  return created;
}

/** Gumagawa ng sheet kung wala; naglalagay ng kulang na headers; ini-report ang mismatch. */
function ensureSheet_(spec) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = { name: spec.name, created: false, headersAdded: [], mismatches: [] };
  let sheet = ss.getSheetByName(spec.name);
  if (!sheet) {
    sheet = ss.insertSheet(spec.name);
    report.created = true;
  }
  const need = spec.headers.length;
  if (sheet.getMaxColumns() < need) sheet.insertColumnsAfter(sheet.getMaxColumns(), need - sheet.getMaxColumns());
  const lastCol = Math.max(sheet.getLastColumn(), need);
  const row1 = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const fmtCols = [];
  for (let i = 0; i < need; i++) {
    const cur = String(row1[i] === undefined || row1[i] === null ? '' : row1[i]).trim();
    if (!cur) {
      sheet.getRange(1, i + 1).setValue(spec.headers[i]);
      report.headersAdded.push(spec.headers[i]);
      fmtCols.push(i + 1);
    } else if (cur.toLowerCase() !== spec.headers[i].toLowerCase()) {
      report.mismatches.push('col ' + (i + 1) + ': "' + cur + '" (expected "' + spec.headers[i] + '")');
    }
  }
  if (report.created || report.headersAdded.length) {
    sheet.getRange(1, 1, 1, need).setFontWeight('bold').setBackground('#e6f4ea');
    sheet.setFrozenRows(1);
  }
  (spec.textCols || []).forEach((c) => {
    sheet.getRange(1, c, sheet.getMaxRows(), 1).setNumberFormat('@');
  });
  return { sheet, report };
}

function ensureAllSheets_(force) {
  if (SHEETS_READY_ && !force) return [];
  const cache = CacheService.getScriptCache();
  if (!force && cache.get('sheets_ok_' + VERSION)) { SHEETS_READY_ = true; return []; }
  const reports = SHEET_SPECS.map((spec) => ensureSheet_(spec).report);
  SHEETS_READY_ = true;
  try { cache.put('sheets_ok_' + VERSION, '1', 600); } catch (e) { /* ignore */ }
  return reports;
}

/** I-RUN ITO MANUAL (Run > SETUP_ALL_SHEETS) para gawin/ayusin lahat ng sheet at headers. */
function SETUP_ALL_SHEETS() {
  const reports = ensureAllSheets_(true);
  const lines = reports.map((r) =>
    (r.created ? '🆕 GINAWA ' : '✅ MERON  ') + r.name +
    (r.headersAdded.length ? '  (headers added: ' + r.headersAdded.join(', ') + ')' : '') +
    (r.mismatches.length ? '  ⚠️ MISMATCH: ' + r.mismatches.join(' | ') : '')
  );
  console.log('SETUP_ALL_SHEETS v' + VERSION + '\n' + lines.join('\n'));
  logEvent('SETUP_ALL_SHEETS', '', lines.join(' ; '));
  return reports;
}

function handleDiagnose(body) {
  requireTeacherToken(body.token);
  const reports = ensureAllSheets_(true);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = SHEET_SPECS.map((spec) => {
    const sh = ss.getSheetByName(spec.name);
    const rep = reports.filter((r) => r.name === spec.name)[0] || {};
    return {
      name: spec.name, exists: !!sh, createdNow: !!rep.created,
      rows: sh ? Math.max(0, sh.getLastRow() - 1) : 0,
      headersAdded: rep.headersAdded || [], mismatches: rep.mismatches || []
    };
  });
  return { ok: true, version: VERSION, sheets };
}

// ============================================================
// SCORE / PROGRESS SHAPES + MERGE
// ============================================================
function isFlatEntry_(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  return ['score', 'percent', 'total', 'passed'].some((k) => o[k] !== undefined && typeof o[k] !== 'object');
}

/** Siguraduhing nested ang lahat ng type: { subject: { type: { assessmentId: entry } } } */
function normalizeScores_(scores) {
  const out = {};
  if (!scores || typeof scores !== 'object') return out;
  Object.keys(scores).forEach((subj) => {
    const s = scores[subj];
    if (!s || typeof s !== 'object') return;
    out[subj] = {};
    Object.keys(s).forEach((type) => {
      let v = s[type];
      if (v === null || v === undefined) { out[subj][type] = {}; return; }
      if (typeof v !== 'object') return;
      if (type === 'te' && isFlatEntry_(v)) {              // LUMANG FLAT TE -> nested
        const e = {}; e[subj + '-te'] = v; v = e;
      }
      out[subj][type] = v;
    });
  });
  return out;
}

function mergeEntry_(ext, inc) {
  if (!ext) return inc;
  if (!inc) return ext;
  const eo = ext.override, io = inc.override;
  if (eo && !io) return (inc.timestamp || '') > (eo.at || '') ? inc : ext;
  if (io && !eo) return (ext.timestamp || '') > (io.at || '') ? ext : inc;
  if (eo && io) return (io.at || '') >= (eo.at || '') ? inc : ext;
  const it = tsMs_(inc), et = tsMs_(ext);
  if (it > et) return inc;
  if (it === et && (Number(inc.score) || 0) > (Number(ext.score) || 0)) return inc;
  return ext;
}

function mergeScores(existing, incoming) {
  const base = normalizeScores_(existing);
  const inc = normalizeScores_(incoming);
  Object.keys(inc).forEach((subj) => {
    if (!base[subj]) base[subj] = {};
    Object.keys(inc[subj]).forEach((type) => {
      if (!base[subj][type] || typeof base[subj][type] !== 'object') base[subj][type] = {};
      const items = inc[subj][type] || {};
      Object.keys(items).forEach((id) => {
        if (!items[id]) return;
        base[subj][type][id] = mergeEntry_(base[subj][type][id], items[id]);
      });
    });
  });
  return base;
}

function mergeProgress(existing, incoming) {
  if (!incoming) return existing || {};
  if (!existing) return incoming;
  const merged = JSON.parse(JSON.stringify(existing));
  for (const subj in incoming) {
    const inc = incoming[subj];
    if (!inc || typeof inc !== 'object') continue;
    if (!merged[subj]) merged[subj] = { completed: [], weeks: {} };
    merged[subj].completed = Array.from(new Set([...(merged[subj].completed || []), ...(inc.completed || [])]));
    const incWeeks = inc.weeks || {};
    if (!merged[subj].weeks) merged[subj].weeks = {};
    for (const w in incWeeks) {
      if (!merged[subj].weeks[w]) merged[subj].weeks[w] = {};
      Object.assign(merged[subj].weeks[w], incWeeks[w]);
    }
  }
  return merged;
}

function mergeBadges(existing, incoming) {
  if (!incoming) return existing || {};
  if (!existing) return incoming;
  const merged = JSON.parse(JSON.stringify(existing));
  for (const subj in incoming) {
    merged[subj] = Array.from(new Set([...(merged[subj] || []), ...(Array.isArray(incoming[subj]) ? incoming[subj] : [])]));
  }
  return merged;
}

function mergeLocks(existing, incoming) {
  if (!incoming) return existing || {};
  if (!existing) return incoming;
  return Object.assign({}, existing, incoming);
}

// Points: { "biol1_w1_d1": 40 }  -> kunin ang mas mataas
function mergePoints(existing, incoming) {
  const out = Object.assign({}, existing || {});
  Object.keys(incoming || {}).forEach((k) => {
    const v = Number(incoming[k]) || 0;
    if (!(k in out) || v > (Number(out[k]) || 0)) out[k] = v;
  });
  return out;
}

function stripHeavyFields(obj) {
  const copy = JSON.parse(JSON.stringify(obj));
  for (const subj in copy) {
    const s = copy[subj];
    if (!s || typeof s !== 'object') continue;
    ['quizzes', 'st', 'pt', 'te'].forEach((t) => {
      if (s[t] && typeof s[t] === 'object') Object.keys(s[t]).forEach((id) => { if (s[t][id]) delete s[t][id].breakdown; });
    });
  }
  return copy;
}

// Cell limit = 50,000 chars. Hindi magsusulat ng putol na JSON.
function safeJson_(obj, label, lrn) {
  let s = JSON.stringify(obj);
  if (s.length <= 45000) return s;
  s = JSON.stringify(stripHeavyFields(obj));
  logEvent('WARN_OVERSIZE', lrn, label + ' stripped, len=' + s.length);
  if (s.length > 49000) throw new Error('ERR_TOO_LARGE: ' + label + ' exceeds cell limit');
  return s;
}

// ============================================================
// MASTERLIST ACCESS
// ============================================================
function rowToMasterRecord(row) {
  const o = {};
  MASTERLIST_HEADERS.forEach((h, i) => (o[h] = row[i] === undefined ? '' : row[i]));
  o.LRN = normalizeLRN(o.LRN);
  o.ProgressObj = parseJson_(o.ProgressJSON, {});
  o.ScoresObj = normalizeScores_(parseJson_(o.ScoresJSON, {}));
  o.BadgesObj = parseJson_(o.BadgesJSON, {});
  o.LocksObj = parseJson_(o.LocksJSON, {});
  o.PointsObj = parseJson_(o.PointsJSON, {});
  o.LastUpdated = toIso_(o.LastUpdated);
  o.CreatedAt = toIso_(o.CreatedAt);
  o.UpdatedAt = toIso_(o.UpdatedAt);
  return o;
}

// Ipinapadala sa client: tanggalin ang malalaking raw JSON (nandoon na ang *Obj)
function publicMaster_(rec) {
  const c = Object.assign({}, rec);
  delete c.ProgressJSON; delete c.ScoresJSON; delete c.BadgesJSON; delete c.LocksJSON; delete c.PointsJSON;
  return c;
}

function rowToRecord(row) {
  const o = {};
  RECORD_HEADERS.forEach((h, i) => (o[h] = row[i] === undefined ? '' : row[i]));
  o.LRN = normalizeLRN(o.LRN);
  return o;
}

/** Hinahanap ang row ng LRN sa column A (normalized; hindi TextFinder). -1 kung wala. */
function findMasterRow_(sheet, lrn) {
  const last = sheet.getLastRow();
  if (last < 2 || !lrn) return -1;
  const col = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < col.length; i++) {
    if (normalizeLRN(col[i][0]) === lrn) return i + 2;
  }
  return -1;
}

function readMasterAt_(sheet, row) {
  const n = MASTERLIST_HEADERS.length;
  return rowToMasterRecord(sheet.getRange(row, 1, 1, n).getValues()[0]);
}

/**
 * Core write. Dapat tinatawag sa loob ng withLock_.
 * data: { student, progress, scores, badges, locks, points, deviceId, integrityHash, removeIds }
 */
function upsertMaster_(lrn, data) {
  const sheet = getSheet_(SHEET_MASTERLIST);
  const row = findMasterRow_(sheet, lrn);
  const now = new Date().toISOString();
  const student = data.student || {};
  const existing = row > 0 ? readMasterAt_(sheet, row) : null;

  const progress = mergeProgress(existing ? existing.ProgressObj : {}, data.progress);
  let scores = mergeScores(existing ? existing.ScoresObj : {}, data.scores);
  if (data.removeIds && data.removeIds.length) {
    data.removeIds.forEach((r) => { if (scores[r.subject] && scores[r.subject][r.type]) delete scores[r.subject][r.type][r.id]; });
  }
  const badges = mergeBadges(existing ? existing.BadgesObj : {}, data.badges);
  const locks = mergeLocks(existing ? existing.LocksObj : {}, data.locks);
  const points = mergePoints(existing ? existing.PointsObj : {}, data.points);

  const out = [
    lrn,
    student.lastName || (existing && existing.LastName) || '',
    student.firstName || (existing && existing.FirstName) || '',
    student.middleName || (existing && existing.MiddleName) || '',
    student.gradeLevel || (existing && existing.GradeLevel) || '',
    student.section || (existing && existing.Section) || '',
    student.sex || (existing && existing.Sex) || '',
    safeJson_(progress, 'Progress', lrn),
    safeJson_(scores, 'Scores', lrn),
    safeJson_(badges, 'Badges', lrn),
    safeJson_(locks, 'Locks', lrn),
    now,
    (existing && existing.CreatedAt) || now,
    now,
    data.integrityHash || (existing && existing.IntegrityHash) || '',
    data.deviceId || (existing && existing.DeviceId) || '',
    safeJson_(points, 'Points', lrn)
  ];

  const target = row > 0 ? row : sheet.getLastRow() + 1;
  const range = sheet.getRange(target, 1, 1, MASTERLIST_HEADERS.length);
  range.setNumberFormat('@');
  range.setValues([out]);
  return { created: row < 0, row: target, merged: !!existing };
}

// ============================================================
// ENTRY POINTS
// ============================================================
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const lrn = body.lrn ? normalizeLRN(body.lrn) : null;
    if (lrn && ['saveProgress', 'saveScore', 'saveActivity', 'upsertStudentMaster', 'getStudentByLRN'].includes(action)) {
      checkRateLimit(lrn);
    }
    ensureAllSheets_(false);
    return jsonResponse(route_(action, body));
  } catch (err) {
    logEvent('ERROR', '', 'doPost error: ' + err.message);
    return jsonResponse({ ok: false, error: err.message, code: String(err.message).split(':')[0] || 'SERVER_ERROR' });
  }
}

function route_(action, body) {
  switch (action) {
    case 'saveProgress':               return withLock_(() => handleSaveProgress(body));
    case 'saveScore':                  return withLock_(() => handleSaveScore(body));
    case 'saveActivity':               return withLock_(() => handleSaveActivity(body));
    case 'upsertStudentMaster':        return withLock_(() => handleUpsertStudentMaster(body));
    case 'getStudentByLRN':            return withLock_(() => handleGetStudentByLRN(body));
    case 'overrideScoresBatch':        return withLock_(() => handleOverrideScoresBatch(body));
    case 'registerSyncCode':           return withLock_(() => handleRegisterSyncCode(body));
    case 'resolveSyncCode':            return handleResolveSyncCode(body, false);
    case 'consumeSyncCode':            return withLock_(() => handleResolveSyncCode(body, true));
    case 'requestRetake':              return withLock_(() => handleRequestRetake(body));
    case 'getStudentRequests':         return handleGetStudentRequests(body);
    case 'getUnlockRequests':          return handleGetUnlockRequests(body);
    case 'approveRetake':              return withLock_(() => handleApproveRetake(body));
    case 'cancelRequest':              return withLock_(() => handleCancelRequest(body));
    case 'redeemUnlockCode':           return withLock_(() => handleRedeemUnlockCode(body));
    case 'getAllStudentsAggregated':
    case 'pullTeacherDashboard':       return handleGetAllStudentsAggregated(body);
    case 'getAllStudentsFromMasterlist': return handleGetAllStudentsFromMasterlist(body);
    case 'migrateAllToMasterlist':     return withLock_(() => handleMigrateAllToMasterlist(body));
    case 'diagnose':
    case 'setupSheets':                return handleDiagnose(body);
    case 'ping':                       return pingInfo_();
    default:                           return { ok: false, error: 'ERR_UNKNOWN_ACTION: ' + action, code: 'UNKNOWN_ACTION' };
  }
}

function pingInfo_() {
  return { ok: true, message: 'Backend is live', version: VERSION, timestamp: new Date().toISOString() };
}

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const action = p.action || 'ping';
    switch (action) {
      case 'ping': ensureAllSheets_(false); return jsonResponse(pingInfo_());
      case 'resolveSyncCode': return jsonResponse(handleResolveSyncCode({ code: p.code }, false));
      case 'getAllStudentsAggregated': return jsonResponse(handleGetAllStudentsAggregated({ token: p.token }));
      case 'diagnose': return jsonResponse(handleDiagnose({ token: p.token }));
      default: return jsonResponse({ ok: false, error: 'ERR_UNKNOWN_ACTION', code: 'UNKNOWN_ACTION' });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message, code: String(err.message).split(':')[0] || 'SERVER_ERROR' });
  }
}

// ============================================================
// CORE HANDLERS (student)
// ============================================================
function handleGetStudentByLRN(body) {
  const lrn = normalizeLRN(body.lrn);
  if (!lrn || lrn.length !== 12) return { ok: false, error: 'ERR_BAD_LRN: Missing or invalid LRN', code: 'BAD_LRN' };
  const sheet = getSheet_(SHEET_MASTERLIST);
  const row = findMasterRow_(sheet, lrn);
  if (row > 0) return { ok: true, student: publicMaster_(readMasterAt_(sheet, row)) };
  const migrated = lazyMigrateFromRecords(lrn);
  if (migrated) return { ok: true, student: publicMaster_(migrated), migrated: true };
  return { ok: false, error: 'ERR_NOT_FOUND: Student not found', code: 'NOT_FOUND' };
}

function handleUpsertStudentMaster(body) {
  const lrn = normalizeLRN(body.lrn);
  if (!lrn || lrn.length !== 12) return { ok: false, error: 'ERR_BAD_LRN', code: 'BAD_LRN' };
  const r = upsertMaster_(lrn, {
    student: body.student, progress: body.progress, scores: body.scores, badges: body.badges,
    locks: body.locks, points: body.points, deviceId: body.deviceId, integrityHash: body.integrityHash
  });
  return r.created ? { ok: true, message: 'Masterlist created', created: true } : { ok: true, message: 'Masterlist updated', merged: true };
}

function handleSaveProgress(body) {
  const lrn = normalizeLRN(body.lrn);
  if (!lrn || lrn.length !== 12) return { ok: false, error: 'ERR_BAD_LRN', code: 'BAD_LRN' };
  upsertMaster_(lrn, {
    student: body.student, progress: body.progress, scores: body.scores, badges: body.badges,
    points: body.points, deviceId: body.deviceId, integrityHash: body.integrityHash
  });
  return { ok: true, message: 'Progress saved', lrn };
}

/** Isang attempt ng quiz/ST/TE/PT. Nasa loob ng lock; nagbabalik ng error kapag hindi na-save. */
function handleSaveScore(body) {
  const lrn = normalizeLRN(body.lrn);
  const assessmentId = String(body.assessmentId || '');
  const subject = String(body.subject || '');
  let type = String(body.type || 'quizzes');
  if (type === 'quiz') type = 'quizzes';
  if (!lrn || lrn.length !== 12 || !assessmentId) return { ok: false, error: 'ERR_BAD_REQUEST: Missing LRN or AssessmentId', code: 'BAD_REQUEST' };
  if (SUBJECTS.indexOf(subject) < 0) return { ok: false, error: 'ERR_BAD_SUBJECT: ' + subject, code: 'BAD_SUBJECT' };
  if (typeof body.total === 'number' && typeof body.score === 'number' && body.score > body.total) {
    return { ok: false, error: 'ERR_BAD_SCORE: score cannot exceed total', code: 'BAD_SCORE' };
  }
  const ts = body.timestamp || new Date().toISOString();
  const entry = buildEntry_(body, ts);

  const scores = {}; scores[subject] = {}; scores[subject][type] = {}; scores[subject][type][assessmentId] = entry;
  upsertMaster_(lrn, { student: body.student, scores: scores, deviceId: body.deviceId, integrityHash: body.integrityHash });

  const sheet = getSheet_(SHEET_NAME_RECORDS);
  if (recordExists_(sheet, lrn, assessmentId, ts)) {
    return { ok: true, message: 'Score saved', lrn, assessmentId, duplicate: true };
  }
  appendRecord_(sheet, lrn, body.student, subject, type, assessmentId, entry, { breakdown: entry.breakdown || [] });
  logEvent('saveScore', lrn, assessmentId + ' ' + (entry.score === null ? '-' : entry.score) + '/' + (entry.total === null ? '-' : entry.total));
  return { ok: true, message: 'Score saved', lrn, assessmentId };
}

function buildEntry_(body, ts) {
  const entry = {
    score: body.score === undefined ? null : body.score,
    total: body.total === undefined ? null : body.total,
    percent: body.percent === undefined ? null : body.percent,
    passed: !!body.passed,
    timestamp: ts,
    breakdown: Array.isArray(body.breakdown) ? body.breakdown : []
  };
  ['autoSubmitted', 'tabViolations', 'durationSec', 'status', 'maxScore', 'option', 'optionLabel'].forEach((k) => {
    if (body[k] !== undefined && body[k] !== null) entry[k] = body[k];
  });
  if (body.extra && typeof body.extra === 'object') {
    Object.keys(body.extra).forEach((k) => { if (entry[k] === undefined) entry[k] = body.extra[k]; });
  }
  if (body.override && typeof body.override === 'object' && !body.override.reverted) {
    entry.override = {
      by: body.override.by || 'teacher', reason: body.override.reason || '',
      takenOn: body.override.takenOn || '', at: body.override.at || ts
    };
  }
  return entry;
}

function appendRecord_(sheet, lrn, student, subject, type, assessmentId, entry, payload) {
  const now = new Date().toISOString();
  const st = student || {};
  sheet.appendRow([
    lrn, st.lastName || '', st.firstName || '', st.middleName || '', st.gradeLevel || '', st.section || '',
    subject, String(type).toUpperCase(), assessmentId,
    entry.score === null || entry.score === undefined ? '' : entry.score,
    entry.total === null || entry.total === undefined ? '' : entry.total,
    entry.percent === null || entry.percent === undefined ? '' : entry.percent,
    entry.passed ? 'TRUE' : 'FALSE', entry.autoSubmitted ? 'TRUE' : 'FALSE',
    entry.tabViolations || 0, entry.timestamp || now,
    JSON.stringify(payload || {}), '', now
  ]);
}

// Tingnan ang huling 300 rows ng Records kung nandoon na ang attempt na ito
function recordExists_(sheet, lrn, assessmentId, ts) {
  if (!ts) return false;
  const last = sheet.getLastRow();
  if (last < 2) return false;
  const start = Math.max(2, last - 299);
  const vals = sheet.getRange(start, 1, last - start + 1, 16).getValues();
  const target = Math.floor(new Date(ts).getTime() / 1000);
  if (isNaN(target)) return false;
  for (let i = vals.length - 1; i >= 0; i--) {
    const v = vals[i];
    if (normalizeLRN(v[0]) !== lrn) continue;
    if (String(v[8]) !== String(assessmentId)) continue;
    if (Math.floor(new Date(v[15]).getTime() / 1000) === target) return true;
  }
  return false;
}

/** Resulta ng bawat lesson activity (Activity 1, 2, Formative). */
function handleSaveActivity(body) {
  const lrn = normalizeLRN(body.lrn);
  const subject = String(body.subject || '');
  const activity = String(body.activity || '');
  if (!lrn || lrn.length !== 12 || SUBJECTS.indexOf(subject) < 0 || !activity) {
    return { ok: false, error: 'ERR_BAD_REQUEST: lrn/subject/activity required', code: 'BAD_REQUEST' };
  }
  const week = Number(body.week) || 0, day = Number(body.day) || 0;
  const id = 'w' + week + '-d' + day + '-' + activity;
  const ts = body.timestamp || new Date().toISOString();
  const entry = {
    percent: Number(body.percent) || 0, score: Number(body.percent) || 0, total: 100,
    passed: !!body.passed, attempts: Number(body.attempts) || 1, week, day, activity, timestamp: ts
  };
  const scores = {}; scores[subject] = { activities: {} }; scores[subject].activities[id] = entry;
  upsertMaster_(lrn, { student: body.student, scores, progress: body.progress, badges: body.badges, points: body.points, deviceId: body.deviceId });

  const st = body.student || {};
  getSheet_(SHEET_NAME_ACTIVITIES).appendRow([
    lrn, st.lastName || '', st.firstName || '', st.section || '', subject, week, day, activity,
    entry.percent, entry.passed ? 'TRUE' : 'FALSE', entry.attempts, ts, body.deviceId || ''
  ]);
  return { ok: true, message: 'Activity saved', lrn, id };
}

// ============================================================
// TEACHER: OVERRIDE / OFFLINE SCORES
// ============================================================
function handleOverrideScoresBatch(body) {
  requireTeacherToken(body.token);
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return { ok: true, saved: 0, message: 'No items' };

  const byLrn = {};
  items.forEach((it) => {
    const lrn = normalizeLRN(it.lrn);
    if (!lrn || lrn.length !== 12) return;
    (byLrn[lrn] = byLrn[lrn] || []).push(it);
  });

  const recSheet = getSheet_(SHEET_NAME_RECORDS);
  const ovSheet = getSheet_(SHEET_NAME_OVERRIDES);
  let saved = 0, removed = 0;
  const errors = [];

  Object.keys(byLrn).forEach((lrn) => {
    try {
      const scores = {}, removeIds = [];
      let student = null;
      byLrn[lrn].forEach((it) => {
        const subject = String(it.subject || ''), assessmentId = String(it.assessmentId || '');
        let type = String(it.type || 'quizzes'); if (type === 'quiz') type = 'quizzes';
        if (SUBJECTS.indexOf(subject) < 0 || !assessmentId) return;
        student = it.student || student;
        const ts = it.timestamp || new Date().toISOString();
        const ov = it.override || {};
        if (it.removed) {
          removeIds.push({ subject, type, id: assessmentId });
          // tombstone sa Records para hindi na bumalik ang lumang attempt
          appendRecord_(recSheet, lrn, it.student, subject, type, assessmentId,
            { score: 0, total: it.total || 0, percent: 0, passed: false, timestamp: ts }, { removed: true, override: ov });
          removed++;
        } else {
          const entry = buildEntry_(it, ts);
          if (ov.reverted) delete entry.override;
          if (!scores[subject]) scores[subject] = {};
          if (!scores[subject][type]) scores[subject][type] = {};
          scores[subject][type][assessmentId] = entry;
          appendRecord_(recSheet, lrn, it.student, subject, type, assessmentId, entry,
            { breakdown: [], override: ov.reverted ? null : (entry.override || null), reverted: !!ov.reverted });
          saved++;
        }
        const st = it.student || {};
        ovSheet.appendRow([
          new Date().toISOString(), lrn, ((st.lastName || '') + ', ' + (st.firstName || '')).replace(/^, |, $/g, ''),
          st.section || '', subject, type, assessmentId,
          it.score === undefined ? '' : it.score, it.total === undefined ? '' : it.total,
          it.percent === undefined ? '' : it.percent, ov.reason || '', ov.takenOn || '',
          ov.reverted ? 'TRUE' : 'FALSE', it.removed ? 'TRUE' : 'FALSE', ''
        ]);
      });
      upsertMaster_(lrn, { student: student, scores: scores, removeIds: removeIds, deviceId: 'teacher' });
    } catch (e) {
      errors.push(lrn + ': ' + e.message);
    }
  });
  logEvent('overrideScoresBatch', '', 'saved=' + saved + ' removed=' + removed + ' errors=' + errors.length);
  if (errors.length && !saved && !removed) return { ok: false, error: 'ERR_OVERRIDE_FAILED: ' + errors.join('; '), code: 'OVERRIDE_FAILED' };
  return { ok: true, saved, removed, errors };
}

// ============================================================
// TEACHER: AGGREGATED VIEW  (Masterlist + Records safety-net)
// ============================================================
function scoreKeyType_(aid, typeCol) {
  const t = String(typeCol || '').toLowerCase();
  if (t === 'quizzes' || t === 'quiz') return 'quizzes';
  if (t === 'st' || t === 'pt' || t === 'te') return t;
  if (aid.indexOf('-quiz') !== -1) return 'quizzes';
  if (aid.indexOf('-st') !== -1) return 'st';
  if (aid.indexOf('-te') !== -1) return 'te';
  if (aid.indexOf('-pt') !== -1) return 'pt';
  return null;
}

function emptyStudent_(lrn) {
  const sc = {}, pr = {};
  SUBJECTS.forEach((s) => { sc[s] = { quizzes: {}, st: {}, pt: {}, te: {}, activities: {} }; pr[s] = { weeks: {}, completed: [] }; });
  return { lrn, lastName: '', firstName: '', middleName: '', gradeLevel: '', section: '', sex: '', progress: pr, scores: sc, badges: {}, points: {}, locks: {}, lastUpdated: '' };
}

function handleGetAllStudentsAggregated(body) {
  requireTeacherToken(body.token);
  const byLrn = {};

  // 1) Masterlist = pangunahing pinagmulan
  const mSheet = getSheet_(SHEET_MASTERLIST);
  const mLast = mSheet.getLastRow();
  if (mLast >= 2) {
    const mData = mSheet.getRange(2, 1, mLast - 1, MASTERLIST_HEADERS.length).getValues();
    mData.forEach((row) => {
      const rec = rowToMasterRecord(row);
      if (!rec.LRN) return;
      const e = byLrn[rec.LRN] || (byLrn[rec.LRN] = emptyStudent_(rec.LRN));
      e.lastName = rec.LastName || e.lastName; e.firstName = rec.FirstName || e.firstName;
      e.middleName = rec.MiddleName || e.middleName; e.gradeLevel = rec.GradeLevel || e.gradeLevel;
      e.section = rec.Section || e.section; e.sex = rec.Sex || e.sex;
      e.progress = mergeProgress(e.progress, rec.ProgressObj);
      e.scores = mergeScores(e.scores, rec.ScoresObj);
      e.badges = mergeBadges(e.badges, rec.BadgesObj);
      e.points = mergePoints(e.points, rec.PointsObj);
      e.locks = mergeLocks(e.locks, rec.LocksObj);
      const lu = rec.UpdatedAt || rec.LastUpdated;
      if (lu > e.lastUpdated) e.lastUpdated = lu;
    });
  }

  // 2) Records = safety-net (para sa mga score na hindi umabot sa Masterlist) + breakdown + tombstones
  const rSheet = getSheet_(SHEET_NAME_RECORDS);
  const rLast = rSheet.getLastRow();
  const recBreakdown = {}, tombs = {};
  if (rLast >= 2) {
    const rData = rSheet.getRange(2, 1, rLast - 1, RECORD_HEADERS.length).getValues();
    rData.forEach((row) => {
      const r = rowToRecord(row);
      if (!r.LRN) return;
      const subj = String(r.Subject || '').toLowerCase();
      const typeUp = String(r.Type || '').toUpperCase();
      const e = byLrn[r.LRN] || (byLrn[r.LRN] = emptyStudent_(r.LRN));
      if (!e.lastName && r.LastName) { e.lastName = r.LastName; e.firstName = r.FirstName || ''; e.middleName = r.MiddleName || ''; e.gradeLevel = r.GradeLevel || ''; e.section = r.Section || ''; }
      const ts = toIso_(r.Timestamp) || toIso_(r.LastUpdated);

      if (typeUp === 'PROGRESS') {          // lumang progress rows (v4 pababa)
        const pl = parseJson_(r.PayloadJSON, null);
        if (pl && pl.progress) e.progress = mergeProgress(e.progress, pl.progress);
        return;
      }
      if (SUBJECTS.indexOf(subj) < 0) return;
      const aid = String(r.AssessmentId || '');
      const keyType = scoreKeyType_(aid, typeUp);
      if (!keyType || !aid) return;
      const pl = parseJson_(r.PayloadJSON, {});
      const key = r.LRN + '|' + subj + '|' + keyType + '|' + aid;

      if (pl.removed) {
        if (!tombs[key] || ts > tombs[key]) tombs[key] = ts;
        return;
      }
      const entry = {
        score: r.Score === '' ? null : Number(r.Score), total: r.Total === '' ? null : Number(r.Total),
        percent: r.Percent === '' ? null : Number(r.Percent),
        passed: String(r.Passed).toUpperCase() === 'TRUE', timestamp: ts,
        breakdown: Array.isArray(pl.breakdown) ? pl.breakdown : []
      };
      if (pl.override) entry.override = pl.override;
      if (Array.isArray(pl.breakdown) && pl.breakdown.length) recBreakdown[key + '|' + ts] = pl.breakdown;
      if (!e.scores[subj]) e.scores[subj] = { quizzes: {}, st: {}, pt: {}, te: {}, activities: {} };
      if (!e.scores[subj][keyType]) e.scores[subj][keyType] = {};
      e.scores[subj][keyType][aid] = mergeEntry_(e.scores[subj][keyType][aid], entry);
    });
  }

  // 3) apply tombstones + ibalik ang breakdown na natanggal dahil sa laki ng cell
  Object.keys(tombs).forEach((key) => {
    const p = key.split('|'); const e = byLrn[p[0]]; if (!e) return;
    const cur = e.scores[p[1]] && e.scores[p[1]][p[2]] && e.scores[p[1]][p[2]][p[3]];
    if (cur && (cur.override ? (cur.override.at || '') : (cur.timestamp || '')) <= tombs[key]) delete e.scores[p[1]][p[2]][p[3]];
  });
  Object.keys(byLrn).forEach((lrn) => {
    const e = byLrn[lrn];
    SUBJECTS.forEach((subj) => {
      ['quizzes', 'st', 'te', 'pt'].forEach((t) => {
        const map = (e.scores[subj] && e.scores[subj][t]) || {};
        Object.keys(map).forEach((aid) => {
          const en = map[aid];
          if (en && (!Array.isArray(en.breakdown) || !en.breakdown.length)) {
            const b = recBreakdown[lrn + '|' + subj + '|' + t + '|' + aid + '|' + en.timestamp];
            if (b) en.breakdown = b;
          }
        });
      });
    });
  });

  const students = Object.keys(byLrn).map((lrn) => {
    const s = byLrn[lrn];
    const summary = {};
    SUBJECTS.forEach((subj) => {
      const sc = s.scores[subj] || {};
      summary[subj] = {
        quizzes: Object.keys(sc.quizzes || {}).length, sts: Object.keys(sc.st || {}).length,
        te: Object.keys(sc.te || {}).length, pts: Object.keys(sc.pt || {}).length,
        daysCompleted: ((s.progress[subj] && s.progress[subj].completed) || []).length
      };
    });
    return Object.assign({}, s, { summary });
  });
  students.sort((a, b) => String(a.lastName || '').toUpperCase().localeCompare(String(b.lastName || '').toUpperCase()));
  return { ok: true, count: students.length, students, version: VERSION, generatedAt: new Date().toISOString() };
}

function handleGetAllStudentsFromMasterlist(body) {
  requireTeacherToken(body.token);
  const sheet = getSheet_(SHEET_MASTERLIST);
  const last = sheet.getLastRow();
  const students = [];
  if (last >= 2) {
    sheet.getRange(2, 1, last - 1, MASTERLIST_HEADERS.length).getValues().forEach((row) => {
      const rec = rowToMasterRecord(row);
      if (rec.LRN) students.push(publicMaster_(rec));
    });
  }
  students.sort((a, b) => String(a.LastName || '').toUpperCase().localeCompare(String(b.LastName || '').toUpperCase()));
  return { ok: true, count: students.length, students };
}

// ============================================================
// MIGRATION (Records -> Masterlist)
// ============================================================
function lazyMigrateFromRecords(lrn) {
  const recSheet = getSheet_(SHEET_NAME_RECORDS);
  const last = recSheet.getLastRow();
  if (last < 2) return null;
  const recData = recSheet.getRange(2, 1, last - 1, RECORD_HEADERS.length).getValues();
  let base = null, progress = {}, scores = {};
  recData.forEach((row) => {
    const r = rowToRecord(row);
    if (r.LRN !== lrn) return;
    const ts = toIso_(r.Timestamp) || new Date().toISOString();
    if (!base) base = { lastName: r.LastName || '', firstName: r.FirstName || '', middleName: r.MiddleName || '', gradeLevel: r.GradeLevel || '', section: r.Section || '' };
    const typeUp = String(r.Type || '').toUpperCase();
    if (typeUp === 'PROGRESS') {
      const pl = parseJson_(r.PayloadJSON, null);
      if (pl && pl.progress) progress = mergeProgress(progress, pl.progress);
      return;
    }
    const subj = String(r.Subject || '').toLowerCase();
    if (SUBJECTS.indexOf(subj) < 0) return;
    const aid = String(r.AssessmentId || '');
    const keyType = scoreKeyType_(aid, typeUp);
    if (!keyType) return;
    const pl = parseJson_(r.PayloadJSON, {});
    if (pl.removed) return;
    const entry = {
      score: r.Score === '' ? null : Number(r.Score), total: r.Total === '' ? null : Number(r.Total),
      percent: r.Percent === '' ? null : Number(r.Percent), passed: String(r.Passed).toUpperCase() === 'TRUE',
      timestamp: ts, breakdown: Array.isArray(pl.breakdown) ? pl.breakdown : []
    };
    if (pl.override) entry.override = pl.override;
    const patch = {}; patch[subj] = {}; patch[subj][keyType] = {}; patch[subj][keyType][aid] = entry;
    scores = mergeScores(scores, patch);
  });
  if (!base) return null;
  upsertMaster_(lrn, { student: base, progress: progress, scores: scores });
  const sheet = getSheet_(SHEET_MASTERLIST);
  return readMasterAt_(sheet, findMasterRow_(sheet, lrn));
}

function handleMigrateAllToMasterlist(body) {
  requireTeacherToken(body.token);
  const recSheet = getSheet_(SHEET_NAME_RECORDS);
  const last = recSheet.getLastRow();
  const lrns = {};
  if (last >= 2) recSheet.getRange(2, 1, last - 1, 1).getValues().forEach((r) => { const l = normalizeLRN(r[0]); if (l) lrns[l] = true; });
  let migrated = 0;
  Object.keys(lrns).forEach((lrn) => { if (lazyMigrateFromRecords(lrn)) migrated++; });
  return { ok: true, migrated, message: 'Successfully migrated ' + migrated + ' students.' };
}

function RUN_MIGRATION() {
  const r = withLock_(() => handleMigrateAllToMasterlist({ token: getTeacherSecret() }));
  console.log('🎉 TAPOS NA! ' + JSON.stringify(r));
}

/** Pinagsasama (merge) ang dobleng LRN rows sa Masterlist at binubura ang sobra. */
function CLEAN_DUPLICATES() {
  const result = withLock_(() => {
    const sheet = getSheet_(SHEET_MASTERLIST);
    const last = sheet.getLastRow();
    if (last < 3) return { ok: true, removed: 0 };
    const data = sheet.getRange(2, 1, last - 1, MASTERLIST_HEADERS.length).getValues();
    const groups = {};
    data.forEach((row, i) => {
      const rec = rowToMasterRecord(row);
      if (!rec.LRN) return;
      (groups[rec.LRN] = groups[rec.LRN] || []).push({ rec, rowNum: i + 2 });
    });
    const toDelete = [];
    Object.keys(groups).forEach((lrn) => {
      const g = groups[lrn];
      if (g.length < 2) return;
      g.sort((a, b) => (a.rec.UpdatedAt || '') < (b.rec.UpdatedAt || '') ? 1 : -1);
      const keep = g[0];
      let progress = keep.rec.ProgressObj, scores = keep.rec.ScoresObj, badges = keep.rec.BadgesObj, points = keep.rec.PointsObj, locks = keep.rec.LocksObj;
      g.slice(1).forEach((d) => {
        progress = mergeProgress(progress, d.rec.ProgressObj);
        scores = mergeScores(scores, d.rec.ScoresObj);
        badges = mergeBadges(badges, d.rec.BadgesObj);
        points = mergePoints(points, d.rec.PointsObj);
        locks = mergeLocks(locks, d.rec.LocksObj);
        toDelete.push(d.rowNum);
      });
      const r = sheet.getRange(keep.rowNum, 8, 1, 4);
      r.setNumberFormat('@');
      r.setValues([[safeJson_(progress, 'Progress', lrn), safeJson_(scores, 'Scores', lrn), safeJson_(badges, 'Badges', lrn), safeJson_(locks, 'Locks', lrn)]]);
      sheet.getRange(keep.rowNum, 17).setValue(safeJson_(points, 'Points', lrn));
    });
    toDelete.sort((a, b) => b - a).forEach((n) => sheet.deleteRow(n));
    return { ok: true, removed: toDelete.length };
  });
  console.log('🧹 TAPOS! ' + JSON.stringify(result));
  return result;
}

// ============================================================
// SYNC CODES + RETAKE REQUESTS  (legacy — walang pagbabago sa behavior)
// ============================================================
function handleRegisterSyncCode(body) {
  const { code, lrn, payload, signature } = body;
  if (!code || !lrn) throw new Error('Missing code or LRN');
  const sheet = getSheet_(SHEET_NAME_CODES);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) { if (data[i][0] === code) sheet.deleteRow(i + 1); }
  sheet.appendRow([code, normalizeLRN(lrn), JSON.stringify(payload), signature || '', now.toISOString(), expiresAt.toISOString(), 'FALSE']);
  logEvent('registerSyncCode', lrn, code);
  return { ok: true, code, expiresAt: expiresAt.toISOString() };
}

function handleResolveSyncCode(body, markUsed) {
  const code = (body.code || '').toUpperCase().trim();
  if (!code) throw new Error('Missing code');
  const sheet = getSheet_(SHEET_NAME_CODES);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toUpperCase() === code) {
      const expiresAt = new Date(data[i][5]);
      if (expiresAt < new Date()) return { ok: false, error: 'Code expired' };
      if (markUsed) sheet.getRange(i + 1, 7).setValue('TRUE');
      return { ok: true, code, lrn: normalizeLRN(data[i][1]), payload: JSON.parse(data[i][2]), signature: data[i][3], createdAt: toIso_(data[i][4]) };
    }
  }
  return { ok: false, error: 'Code not found' };
}

function handleRequestRetake(body) {
  const { lrn, student, assessmentId, reason, score, total } = body;
  if (!lrn || !assessmentId) return { ok: false, error: 'Missing lrn or assessmentId' };
  const sheet = getSheet_(SHEET_NAME_REQUESTS);
  const retakesDone = countRetakesFor(sheet, normalizeLRN(lrn), assessmentId);
  if (retakesDone >= MAX_RETAKES) return { ok: false, error: 'MAX_RETAKES_REACHED', message: 'Maximum of ' + MAX_RETAKES + ' retakes already used', retakesDone, maxRetakes: MAX_RETAKES };
  const data = sheet.getDataRange().getValues();
  const nextRetakeNumber = retakesDone + 1;
  const isFinalAttempt = nextRetakeNumber >= MAX_RETAKES;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (normalizeLRN(row[1]) === normalizeLRN(lrn) && String(row[4]) === String(assessmentId) && (String(row[9]) === 'pending' || String(row[9]) === 'approved')) {
      return { ok: true, existing: true, requestId: row[0], status: row[9], retakeNumber: Number(row[14]) || 0, unlockCode: row[9] === 'approved' ? row[10] : null, message: 'Existing request found' };
    }
  }
  const requestId = 'REQ-' + normalizeLRN(lrn) + '-' + Date.now();
  const studentName = (((student && student.lastName) || '') + ', ' + ((student && student.firstName) || '')).replace(/^, |, $/g, '');
  const section = (student && student.section) || '';
  const now = new Date().toISOString();
  sheet.appendRow([requestId, normalizeLRN(lrn), studentName, section, assessmentId, reason || 'failed-attempt', score || 0, total || 0, now, 'pending', '', '', '', '', nextRetakeNumber, isFinalAttempt ? 'TRUE' : 'FALSE']);
  logEvent('requestRetake', lrn, assessmentId + ' (retake #' + nextRetakeNumber + ')');
  return { ok: true, requestId, requestedAt: now, retakeNumber: nextRetakeNumber, isFinalAttempt, maxRetakes: MAX_RETAKES, message: 'Request created' };
}

function handleGetStudentRequests(body) {
  const lrn = normalizeLRN(body.lrn);
  if (!lrn) return { ok: false, error: 'Missing lrn' };
  const sheet = getSheet_(SHEET_NAME_REQUESTS);
  const data = sheet.getDataRange().getValues();
  const records = [];
  for (let i = 1; i < data.length; i++) {
    if (normalizeLRN(data[i][1]) !== lrn) continue;
    const row = data[i];
    records.push({ requestId: row[0], lrn: normalizeLRN(row[1]), assessmentId: row[4], requestedAt: toIso_(row[8]), status: row[9], unlockCode: row[10] || null, codeGeneratedAt: toIso_(row[11]) || null, codeExpiresAt: toIso_(row[12]) || null, appliedAt: toIso_(row[13]) || null, retakeNumber: Number(row[14]) || 0, isFinalAttempt: String(row[15]).toUpperCase() === 'TRUE' });
  }
  return { ok: true, count: records.length, records };
}

function handleGetUnlockRequests(body) {
  requireTeacherToken(body.token);
  const filter = body.filter || 'all';
  const sheet = getSheet_(SHEET_NAME_REQUESTS);
  const data = sheet.getDataRange().getValues();
  const records = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const aid = String(row[4]);
    if (filter !== 'all' && !aid.startsWith(filter)) continue;
    records.push({ requestId: row[0], lrn: normalizeLRN(row[1]), studentName: row[2], section: row[3], assessmentId: aid, reason: row[5], score: Number(row[6]) || 0, total: Number(row[7]) || 0, requestedAt: toIso_(row[8]), status: row[9], unlockCode: row[10] || null, codeGeneratedAt: toIso_(row[11]) || null, codeExpiresAt: toIso_(row[12]) || null, appliedAt: toIso_(row[13]) || null, retakeNumber: Number(row[14]) || 0, isFinalAttempt: String(row[15]).toUpperCase() === 'TRUE' });
  }
  records.sort((a, b) => (a.status === 'pending' && b.status !== 'pending') ? -1 : (b.status === 'pending' && a.status !== 'pending') ? 1 : new Date(b.requestedAt) - new Date(a.requestedAt));
  return { ok: true, count: records.length, records };
}

function handleApproveRetake(body) {
  requireTeacherToken(body.token);
  const requestId = String(body.requestId || '');
  if (!requestId) return { ok: false, error: 'Missing requestId' };
  const sheet = getSheet_(SHEET_NAME_REQUESTS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === requestId) {
      if (String(data[i][9]) === 'applied') return { ok: false, error: 'Request already applied' };
      if (String(data[i][9]) === 'cancelled') return { ok: false, error: 'Request was cancelled' };
      const code = generateUniqueCode(sheet);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      sheet.getRange(i + 1, 10, 1, 4).setValues([['approved', code, now.toISOString(), expiresAt.toISOString()]]);
      logEvent('approveRetake', data[i][1], requestId + ' → ' + code);
      return { ok: true, requestId, unlockCode: code, codeGeneratedAt: now.toISOString(), codeExpiresAt: expiresAt.toISOString(), message: 'Code generated' };
    }
  }
  return { ok: false, error: 'Request not found' };
}

function handleCancelRequest(body) {
  requireTeacherToken(body.token);
  const requestId = String(body.requestId || '');
  if (!requestId) return { ok: false, error: 'Missing requestId' };
  const sheet = getSheet_(SHEET_NAME_REQUESTS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === requestId) {
      if (String(data[i][9]) === 'applied') return { ok: false, error: 'Cannot cancel — already applied' };
      sheet.getRange(i + 1, 10).setValue('cancelled');
      logEvent('cancelRequest', data[i][1], requestId);
      return { ok: true, requestId, message: 'Request cancelled' };
    }
  }
  return { ok: false, error: 'Request not found' };
}

function handleRedeemUnlockCode(body) {
  const lrn = normalizeLRN(body.lrn);
  const code = String(body.code || '').toUpperCase().trim();
  if (!lrn || !code) return { ok: false, error: 'Missing lrn or code' };
  const sheet = getSheet_(SHEET_NAME_REQUESTS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[10]).toUpperCase() !== code) continue;
    if (normalizeLRN(row[1]) !== lrn) continue;
    const status = String(row[9]);
    if (status === 'applied') return { ok: false, error: 'Code already used' };
    if (status === 'cancelled') return { ok: false, error: 'Code was cancelled' };
    if (status !== 'approved') return { ok: false, error: 'Code not yet approved' };
    const expiresAt = row[12] ? new Date(row[12]) : null;
    if (expiresAt && expiresAt < new Date()) return { ok: false, error: 'Code expired' };
    const now = new Date().toISOString();
    sheet.getRange(i + 1, 10).setValue('applied');
    sheet.getRange(i + 1, 14).setValue(now);
    logEvent('redeemUnlockCode', lrn, code + ' → ' + row[4]);
    return { ok: true, requestId: row[0], assessmentId: row[4], appliedAt: now, retakeNumber: Number(row[14]) || 0, isFinalAttempt: String(row[15]).toUpperCase() === 'TRUE', message: 'Unlock applied' };
  }
  return { ok: false, error: 'Code not found or not linked to this student' };
}

function generateUniqueCode(sheet) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const data = sheet.getDataRange().getValues();
  const existing = new Set();
  for (let i = 1; i < data.length; i++) { if (data[i][10]) existing.add(String(data[i][10]).toUpperCase()); }
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = 'RTK-';
    for (let k = 0; k < 8; k++) { code += chars.charAt(Math.floor(Math.random() * chars.length)); if (k === 3) code += '-'; }
    if (!existing.has(code)) return code;
  }
  throw new Error('Could not generate unique code');
}

function countRetakesFor(sheet, lrn, assessmentId) {
  const data = sheet.getDataRange().getValues();
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (normalizeLRN(row[1]) !== normalizeLRN(lrn)) continue;
    if (String(row[4]) !== String(assessmentId)) continue;
    if (['approved', 'applied'].includes(String(row[9]))) count++;
  }
  return count;
}
