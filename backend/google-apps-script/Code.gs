/**
 * ============================================================
 * Google Apps Script Backend — General Biology App
 * File: Code.gs
 * Version: 1.5.0
 * ------------------------------------------------------------
 * NEW in v1.5.0:
 * - Unlock system: pushUnlock, pullUnlocks, markUnlockApplied
 * - New 'Unlocks' sheet for pending/acknowledged unlocks
 * - Teacher can push unlocks; students auto-apply on page load
 *
 * REDEPLOY: Deploy → Manage deployments → ✏️ → New version → Deploy
 * ============================================================
 */

const SHEET_NAME_RECORDS = 'Records';
const SHEET_NAME_CODES   = 'SyncCodes';
const SHEET_NAME_LOG     = 'SyncLog';
const SHEET_NAME_UNLOCKS = 'Unlocks';

const TEACHER_TOKEN_HASH = '01d58c1ac3df6d023d869e50bf78e2f9185332c281f665fd53f6dbd7592df45e';
const HMAC_SECRET = 'GB-APP-2026-DEPED-SECRET-KEY-v1';

const UNLOCK_EXPIRY_DAYS = 60;

const RECORD_HEADERS = [
  'LRN', 'LastName', 'FirstName', 'MiddleName', 'GradeLevel', 'Section',
  'Subject', 'Type', 'AssessmentId', 'Score', 'Total', 'Percent',
  'Passed', 'AutoSubmitted', 'TabViolations', 'Timestamp',
  'PayloadJSON', 'Signature', 'LastUpdated'
];

const CODE_HEADERS = [
  'Code', 'LRN', 'PayloadJSON', 'Signature', 'CreatedAt', 'ExpiresAt', 'Used'
];

const LOG_HEADERS = ['Timestamp', 'Action', 'LRN', 'Details'];

const UNLOCK_HEADERS = [
  'UnlockId', 'LRN', 'AssessmentId', 'Reason', 'PushedAt', 'Status', 'AppliedAt', 'PushedBy'
];

/* ============================================================
   ENTRY POINTS
   ============================================================ */

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    switch (action) {
      case 'saveProgress':             return jsonResponse(handleSaveProgress(body));
      case 'saveScore':                return jsonResponse(handleSaveScore(body));
      case 'registerSyncCode':         return jsonResponse(handleRegisterSyncCode(body));
      case 'resolveSyncCode':          return jsonResponse(handleResolveSyncCode(body, false));
      case 'consumeSyncCode':          return jsonResponse(handleResolveSyncCode(body, true));
      case 'getStudent':               return jsonResponse(handleGetStudent(body));
      case 'getAllStudents':           return jsonResponse(handleGetAllStudents(body));
      case 'getAllStudentsAggregated': return jsonResponse(handleGetAllStudentsAggregated(body));
      case 'pushUnlock':               return jsonResponse(handlePushUnlock(body));
      case 'pullUnlocks':              return jsonResponse(handlePullUnlocks(body));
      case 'markUnlockApplied':        return jsonResponse(handleMarkUnlockApplied(body));
      case 'getAllUnlocks':            return jsonResponse(handleGetAllUnlocks(body));
      case 'ping':                     return jsonResponse({ ok: true, message: 'Backend is live', version: '1.5.0', timestamp: new Date().toISOString() });
      default:                         return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
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
      return jsonResponse({ ok: true, message: 'Backend is live', version: '1.5.0', timestamp: new Date().toISOString() });
    case 'resolveSyncCode':
      return jsonResponse(handleResolveSyncCode({ code: e.parameter.code }, false));
    case 'getStudent':
      return jsonResponse(handleGetStudent({ lrn: e.parameter.lrn, token: e.parameter.token }));
    case 'getAllStudents':
      return jsonResponse(handleGetAllStudents({ token: e.parameter.token }));
    case 'getAllStudentsAggregated':
      return jsonResponse(handleGetAllStudentsAggregated({ token: e.parameter.token }));
    case 'pullUnlocks':
      return jsonResponse(handlePullUnlocks({ lrn: e.parameter.lrn }));
    case 'getAllUnlocks':
      return jsonResponse(handleGetAllUnlocks({ token: e.parameter.token }));
    default:
      return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
  }
}

