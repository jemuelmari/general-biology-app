/**
 * ============================================================
 * Google Apps Script Backend — General Biology App
 * File: Code.gs
 * Version: 1.0.0
 *
 * Purpose:
 *   - Receive student data (scores, progress, remediation) from the
 *     student web app via POST.
 *   - Return stored student records via GET.
 *   - Support cross-device sync between students and teachers.
 *   - Resolve Sync Codes → payloads.
 *
 * Deployment:
 *   1. Create a Google Sheet (any name).
 *   2. Extensions → Apps Script → paste this file.
 *   3. Deploy → New deployment → Web app.
 *        Execute as: Me
 *        Who has access: Anyone
 *   4. Copy the Web App URL into assets/js/store.js (BACKEND_URL).
 * ============================================================
 */

/* ---------- Configuration ---------- */
const SHEET_NAME_RECORDS = 'Records';
const SHEET_NAME_CODES   = 'SyncCodes';
const SHEET_NAME_LOG     = 'SyncLog';

const RECORD_HEADERS = [
  'LRN', 'LastName', 'FirstName', 'MiddleName', 'GradeLevel', 'Section',
  'Subject', 'Type', 'AssessmentId', 'Score', 'Total', 'Percent',
  'Passed', 'AutoSubmitted', 'TabViolations', 'Timestamp',
  'PayloadJSON', 'Signature', 'LastUpdated'
];

const CODE_HEADERS = [
  'Code', 'LRN', 'PayloadJSON', 'Signature', 'CreatedAt', 'ExpiresAt', 'Used'
];

const LOG_HEADERS = [
  'Timestamp', 'Action', 'LRN', 'Details'
];

/* ---------- Web App Entry Points ---------- */

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    switch (action) {
      case 'saveProgress':
        return jsonResponse(handleSaveProgress(body));
      case 'saveScore':
        return jsonResponse(handleSaveScore(body));
      case 'registerSyncCode':
        return jsonResponse(handleRegisterSyncCode(body));
      case 'resolveSyncCode':
        return jsonResponse(handleResolveSyncCode(body));
      case 'getStudent':
        return jsonResponse(handleGetStudent(body));
      case 'getAllStudents':
        return jsonResponse(handleGetAllStudents(body));
      case 'ping':
        return jsonResponse({ ok: true, message: 'Backend is live', timestamp: new Date().toISOString() });
      default:
        return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    logEvent('ERROR', '', 'doPost error: ' + err.message);
    return jsonResponse({ ok: false, error: err.message });
  }
}

function doGet(e) {
  const action = e.parameter.action || 'ping';

  switch (action) {
    case 'ping':
      return jsonResponse({ ok: true, message: 'Backend is live', timestamp: new Date().toISOString() });
    case 'resolveSyncCode':
      return jsonResponse(handleResolveSyncCode({ code: e.parameter.code }));
    case 'getStudent':
      return jsonResponse(handleGetStudent({ lrn: e.parameter.lrn }));
    case 'getAllStudents':
      return jsonResponse(handleGetAllStudents({}));
    default:
      return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
  }
}

/* ---------- Handlers ---------- */

function handleSaveProgress(body) {
  const { lrn, student, progress, subject } = body;
  if (!lrn) throw new Error('Missing LRN');

  const sheet = getOrCreateSheet(SHEET_NAME_RECORDS, RECORD_HEADERS);
  const payload = JSON.stringify({ progress, subject });
  const now = new Date().toISOString();

  // Append one row per save. Latest wins on read.
  sheet.appendRow([
    lrn,
    student?.lastName || '',
    student?.firstName || '',
    student?.middleName || '',
    student?.gradeLevel || '',
    student?.section || '',
    subject || 'both',
    'PROGRESS',
    'progress',
    '', '', '',
    '', '', '',
    now,
    payload,
    '',
    now
  ]);

  logEvent('saveProgress', lrn, 'Subject: ' + (subject || 'both'));
  return { ok: true, message: 'Progress saved', lrn };
}

