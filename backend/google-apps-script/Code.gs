/**
 * ============================================================
 * Google Apps Script Backend — General Biology App
 * File: Code.gs
 * Version: 4.0.1 (Failproof, Type-Safe, Secure + sync hardening)
 * ============================================================
 */

const SHEET_MASTERLIST = 'StudentsMasterlist';
const SHEET_NAME_RECORDS  = 'Records';
const SHEET_NAME_CODES    = 'SyncCodes';
const SHEET_NAME_LOG      = 'SyncLog';
const SHEET_NAME_REQUESTS = 'UnlockRequests';

const CODE_EXPIRY_DAYS = 7;
const MAX_RETAKES = 2;
const RATE_LIMIT_PER_MIN = 60;

const MASTERLIST_HEADERS = [
  'LRN', 'LastName', 'FirstName', 'MiddleName', 'GradeLevel', 'Section', 'Sex',
  'ProgressJSON', 'ScoresJSON', 'BadgesJSON', 'LocksJSON',
  'LastUpdated', 'CreatedAt', 'UpdatedAt', 'IntegrityHash', 'DeviceId'
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

// --- UTILITIES ---
function normalizeLRN(lrn) {
  if (lrn === null || lrn === undefined) return '';
  let s = String(lrn).trim();
  if (s.endsWith('.0')) s = s.slice(0, -2);
  const digits = s.replace(/\D/g, '');
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

function rowToMasterRecord(row) {
  const o = {};
  MASTERLIST_HEADERS.forEach((h, i) => (o[h] = row[i]));
  o.LRN = normalizeLRN(o.LRN);
  try { o.ProgressObj = JSON.parse(o.ProgressJSON || '{}'); } catch (e) { o.ProgressObj = {}; }
  try { o.ScoresObj = JSON.parse(o.ScoresJSON || '{}'); } catch (e) { o.ScoresObj = {}; }
  try { o.BadgesObj = JSON.parse(o.BadgesJSON || '{}'); } catch (e) { o.BadgesObj = {}; }
  try { o.LocksObj = JSON.parse(o.LocksJSON || '{}'); } catch (e) { o.LocksObj = {}; }
  if (o.LastUpdated instanceof Date) o.LastUpdated = o.LastUpdated.toISOString();
  if (o.CreatedAt instanceof Date) o.CreatedAt = o.CreatedAt.toISOString();
  if (o.UpdatedAt instanceof Date) o.UpdatedAt = o.UpdatedAt.toISOString();
  return o;
}

function rowToRecord(row) {
  const o = {};
  RECORD_HEADERS.forEach((h, i) => (o[h] = row[i]));
  o.LRN = normalizeLRN(o.LRN);
  return o;
}

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e6f4ea');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function logEvent(action, lrn, details) {
  try {
    const sheet = getOrCreateSheet(SHEET_NAME_LOG, LOG_HEADERS);
    sheet.appendRow([new Date().toISOString(), action, lrn || '', details || '']);
  } catch (e) { /* silent */ }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkRateLimit(lrn) {
  const cache = CacheService.getScriptCache();
  const key = 'rate_' + lrn;
  const count = Number(cache.get(key) || 0);
  if (count >= RATE_LIMIT_PER_MIN) throw new Error('ERR_RATE_LIMITED: Please wait a minute');
  cache.put(key, count + 1, 60);
}

// --- ENTRY POINTS ---
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const lrn = body.lrn ? normalizeLRN(body.lrn) : null;
    if (lrn && ['saveProgress', 'saveScore', 'upsertStudentMaster', 'getStudentByLRN'].includes(body.action)) {
      checkRateLimit(lrn);
    }
    const action = body.action;

    switch (action) {
      case 'saveProgress':            return jsonResponse(handleSaveProgress(body));
      case 'saveScore':               return jsonResponse(handleSaveScore(body));
      case 'getAllStudentsAggregated': return jsonResponse(handleGetAllStudentsAggregated(body));
      case 'getStudentByLRN':         return jsonResponse(handleGetStudentByLRN(body));
      case 'upsertStudentMaster':     return jsonResponse(handleUpsertStudentMaster(body));
      case 'registerSyncCode':        return jsonResponse(handleRegisterSyncCode(body));
      case 'resolveSyncCode':         return jsonResponse(handleResolveSyncCode(body, false));
      case 'consumeSyncCode':         return jsonResponse(handleResolveSyncCode(body, true));
      case 'requestRetake':           return jsonResponse(handleRequestRetake(body));
      case 'getStudentRequests':      return jsonResponse(handleGetStudentRequests(body));
      case 'getUnlockRequests':       return jsonResponse(handleGetUnlockRequests(body));
      case 'approveRetake':           return jsonResponse(handleApproveRetake(body));
      case 'cancelRequest':           return jsonResponse(handleCancelRequest(body));
      case 'redeemUnlockCode':        return jsonResponse(handleRedeemUnlockCode(body));
      case 'getAllStudentsFromMasterlist': return jsonResponse(handleGetAllStudentsFromMasterlist(body));
      case 'migrateAllToMasterlist':  return jsonResponse(handleMigrateAllToMasterlist(body));
      case 'ping':                    return jsonResponse({ ok: true, message: 'Backend is live', version: '4.0.1', timestamp: new Date().toISOString() });
      default:                        return jsonResponse({ ok: false, error: 'ERR_UNKNOWN_ACTION: ' + action, code: 'UNKNOWN_ACTION' });
    }
  } catch (err) {
    logEvent('ERROR', '', 'doPost error: ' + err.message);
    return jsonResponse({ ok: false, error: err.message, code: err.message.split(':')[0] || 'SERVER_ERROR' });
  }
}