/* ============================================================
   SCORE + PROGRESS HANDLERS
   ============================================================ */

function handleSaveProgress(body) {
  const { lrn, student, progress, subject } = body;
  if (!lrn) throw new Error('Missing LRN');

  const sheet = getOrCreateSheet(SHEET_NAME_RECORDS, RECORD_HEADERS);
  const payloadStr = JSON.stringify({ progress, subject });
  const now = new Date().toISOString();

  sheet.appendRow([
    lrn,
    student?.lastName || '', student?.firstName || '', student?.middleName || '',
    student?.gradeLevel || '', student?.section || '',
    subject || 'both', 'PROGRESS', 'progress',
    '', '', '', '', '', '',
    now, payloadStr, '', now
  ]);

  logEvent('saveProgress', lrn, 'Subject: ' + (subject || 'both'));
  return { ok: true, message: 'Progress saved', lrn };
}

function handleSaveScore(body) {
  const {
    lrn, student, subject, type, assessmentId,
    score, total, percent, passed, autoSubmitted,
    tabViolations, breakdown, timestamp
  } = body;

  if (!lrn || !assessmentId) throw new Error('Missing LRN or AssessmentId');

  logEvent('saveScore-accepted', lrn, assessmentId + ' = ' + score + '/' + total);

  if (typeof total === 'number' && typeof score === 'number' && score > total) {
    logEvent('REJECT saveScore', lrn, 'score > total');
    return { ok: false, error: 'score cannot exceed total' };
  }

  const sheet = getOrCreateSheet(SHEET_NAME_RECORDS, RECORD_HEADERS);
  const now = new Date().toISOString();
  const payloadStr = JSON.stringify({ breakdown: breakdown || [] });

  sheet.appendRow([
    lrn,
    student?.lastName || '', student?.firstName || '', student?.middleName || '',
    student?.gradeLevel || '', student?.section || '',
    subject || '', (type || 'quiz').toUpperCase(), assessmentId,
    score ?? '', total ?? '', percent ?? '',
    passed ? 'TRUE' : 'FALSE', autoSubmitted ? 'TRUE' : 'FALSE',
    tabViolations ?? 0,
    timestamp || now, payloadStr, '', now
  ]);

  return { ok: true, message: 'Score saved', lrn, assessmentId };
}

/* ============================================================
   SYNC CODE HANDLERS
   ============================================================ */

function handleRegisterSyncCode(body) {
  const { code, lrn, payload, signature } = body;
  if (!code || !lrn) throw new Error('Missing code or LRN');

  const sheet = getOrCreateSheet(SHEET_NAME_CODES, CODE_HEADERS);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === code) sheet.deleteRow(i + 1);
  }

  sheet.appendRow([
    code, lrn,
    JSON.stringify(payload),
    signature || '',
    now.toISOString(),
    expiresAt.toISOString(),
    'FALSE'
  ]);

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
      if (expiresAt < new Date()) {
        return { ok: false, error: 'Code expired' };
      }

      if (markUsed) {
        sheet.getRange(i + 1, 7).setValue('TRUE');
      }

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

/* ============================================================
   READ HANDLERS
   ============================================================ */

function handleGetStudent(body) {
  requireTeacherToken(body.token);
  const lrn = body.lrn;
  if (!lrn) throw new Error('Missing LRN');

  const sheet = getOrCreateSheet(SHEET_NAME_RECORDS, RECORD_HEADERS);
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(lrn)) rows.push(rowToObject(data[i]));
  }
  return { ok: true, lrn, count: rows.length, records: rows };
}

function handleGetAllStudents(body) {
  requireTeacherToken(body.token);

  const sheet = getOrCreateSheet(SHEET_NAME_RECORDS, RECORD_HEADERS);
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) rows.push(rowToObject(data[i]));
  return { ok: true, count: rows.length, records: rows };
}