function handleSaveScore(body) {
  const { lrn, student, subject, type, assessmentId, score, total, percent, passed, autoSubmitted, tabViolations, breakdown, timestamp } = body;
  if (!lrn || !assessmentId) throw new Error('Missing LRN or AssessmentId');

  const sheet = getOrCreateSheet(SHEET_NAME_RECORDS, RECORD_HEADERS);
  const now = new Date().toISOString();
  const payload = JSON.stringify({ breakdown: breakdown || [] });

  sheet.appendRow([
    lrn,
    student?.lastName || '',
    student?.firstName || '',
    student?.middleName || '',
    student?.gradeLevel || '',
    student?.section || '',
    subject || '',
    (type || 'quiz').toUpperCase(),
    assessmentId,
    score ?? '',
    total ?? '',
    percent ?? '',
    passed ? 'TRUE' : 'FALSE',
    autoSubmitted ? 'TRUE' : 'FALSE',
    tabViolations ?? 0,
    timestamp || now,
    payload,
    '',
    now
  ]);

  logEvent('saveScore', lrn, assessmentId + ' = ' + score + '/' + total);
  return { ok: true, message: 'Score saved', lrn, assessmentId };
}

function handleRegisterSyncCode(body) {
  const { code, lrn, payload, signature } = body;
  if (!code || !lrn) throw new Error('Missing code or LRN');

  const sheet = getOrCreateSheet(SHEET_NAME_CODES, CODE_HEADERS);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  // Remove previous entries with same code (re-register)
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === code) sheet.deleteRow(i + 1);
  }

  sheet.appendRow([
    code,
    lrn,
    JSON.stringify(payload),
    signature || '',
    now.toISOString(),
    expiresAt.toISOString(),
    'FALSE'
  ]);

  logEvent('registerSyncCode', lrn, code);
  return { ok: true, code, expiresAt: expiresAt.toISOString() };
}

function handleResolveSyncCode(body) {
  const code = (body.code || '').toUpperCase().trim();
  if (!code) throw new Error('Missing code');

  const sheet = getOrCreateSheet(SHEET_NAME_CODES, CODE_HEADERS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toUpperCase() === code) {
      const expiresAt = new Date(data[i][5]);
      if (expiresAt < new Date()) {
        return { ok: false, error: 'Code expired' };
      }

      // Mark as used
      sheet.getRange(i + 1, 7).setValue('TRUE');

      return {
        ok: true,
        code,
        lrn: data[i][1],
        payload: JSON.parse(data[i][2]),
        signature: data[i][3],
        createdAt: data[i][4]
      };
    }
  }

  return { ok: false, error: 'Code not found' };
}

function handleGetStudent(body) {
  const lrn = body.lrn;
  if (!lrn) throw new Error('Missing LRN');

  const sheet = getOrCreateSheet(SHEET_NAME_RECORDS, RECORD_HEADERS);
  const data = sheet.getDataRange().getValues();
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(lrn)) {
      rows.push(rowToObject(data[i]));
    }
  }

  return { ok: true, lrn, count: rows.length, records: rows };
}

function handleGetAllStudents() {
  const sheet = getOrCreateSheet(SHEET_NAME_RECORDS, RECORD_HEADERS);
  const data = sheet.getDataRange().getValues();
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    rows.push(rowToObject(data[i]));
  }

  return { ok: true, count: rows.length, records: rows };
}

/* ---------- Utilities ---------- */

function rowToObject(row) {
  const o = {};
  RECORD_HEADERS.forEach((h, i) => (o[h] = row[i]));
  return o;
}

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#e6f4ea');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function logEvent(action, lrn, details) {
  try {
    const sheet = getOrCreateSheet(SHEET_NAME_LOG, LOG_HEADERS);
    sheet.appendRow([new Date().toISOString(), action, lrn || '', details || '']);
  } catch (e) {
    // Silent
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Test Function (run manually in Apps Script) ---------- */
function testBackend() {
  const result = handleSaveProgress({
    lrn: '123456789012',
    student: { lastName: 'Dela Cruz', firstName: 'Juan', gradeLevel: '12', section: 'GAS' },
    subject: 'biol1',
    progress: { completed: ['biol1-w1-d1'], weeks: {} }
  });
  Logger.log(JSON.stringify(result, null, 2));
}