function doGet(e) {
  const action = e.parameter.action || 'ping';
  switch (action) {
    case 'ping': return jsonResponse({ ok: true, message: 'Backend is live', version: '4.0.1', timestamp: new Date().toISOString() });
    case 'resolveSyncCode': return jsonResponse(handleResolveSyncCode({ code: e.parameter.code }, false));
    case 'getAllStudentsAggregated': return jsonResponse(handleGetAllStudentsAggregated({ token: e.parameter.token }));
    default: return jsonResponse({ ok: false, error: 'ERR_UNKNOWN_ACTION', code: 'UNKNOWN_ACTION' });
  }
}

// --- CORE HANDLERS ---
function handleGetStudentByLRN(body) {
  const lrn = normalizeLRN(body.lrn);
  if (!lrn || lrn.length !== 12) return { ok: false, error: 'ERR_BAD_LRN: Missing or invalid LRN', code: 'BAD_LRN' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getOrCreateSheet(SHEET_MASTERLIST, MASTERLIST_HEADERS);
    const textFinder = sheet.createTextFinder(lrn).matchEntireCell(true).findAll();
    if (textFinder.length > 0) {
      const row = textFinder[0].getRow();
      const data = sheet.getRange(row, 1, 1, MASTERLIST_HEADERS.length).getValues()[0];
      return { ok: true, student: rowToMasterRecord(data) };
    }
    const migrated = lazyMigrateFromRecords(lrn);
    if (migrated) return { ok: true, student: migrated, migrated: true };
    return { ok: false, error: 'ERR_NOT_FOUND: Student not found', code: 'NOT_FOUND' };
  } catch (e) {
    if (e.message.includes('timeout')) return { ok: false, error: 'ERR_BUSY: Server busy', code: 'BUSY' };
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function handleUpsertStudentMaster(body) {
  const lrn = normalizeLRN(body.lrn);
  if (!lrn || lrn.length !== 12) return { ok: false, error: 'ERR_BAD_LRN', code: 'BAD_LRN' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getOrCreateSheet(SHEET_MASTERLIST, MASTERLIST_HEADERS);
    const data = sheet.getDataRange().getValues();
    let rowIndex = -1, existingData = null;

    for (let i = 1; i < data.length; i++) {
      if (normalizeLRN(data[i][0]) === lrn) {
        rowIndex = i + 1;
        existingData = rowToMasterRecord(data[i]);
        break;
      }
    }

    const now = new Date().toISOString();
    const { student, progress, scores, badges, locks, deviceId, integrityHash } = body;

    if (existingData) {
      const mergedProgress = mergeProgress(existingData.ProgressObj, progress);
      const mergedScores = mergeScores(existingData.ScoresObj, scores);
      const mergedBadges = mergeBadges(existingData.BadgesObj, badges);
      const mergedLocks = mergeLocks(existingData.LocksObj, locks);

      // Lahat ng JSON column ay may guard na (dati scores at progress lang)
      const progressStr = safeJson_(mergedProgress, 'Progress', lrn);
      const scoresStr   = safeJson_(mergedScores, 'Scores', lrn);
      const badgesStr   = safeJson_(mergedBadges, 'Badges', lrn);
      const locksStr    = safeJson_(mergedLocks, 'Locks', lrn);

      const updatedRow = [
        lrn, student?.lastName || existingData.LastName, student?.firstName || existingData.FirstName, student?.middleName || existingData.MiddleName,
        student?.gradeLevel || existingData.GradeLevel, student?.section || existingData.Section, student?.sex || existingData.Sex,
        progressStr, scoresStr, badgesStr, locksStr,
        existingData.LastUpdated || now, existingData.CreatedAt || now, now,
        integrityHash || existingData.IntegrityHash, deviceId || existingData.DeviceId
      ];

      sheet.getRange(rowIndex, 1).setNumberFormat('@');
      sheet.getRange(rowIndex, 1, 1, MASTERLIST_HEADERS.length).setValues([updatedRow]);
      return { ok: true, message: 'Masterlist updated', merged: true };
    } else {
      const newRow = [
        lrn, student?.lastName || '', student?.firstName || '', student?.middleName || '',
        student?.gradeLevel || '', student?.section || '', student?.sex || '',
        safeJson_(progress || {}, 'Progress', lrn), safeJson_(scores || {}, 'Scores', lrn),
        safeJson_(badges || {}, 'Badges', lrn), safeJson_(locks || {}, 'Locks', lrn),
        now, now, now, integrityHash || '', deviceId || ''
      ];
      const newRowRange = sheet.getRange(sheet.getLastRow() + 1, 1, 1, MASTERLIST_HEADERS.length);
      newRowRange.setNumberFormat('@');
      newRowRange.setValues([newRow]);
      return { ok: true, message: 'Masterlist created', created: true };
    }
  } catch (e) {
    if (e.message.includes('timeout')) return { ok: false, error: 'ERR_BUSY', code: 'BUSY' };
    throw e;
  } finally {
    lock.releaseLock();
  }
}

// --- MERGE HELPERS ---
/* ===== SYNC PATCH: bagong helpers ===== */
// Cell limit = 50,000 chars. Hindi magsusulat ng putol na JSON.
function safeJson_(obj, label, lrn) {
  var s = JSON.stringify(obj);
  if (s.length <= 45000) return s;
  s = JSON.stringify(stripHeavyFields(obj));
  logEvent('WARN_OVERSIZE', lrn, label + ' stripped, len=' + s.length);
  if (s.length > 49000) throw new Error('ERR_TOO_LARGE: ' + label + ' exceeds cell limit');
  return s;
}

// Tingnan ang huling 200 rows ng Records kung nandoon na ang attempt na ito
function recordExists_(sheet, lrn, assessmentId, ts) {
  if (!ts) return false;                       // walang timestamp = hindi ma-dedupe
  var last = sheet.getLastRow();
  if (last < 2) return false;
  var start = Math.max(2, last - 199);
  var vals = sheet.getRange(start, 1, last - start + 1, 16).getValues();
  var target = Math.floor(new Date(ts).getTime() / 1000);
  if (isNaN(target)) return false;
  for (var i = vals.length - 1; i >= 0; i--) {
    var v = vals[i];
    if (normalizeLRN(v[0]) !== lrn) continue;
    if (String(v[8]) !== String(assessmentId)) continue;
    var rowTs = Math.floor(new Date(v[15]).getTime() / 1000);
    if (rowTs === target) return true;
  }
  return false;
}
/* ===== END helpers ===== */

function stripHeavyFields(obj) {
  const copy = JSON.parse(JSON.stringify(obj));
  for (const subj in copy) {
    const s = copy[subj];
    if (!s || typeof s !== 'object') continue;
    if (s.quizzes) Object.values(s.quizzes).forEach(q => { if (q) delete q.breakdown; });
    if (s.st) Object.values(s.st).forEach(q => { if (q) delete q.breakdown; });
    if (s.pt) Object.values(s.pt).forEach(q => { if (q) delete q.breakdown; });
    if (s.te) delete s.te.breakdown;
  }
  return copy;
}

function mergeProgress(existing, incoming) {
  if (!incoming) return existing || {};
  if (!existing) return incoming;
  const merged = JSON.parse(JSON.stringify(existing));
  for (const subj in incoming) {
    const inc = incoming[subj];
    if (!inc || typeof inc !== 'object') continue;          // GUARD: dating nag-crash
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

function mergeScores(existing, incoming) {
  if (!incoming) return existing || {};
  if (!existing) return incoming;
  const merged = JSON.parse(JSON.stringify(existing));
  for (const subj in incoming) {
    if (!incoming[subj] || typeof incoming[subj] !== 'object') continue;
    if (!merged[subj]) merged[subj] = {};
    for (const type in incoming[subj]) {
      if (!merged[subj][type]) merged[subj][type] = {};

      if (type === 'te') {
        const incTe = incoming[subj][type];
        if (!incTe || typeof incTe !== 'object') continue;
        const extTe = merged[subj][type];
        const hasExt = extTe && Object.keys(extTe).length > 0;
        if (!hasExt) { merged[subj][type] = incTe; continue; }
        const incTime = new Date(incTe.timestamp || 0).getTime();
        const extTime = new Date(extTe.timestamp || 0).getTime();
        if (incTime > extTime || (incTime === extTime && (incTe.score || 0) > (extTe.score || 0))) {
          merged[subj][type] = incTe;
        }
      } else {
        const incItems = incoming[subj][type] || {};
        for (const id in incItems) {
          const incItem = incItems[id], extItem = merged[subj][type][id];
          if (!incItem) continue;
          if (!extItem) merged[subj][type][id] = incItem;
          else {
            const incTime = new Date(incItem.timestamp || 0).getTime();
            const extTime = new Date(extItem.timestamp || 0).getTime();
            if (incTime > extTime || (incTime === extTime && (incItem.score || 0) > (extItem.score || 0))) {
              merged[subj][type][id] = incItem;
            }
          }
        }
      }
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

function lazyMigrateFromRecords(lrn) {
  const recSheet = getOrCreateSheet(SHEET_NAME_RECORDS, RECORD_HEADERS);
  const recData = recSheet.getDataRange().getValues();
  let studentBase = null, progress = {}, scores = {}, badges = {}, locks = {};

  for (let i = 1; i < recData.length; i++) {
    const r = rowToRecord(recData[i]);
    if (normalizeLRN(r.LRN) !== lrn) continue;
    if (!studentBase) {
      studentBase = { lastName: r.LastName || '', firstName: r.FirstName || '', middleName: r.MiddleName || '', gradeLevel: r.GradeLevel || '', section: r.Section || '', sex: '', createdAt: r.Timestamp instanceof Date ? r.Timestamp.toISOString() : (r.Timestamp || new Date().toISOString()), lastUpdated: r.Timestamp instanceof Date ? r.Timestamp.toISOString() : (r.Timestamp || new Date().toISOString()) };
    }
    const type = String(r.Type || '').toUpperCase();
    if (type === 'PROGRESS' && r.PayloadJSON) { try { const pl = JSON.parse(r.PayloadJSON); progress = mergeProgress(progress, pl.progress); } catch (e) {} }
    else if (r.Subject === 'biol1' || r.Subject === 'biol2') {
      const aid = r.AssessmentId || ''; let keyType = null;
      if (aid.indexOf('-quiz') !== -1) keyType = 'quizzes'; else if (aid.indexOf('-st') !== -1) keyType = 'st'; else if (aid.indexOf('-te') !== -1) keyType = 'te'; else if (aid.indexOf('-pt') !== -1) keyType = 'pt';
      if (keyType) {
        let breakdown = []; try { breakdown = JSON.parse(r.PayloadJSON || '{}').breakdown || []; } catch (e) {}
        const scoreData = { score: Number(r.Score) || 0, total: Number(r.Total) || 0, percent: Number(r.Percent) || 0, passed: String(r.Passed).toUpperCase() === 'TRUE', breakdown, timestamp: r.Timestamp instanceof Date ? r.Timestamp.toISOString() : (r.Timestamp || r.LastUpdated) };
        if (keyType === 'te') { scores[r.Subject] = scores[r.Subject] || {}; scores[r.Subject][keyType] = scoreData; }
        else { if (!scores[r.Subject]) scores[r.Subject] = {}; if (!scores[r.Subject][keyType]) scores[r.Subject][keyType] = {}; scores[r.Subject][keyType][aid] = scoreData; }
      }
    }
  }
  if (!studentBase) return null;
  const sheet = getOrCreateSheet(SHEET_MASTERLIST, MASTERLIST_HEADERS);
  const now = new Date().toISOString();
  const newRow = [lrn, studentBase.lastName, studentBase.firstName, studentBase.middleName, studentBase.gradeLevel, studentBase.section, studentBase.sex, JSON.stringify(progress), JSON.stringify(scores), JSON.stringify(badges), JSON.stringify(locks), studentBase.lastUpdated, studentBase.createdAt, now, '', ''];
  const newRowRange = sheet.getRange(sheet.getLastRow() + 1, 1, 1, MASTERLIST_HEADERS.length);
  newRowRange.setNumberFormat('@');
  newRowRange.setValues([newRow]);
  return { LRN: lrn, LastName: studentBase.lastName, FirstName: studentBase.firstName, MiddleName: studentBase.middleName, GradeLevel: studentBase.gradeLevel, Section: studentBase.section, Sex: studentBase.sex, ProgressObj: progress, ScoresObj: scores, BadgesObj: badges, LocksObj: locks, ProgressJSON: JSON.stringify(progress), ScoresJSON: JSON.stringify(scores), BadgesJSON: JSON.stringify(badges), LocksJSON: JSON.stringify(locks), LastUpdated: studentBase.lastUpdated, CreatedAt: studentBase.createdAt, UpdatedAt: now, IntegrityHash: '', DeviceId: '' };
}

// --- LEGACY HANDLERS (Kept from v3.0.1, normalized) ---
function handleSaveProgress(body) {
  const lrn = normalizeLRN(body.lrn);
  if (!lrn) throw new Error('Missing LRN');
  handleUpsertStudentMaster({ lrn, student: body.student, progress: body.progress, deviceId: body.deviceId, integrityHash: body.integrityHash });
  const sheet = getOrCreateSheet(SHEET_NAME_RECORDS, RECORD_HEADERS);
  const now = new Date().toISOString();
  sheet.appendRow([lrn, body.student?.lastName || '', body.student?.firstName || '', body.student?.middleName || '', body.student?.gradeLevel || '', body.student?.section || '', body.subject || 'both', 'PROGRESS', 'progress', '', '', '', '', '', '', now, JSON.stringify({ progress: body.progress, subject: body.subject }), '', now]);
  logEvent('saveProgress', lrn, 'Subject: ' + (body.subject || 'both'));
  return { ok: true, message: 'Progress saved', lrn };
}

function handleSaveScore(body) {
  const lrn = normalizeLRN(body.lrn);
  const { student, subject, type, assessmentId, score, total, percent, passed, autoSubmitted, tabViolations, breakdown, timestamp, deviceId, integrityHash } = body;
  if (!lrn || !assessmentId) throw new Error('Missing LRN or AssessmentId');
  if (typeof total === 'number' && typeof score === 'number' && score > total) return { ok: false, error: 'score cannot exceed total' };

  const currentMaster = handleGetStudentByLRN({ lrn });
  let currentScores = currentMaster.ok ? currentMaster.student.ScoresObj : {};
  if (!currentScores[subject]) currentScores[subject] = {};
  if (!currentScores[subject][type]) currentScores[subject][type] = {};
  const newScoreObj = { score: score, total: total, percent: percent, passed: passed, timestamp: timestamp || new Date().toISOString(), breakdown: breakdown || [] };
  if (type === 'te') currentScores[subject][type] = newScoreObj; else currentScores[subject][type][assessmentId] = newScoreObj;

  // Idempotent na rin ito: same timestamp = same score, kaya ligtas ulitin
  handleUpsertStudentMaster({ lrn, student, scores: currentScores, deviceId, integrityHash });

  const sheet = getOrCreateSheet(SHEET_NAME_RECORDS, RECORD_HEADERS);
  if (recordExists_(sheet, lrn, assessmentId, timestamp)) {
    return { ok: true, message: 'Score saved', lrn, assessmentId, duplicate: true };
  }
  const now = new Date().toISOString();
  sheet.appendRow([lrn, student?.lastName || '', student?.firstName || '', student?.middleName || '', student?.gradeLevel || '', student?.section || '', subject || '', (type || 'quiz').toUpperCase(), assessmentId, score ?? '', total ?? '', percent ?? '', passed ? 'TRUE' : 'FALSE', autoSubmitted ? 'TRUE' : 'FALSE', tabViolations ?? 0, timestamp || now, JSON.stringify({ breakdown: breakdown || [] }), '', now]);
  return { ok: true, message: 'Score saved', lrn, assessmentId };
}

function handleGetAllStudentsAggregated(body) {
  requireTeacherToken(body.token);
  const sheet = getOrCreateSheet(SHEET_NAME_RECORDS, RECORD_HEADERS);
  const data = sheet.getDataRange().getValues();
  const byLrn = {};
  for (let i = 1; i < data.length; i++) {
    const r = rowToRecord(data[i]);
    const lrn = r.LRN;
    if (!lrn) continue;
    if (!byLrn[lrn]) {
      byLrn[lrn] = { lrn, lastName: r.LastName || '', firstName: r.FirstName || '', middleName: r.MiddleName || '', gradeLevel: r.GradeLevel || '', section: r.Section || '', progress: { biol1: { weeks: {}, completed: [] }, biol2: { weeks: {}, completed: [] } }, scores: { biol1: { quizzes: {}, st: {}, pt: {}, te: {} }, biol2: { quizzes: {}, st: {}, pt: {}, te: {} } }, lastUpdated: r.LastUpdated || r.Timestamp || '' };
    }
    const entry = byLrn[lrn];
    const subj = String(r.Subject || '').toLowerCase();
    const type = String(r.Type || '').toUpperCase();
    if (type === 'PROGRESS' && r.PayloadJSON) {
      try {
        const pl = JSON.parse(r.PayloadJSON);
        const prog = pl.progress || {};
        ['biol1', 'biol2'].forEach((s) => {
          if (prog[s]) {
            if (prog[s].weeks) Object.keys(prog[s].weeks).forEach((wk) => { if (!entry.progress[s].weeks[wk]) entry.progress[s].weeks[wk] = {}; Object.assign(entry.progress[s].weeks[wk], prog[s].weeks[wk]); });
            if (prog[s].completed) entry.progress[s].completed = Array.from(new Set([...entry.progress[s].completed, ...prog[s].completed]));
          }
        });
      } catch (e) {}
    }
    if (subj === 'biol1' || subj === 'biol2') {
      const aid = r.AssessmentId || ''; let keyType = null;
      if (aid.indexOf('-quiz') !== -1) keyType = 'quizzes'; else if (aid.indexOf('-st') !== -1) keyType = 'st'; else if (aid.indexOf('-te') !== -1) keyType = 'te'; else if (aid.indexOf('-pt') !== -1) keyType = 'pt';
      if (keyType) {
        let breakdown = []; try { breakdown = JSON.parse(r.PayloadJSON || '{}').breakdown || []; } catch (e) {}
        const scoreData = { score: Number(r.Score) || 0, total: Number(r.Total) || 0, percent: Number(r.Percent) || 0, passed: String(r.Passed).toUpperCase() === 'TRUE', breakdown, timestamp: r.Timestamp || r.LastUpdated };
        if (keyType === 'te') entry.scores[subj][keyType] = scoreData; else entry.scores[subj][keyType][aid] = scoreData;
      }
    }
    if (r.LastUpdated && r.LastUpdated > entry.lastUpdated) entry.lastUpdated = r.LastUpdated;
  }
  const students = Object.keys(byLrn).map((lrn) => {
    const s = byLrn[lrn];
    const summary = {};
    ['biol1', 'biol2'].forEach((subj) => { summary[subj] = { quizzes: Object.keys(s.scores[subj].quizzes || {}).length, sts: Object.keys(s.scores[subj].st || {}).length, te: Object.keys(s.scores[subj].te || {}).length, pts: Object.keys(s.scores[subj].pt || {}).length, daysCompleted: (s.progress[subj].completed || []).length }; });
    return { ...s, summary };
  });
  students.sort((a, b) => String(a.lastName || '').toUpperCase().localeCompare(String(b.lastName || '').toUpperCase()));
  return { ok: true, count: students.length, students };
}

// --- OTHER LEGACY FUNCTIONS (Complete) ---
function handleRegisterSyncCode(body) {
  const { code, lrn, payload, signature } = body;
  if (!code || !lrn) throw new Error('Missing code or LRN');
  const sheet = getOrCreateSheet(SHEET_NAME_CODES, CODE_HEADERS);
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
  const sheet = getOrCreateSheet(SHEET_NAME_CODES, CODE_HEADERS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toUpperCase() === code) {
      const expiresAt = new Date(data[i][5]);
      if (expiresAt < new Date()) return { ok: false, error: 'Code expired' };
      if (markUsed) sheet.getRange(i + 1, 7).setValue('TRUE');
      return { ok: true, code, lrn: normalizeLRN(data[i][1]), payload: JSON.parse(data[i][2]), signature: data[i][3], createdAt: data[i][4] };
    }
  }
  return { ok: false, error: 'Code not found' };
}

function handleRequestRetake(body) {
  const { lrn, student, assessmentId, reason, score, total } = body;
  if (!lrn || !assessmentId) return { ok: false, error: 'Missing lrn or assessmentId' };
  const sheet = getOrCreateSheet(SHEET_NAME_REQUESTS, REQUEST_HEADERS);
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
  const requestId = 'REQ-' + lrn + '-' + Date.now();
  const studentName = ((student?.lastName || '') + ', ' + (student?.firstName || '')).replace(/^, |, $/g, '');
  const section = student?.section || '';
  const now = new Date().toISOString();
  sheet.appendRow([requestId, normalizeLRN(lrn), studentName, section, assessmentId, reason || 'failed-attempt', score || 0, total || 0, now, 'pending', '', '', '', '', nextRetakeNumber, isFinalAttempt ? 'TRUE' : 'FALSE']);
  logEvent('requestRetake', lrn, assessmentId + ' (retake #' + nextRetakeNumber + ')');
  return { ok: true, requestId, requestedAt: now, retakeNumber: nextRetakeNumber, isFinalAttempt, maxRetakes: MAX_RETAKES, message: 'Request created' };
}

function handleGetStudentRequests(body) {
  const lrn = normalizeLRN(body.lrn);
  if (!lrn) return { ok: false, error: 'Missing lrn' };
  const sheet = getOrCreateSheet(SHEET_NAME_REQUESTS, REQUEST_HEADERS);
  const data = sheet.getDataRange().getValues();
  const records = [];
  for (let i = 1; i < data.length; i++) {
    if (normalizeLRN(data[i][1]) !== lrn) continue;
    const row = data[i];
    records.push({ requestId: row[0], lrn: normalizeLRN(row[1]), assessmentId: row[4], requestedAt: row[8], status: row[9], unlockCode: row[10] || null, codeGeneratedAt: row[11] || null, codeExpiresAt: row[12] || null, appliedAt: row[13] || null, retakeNumber: Number(row[14]) || 0, isFinalAttempt: row[15] === 'TRUE' });
  }
  return { ok: true, count: records.length, records };
}

function handleGetUnlockRequests(body) {
  requireTeacherToken(body.token);
  const filter = body.filter || 'all';
  const sheet = getOrCreateSheet(SHEET_NAME_REQUESTS, REQUEST_HEADERS);
  const data = sheet.getDataRange().getValues();
  const records = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const aid = String(row[4]);
    if (filter !== 'all' && !aid.startsWith(filter)) continue;
    records.push({ requestId: row[0], lrn: normalizeLRN(row[1]), studentName: row[2], section: row[3], assessmentId: aid, reason: row[5], score: Number(row[6]) || 0, total: Number(row[7]) || 0, requestedAt: row[8], status: row[9], unlockCode: row[10] || null, codeGeneratedAt: row[11] || null, codeExpiresAt: row[12] || null, appliedAt: row[13] || null, retakeNumber: Number(row[14]) || 0, isFinalAttempt: row[15] === 'TRUE' });
  }
  records.sort((a, b) => (a.status === 'pending' && b.status !== 'pending') ? -1 : (b.status === 'pending' && a.status !== 'pending') ? 1 : new Date(b.requestedAt) - new Date(a.requestedAt));
  return { ok: true, count: records.length, records };
}

function handleApproveRetake(body) {
  requireTeacherToken(body.token);
  const requestId = String(body.requestId || '');
  if (!requestId) return { ok: false, error: 'Missing requestId' };
  const sheet = getOrCreateSheet(SHEET_NAME_REQUESTS, REQUEST_HEADERS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === requestId) {
      if (String(data[i][9]) === 'applied') return { ok: false, error: 'Request already applied' };
      if (String(data[i][9]) === 'cancelled') return { ok: false, error: 'Request was cancelled' };
      const code = generateUniqueCode(sheet);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      sheet.getRange(i + 1, 10).setValue('approved');
      sheet.getRange(i + 1, 11).setValue(code);
      sheet.getRange(i + 1, 12).setValue(now.toISOString());
      sheet.getRange(i + 1, 13).setValue(expiresAt.toISOString());
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
  const sheet = getOrCreateSheet(SHEET_NAME_REQUESTS, REQUEST_HEADERS);
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
  const sheet = getOrCreateSheet(SHEET_NAME_REQUESTS, REQUEST_HEADERS);
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
    return { ok: true, requestId: row[0], assessmentId: row[4], appliedAt: now, retakeNumber: Number(row[14]) || 0, isFinalAttempt: row[15] === 'TRUE', message: 'Unlock applied' };
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

function handleGetAllStudentsFromMasterlist(body) {
  requireTeacherToken(body.token);
  const sheet = getOrCreateSheet(SHEET_MASTERLIST, MASTERLIST_HEADERS);
  const data = sheet.getDataRange().getValues();
  const students = [];
  for (let i = 1; i < data.length; i++) students.push(rowToMasterRecord(data[i]));
  students.sort((a, b) => String(a.LastName || '').toUpperCase().localeCompare(String(b.LastName || '').toUpperCase()));
  return { ok: true, count: students.length, students };
}

function handleMigrateAllToMasterlist(body) {
  requireTeacherToken(body.token);
  const recSheet = getOrCreateSheet(SHEET_NAME_RECORDS, RECORD_HEADERS);
  const recData = recSheet.getDataRange().getValues();
  const lrns = new Set();
  for (let i = 1; i < recData.length; i++) { const r = rowToRecord(recData[i]); if (r.LRN) lrns.add(normalizeLRN(r.LRN)); }
  let migratedCount = 0;
  lrns.forEach(lrn => { if (lazyMigrateFromRecords(lrn)) migratedCount++; });
  return { ok: true, migrated: migratedCount, message: `Successfully migrated ${migratedCount} students.` };
}

function RUN_MIGRATION() {
  const recSheet = getOrCreateSheet(SHEET_NAME_RECORDS, RECORD_HEADERS);
  const recData = recSheet.getDataRange().getValues();
  const lrns = new Set();
  for (let i = 1; i < recData.length; i++) { const r = rowToRecord(recData[i]); if (r.LRN) lrns.add(normalizeLRN(r.LRN)); }
  let migratedCount = 0;
  lrns.forEach(lrn => { const res = lazyMigrateFromRecords(lrn); if (res) migratedCount++; });
  console.log('🎉 TAPOS NA PO! Matagumpay na nailipat ang ' + migratedCount + ' students sa StudentsMasterlist.');
}

function CLEAN_DUPLICATES() {
  const sheet = getOrCreateSheet(SHEET_MASTERLIST, MASTERLIST_HEADERS);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;
  const bestRecords = {};
  for (let i = 1; i < data.length; i++) {
    const lrn = normalizeLRN(data[i][0]).trim();
    const lastUpdatedStr = data[i][11];
    const updatedTime = lastUpdatedStr ? new Date(lastUpdatedStr).getTime() : 0;
    if (!bestRecords[lrn]) { bestRecords[lrn] = { rowIndex: i + 1, time: updatedTime }; }
    else {
      if (updatedTime > bestRecords[lrn].time) {
        const oldRowIndex = bestRecords[lrn].rowIndex;
        bestRecords[lrn] = { rowIndex: i + 1, time: updatedTime };
        bestRecords[lrn].deleteMe = oldRowIndex;
      } else {
        if (!bestRecords[lrn].deleteMe) bestRecords[lrn].deleteMe = [];
        if (Array.isArray(bestRecords[lrn].deleteMe)) bestRecords[lrn].deleteMe.push(i + 1);
        else bestRecords[lrn].deleteMe = [bestRecords[lrn].deleteMe, i + 1];
      }
    }
  }
  let rowsToDelete = [];
  for (const lrn in bestRecords) {
    if (bestRecords[lrn].deleteMe) {
      if (Array.isArray(bestRecords[lrn].deleteMe)) rowsToDelete = rowsToDelete.concat(bestRecords[lrn].deleteMe);
      else rowsToDelete.push(bestRecords[lrn].deleteMe);
    }
  }
  rowsToDelete.sort((a, b) => b - a);
  for (let i = 0; i < rowsToDelete.length; i++) sheet.deleteRow(rowsToDelete[i]);
  console.log('🧹 TAPOS! Nabura ang ' + rowsToDelete.length + ' lumang dobleng entries.');
}