function handleGetAllStudentsAggregated(body) {
  requireTeacherToken(body.token);

  const sheet = getOrCreateSheet(SHEET_NAME_RECORDS, RECORD_HEADERS);
  const data = sheet.getDataRange().getValues();

  const byLrn = {};

  for (let i = 1; i < data.length; i++) {
    const r = rowToObject(data[i]);
    const lrn = String(r.LRN || '');
    if (!lrn) continue;

    if (!byLrn[lrn]) {
      byLrn[lrn] = {
        lrn,
        lastName: r.LastName || '',
        firstName: r.FirstName || '',
        middleName: r.MiddleName || '',
        gradeLevel: r.GradeLevel || '',
        section: r.Section || '',
        progress: {
          biol1: { weeks: {}, completed: [] },
          biol2: { weeks: {}, completed: [] }
        },
        scores: {
          biol1: { quizzes: {}, st: {}, pt: {}, te: {} },
          biol2: { quizzes: {}, st: {}, pt: {}, te: {} }
        },
        badges: { biol1: [], biol2: [] },
        lastUpdated: r.LastUpdated || r.Timestamp || ''
      };
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
            if (prog[s].weeks) {
              Object.keys(prog[s].weeks).forEach((wk) => {
                if (!entry.progress[s].weeks[wk]) entry.progress[s].weeks[wk] = {};
                Object.assign(entry.progress[s].weeks[wk], prog[s].weeks[wk]);
              });
            }
            if (prog[s].completed) {
              const set = new Set([...entry.progress[s].completed, ...prog[s].completed]);
              entry.progress[s].completed = Array.from(set);
            }
          }
        });
      } catch (e) { /* skip bad payload */ }
    }

    if (subj === 'biol1' || subj === 'biol2') {
      const aid = r.AssessmentId || '';
      let keyType = null;
      if (aid.indexOf('-quiz') !== -1) keyType = 'quizzes';
      else if (aid.indexOf('-st') !== -1) keyType = 'st';
      else if (aid.indexOf('-te') !== -1) keyType = 'te';
      else if (aid.indexOf('-pt') !== -1) keyType = 'pt';

      if (keyType) {
        let breakdown = [];
        try { breakdown = JSON.parse(r.PayloadJSON || '{}').breakdown || []; }
        catch (e) { breakdown = []; }

        entry.scores[subj][keyType][aid] = {
          score: Number(r.Score) || 0,
          total: Number(r.Total) || 0,
          percent: Number(r.Percent) || 0,
          passed: String(r.Passed).toUpperCase() === 'TRUE',
          autoSubmitted: String(r.AutoSubmitted).toUpperCase() === 'TRUE',
          tabViolations: Number(r.TabViolations) || 0,
          breakdown,
          timestamp: r.Timestamp || r.LastUpdated
        };
      }
    }

    if (r.LastUpdated && r.LastUpdated > entry.lastUpdated) {
      entry.lastUpdated = r.LastUpdated;
    }
  }

  const students = Object.keys(byLrn).map((lrn) => {
    const s = byLrn[lrn];
    const summary = {};
    ['biol1', 'biol2'].forEach((subj) => {
      summary[subj] = {
        quizzes: Object.keys(s.scores[subj].quizzes || {}).length,
        sts: Object.keys(s.scores[subj].st || {}).length,
        te: Object.keys(s.scores[subj].te || {}).length,
        pts: Object.keys(s.scores[subj].pt || {}).length,
        daysCompleted: (s.progress[subj].completed || []).length
      };
    });
    return {
      lrn: s.lrn,
      lastName: s.lastName,
      firstName: s.firstName,
      middleName: s.middleName,
      gradeLevel: s.gradeLevel,
      section: s.section,
      progress: s.progress,
      scores: s.scores,
      badges: s.badges,
      summary,
      lastUpdated: s.lastUpdated
    };
  });

  students.sort((a, b) => {
    const aLast = String(a.lastName || '').toUpperCase();
    const bLast = String(b.lastName || '').toUpperCase();
    if (aLast !== bLast) return aLast.localeCompare(bLast);
    return String(a.firstName || '').toUpperCase().localeCompare(String(b.firstName || '').toUpperCase());
  });

  return { ok: true, count: students.length, students };
}

/* ============================================================
   UNLOCK HANDLERS (NEW)
   ============================================================ */

/**
 * Teacher: push an unlock for a student's assessment.
 * Writes to Unlocks sheet with status='pending'.
 */
function handlePushUnlock(body) {
  requireTeacherToken(body.token);

  const lrn = String(body.lrn || '');
  const assessmentId = String(body.assessmentId || '');
  const reason = body.reason || 'retake-approved';

  if (!lrn || !assessmentId) {
    return { ok: false, error: 'Missing lrn or assessmentId' };
  }

  const sheet = getOrCreateSheet(SHEET_NAME_UNLOCKS, UNLOCK_HEADERS);
  const data = sheet.getDataRange().getValues();
  const now = new Date().toISOString();

  // Check for existing pending unlock for same lrn + assessment
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[1]) === lrn &&
        String(row[2]) === assessmentId &&
        row[5] !== 'applied') {
      return {
        ok: true,
        unlockId: row[0],
        duplicate: true,
        message: 'Unlock already pending for this student + assessment'
      };
    }
  }

  const unlockId = lrn + '-' + assessmentId + '-' + Date.now();

  sheet.appendRow([
    unlockId, lrn, assessmentId, reason, now, 'pending', '', body.pushedBy || 'teacher'
  ]);

  logEvent('pushUnlock', lrn, assessmentId);
  return { ok: true, unlockId, pushedAt: now, message: 'Unlock pushed' };
}

/**
 * Student: fetch all pending unlocks.
 * No token needed — student device calls this with their own LRN.
 */
function handlePullUnlocks(body) {
  const lrn = String(body.lrn || '');
  if (!lrn) return { ok: false, error: 'Missing lrn' };

  const sheet = getOrCreateSheet(SHEET_NAME_UNLOCKS, UNLOCK_HEADERS);
  const data = sheet.getDataRange().getValues();
  const records = [];
  const cutoffMs = Date.now() - (UNLOCK_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[1]) !== lrn) continue;
    if (row[5] === 'applied') continue;

    const pushedMs = row[4] ? new Date(row[4]).getTime() : 0;
    if (pushedMs && pushedMs < cutoffMs) continue;

    records.push({
      unlockId: row[0],
      lrn: String(row[1]),
      assessmentId: row[2],
      reason: row[3],
      pushedAt: row[4],
      status: row[5],
      pushedBy: row[7]
    });
  }

  return { ok: true, count: records.length, records };
}

/**
 * Student: acknowledge that the unlock has been applied locally.
 */
function handleMarkUnlockApplied(body) {
  const unlockId = body.unlockId;
  if (!unlockId) return { ok: false, error: 'Missing unlockId' };

  const sheet = getOrCreateSheet(SHEET_NAME_UNLOCKS, UNLOCK_HEADERS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(unlockId)) {
      sheet.getRange(i + 1, 6).setValue('applied');
      sheet.getRange(i + 1, 7).setValue(new Date().toISOString());
      return { ok: true, unlockId, status: 'applied' };
    }
  }

  return { ok: false, error: 'Unlock not found' };
}

/**
 * Teacher: view all unlocks (pending + applied).
 */
function handleGetAllUnlocks(body) {
  requireTeacherToken(body.token);

  const sheet = getOrCreateSheet(SHEET_NAME_UNLOCKS, UNLOCK_HEADERS);
  const data = sheet.getDataRange().getValues();
  const records = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    records.push({
      unlockId: row[0],
      lrn: String(row[1]),
      assessmentId: row[2],
      reason: row[3],
      pushedAt: row[4],
      status: row[5],
      appliedAt: row[6],
      pushedBy: row[7]
    });
  }

  return { ok: true, count: records.length, records };
}

/* ============================================================
   UTILITIES
   ============================================================ */

function requireTeacherToken(token) {
  if (!token) throw new Error('Teacher token required');
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8);
  const hex = hash.map((b) => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0')).join('');
  if (hex !== TEACHER_TOKEN_HASH) throw new Error('Invalid teacher token');
}

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

/* ============================================================
   TEST HELPERS
   ============================================================ */

function testAggregated() {
  const result = handleGetAllStudentsAggregated({ token: 'teacher2026' });
  Logger.log(JSON.stringify({ ok: result.ok, count: result.count }, null, 2));
}

function testPushUnlock() {
  const result = handlePushUnlock({
    token: 'teacher2026',
    lrn: '123456789012',
    assessmentId: 'biol1-quiz1',
    reason: 'Test unlock'
  });
  Logger.log(JSON.stringify(result, null, 2));
}

function testPullUnlocks() {
  const result = handlePullUnlocks({ lrn: '123456789012' });
  Logger.log(JSON.stringify(result, null, 2));
}
