/**
 * ============================================================
 * Google Apps Script Backend — General Biology App
 * File: Code.gs
 * Version: 2.1.0
 * ------------------------------------------------------------
 * NEW in v2.1.0:
 * - Retake counter (RetakeNumber column).
 * - Max 2 retakes per assessment (per LRN + assessmentId).
 * - IsFinalAttempt flag on the 2nd retake.
 * - handleRequestRetake rejects if max reached.
 * ============================================================
 */

const SHEET_NAME_RECORDS  = 'Records';
const SHEET_NAME_CODES    = 'SyncCodes';
const SHEET_NAME_LOG      = 'SyncLog';
const SHEET_NAME_REQUESTS = 'UnlockRequests';

const TEACHER_TOKEN_HASH = '01d58c1ac3df6d023d869e50bf78e2f9185332c281f665fd53f6dbd7592df45e';

const CODE_EXPIRY_DAYS = 7;
const MAX_RETAKES = 2;

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

const REQUEST_HEADERS = [
  'RequestId', 'LRN', 'StudentName', 'Section', 'AssessmentId',
  'Reason', 'Score', 'Total', 'RequestedAt',
  'Status', 'UnlockCode', 'CodeGeneratedAt', 'CodeExpiresAt', 'AppliedAt',
  'RetakeNumber', 'IsFinalAttempt'
];

/* ============================================================
   ENTRY POINTS
   ============================================================ */

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    switch (action) {
      case 'saveProgress':            return jsonResponse(handleSaveProgress(body));
      case 'saveScore':               return jsonResponse(handleSaveScore(body));
      case 'registerSyncCode':        return jsonResponse(handleRegisterSyncCode(body));
      case 'resolveSyncCode':         return jsonResponse(handleResolveSyncCode(body, false));
      case 'consumeSyncCode':         return jsonResponse(handleResolveSyncCode(body, true));
      case 'getAllStudentsAggregated': return jsonResponse(handleGetAllStudentsAggregated(body));
      case 'requestRetake':           return jsonResponse(handleRequestRetake(body));
      case 'getStudentRequests':      return jsonResponse(handleGetStudentRequests(body));
      case 'getUnlockRequests':       return jsonResponse(handleGetUnlockRequests(body));
      case 'approveRetake':           return jsonResponse(handleApproveRetake(body));
      case 'cancelRequest':           return jsonResponse(handleCancelRequest(body));
      case 'redeemUnlockCode':        return jsonResponse(handleRedeemUnlockCode(body));
      case 'ping':                    return jsonResponse({ ok: true, message: 'Backend is live', version: '2.1.0', timestamp: new Date().toISOString() });
      default:                        return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
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
      return jsonResponse({ ok: true, message: 'Backend is live', version: '2.1.0', timestamp: new Date().toISOString() });
    case 'resolveSyncCode':
      return jsonResponse(handleResolveSyncCode({ code: e.parameter.code }, false));
    case 'getAllStudentsAggregated':
      return jsonResponse(handleGetAllStudentsAggregated({ token: e.parameter.token }));
    default:
      return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
  }
}

/* ============================================================
   EXISTING HANDLERS
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
  if (typeof total === 'number' && typeof score === 'number' && score > total) {
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
    code, lrn, JSON.stringify(payload), signature || '',
    now.toISOString(), expiresAt.toISOString(), 'FALSE'
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
      if (expiresAt < new Date()) return { ok: false, error: 'Code expired' };
      if (markUsed) sheet.getRange(i + 1, 7).setValue('TRUE');
      return {
        ok: true, code, lrn: data[i][1],
        payload: JSON.parse(data[i][2]),
        signature: data[i][3], createdAt: data[i][4]
      };
    }
  }
  return { ok: false, error: 'Code not found' };
}

function handleGetAllStudentsAggregated(body) {
  requireTeacherToken(body.token);

  const sheet = getOrCreateSheet(SHEET_NAME_RECORDS, RECORD_HEADERS);
  const data = sheet.getDataRange().getValues();
  const byLrn = {};

  for (let i = 1; i < data.length; i++) {
    const r = rowToRecord(data[i]);
    const lrn = String(r.LRN || '');
    if (!lrn) continue;

    if (!byLrn[lrn]) {
      byLrn[lrn] = {
        lrn,
        lastName: r.LastName || '', firstName: r.FirstName || '',
        middleName: r.MiddleName || '', gradeLevel: r.GradeLevel || '',
        section: r.Section || '',
        progress: { biol1: { weeks: {}, completed: [] }, biol2: { weeks: {}, completed: [] } },
        scores: {
          biol1: { quizzes: {}, st: {}, pt: {}, te: {} },
          biol2: { quizzes: {}, st: {}, pt: {}, te: {} }
        },
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
              entry.progress[s].completed = Array.from(
                new Set([...entry.progress[s].completed, ...prog[s].completed])
              );
            }
          }
        });
      } catch (e) { /* skip */ }
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
    return { ...s, summary };
  });

  students.sort((a, b) => {
    const aL = String(a.lastName || '').toUpperCase();
    const bL = String(b.lastName || '').toUpperCase();
    if (aL !== bL) return aL.localeCompare(bL);
    return String(a.firstName || '').toUpperCase().localeCompare(String(b.firstName || '').toUpperCase());
  });

  return { ok: true, count: students.length, students };
}

/* ============================================================
   RETAKE REQUEST SYSTEM
   ============================================================ */

/**
 * Count how many approved/applied requests exist for this LRN + assessmentId.
 * Used to enforce MAX_RETAKES limit.
 */
function countRetakesFor(sheet, lrn, assessmentId) {
  const data = sheet.getDataRange().getValues();
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[1]) !== String(lrn)) continue;
    if (String(row[4]) !== String(assessmentId)) continue;
    const status = String(row[9]);
    if (status === 'approved' || status === 'applied') count++;
  }
  return count;
}

function handleRequestRetake(body) {
  const { lrn, student, assessmentId, reason, score, total } = body;

  if (!lrn || !assessmentId) {
    return { ok: false, error: 'Missing lrn or assessmentId' };
  }

  const sheet = getOrCreateSheet(SHEET_NAME_REQUESTS, REQUEST_HEADERS);

  // Check if max retakes already reached
  const retakesDone = countRetakesFor(sheet, lrn, assessmentId);
  if (retakesDone >= MAX_RETAKES) {
    return {
      ok: false,
      error: 'MAX_RETAKES_REACHED',
      message: 'Maximum of ' + MAX_RETAKES + ' retakes already used for this assessment.',
      retakesDone,
      maxRetakes: MAX_RETAKES
    };
  }

  const data = sheet.getDataRange().getValues();
  const nextRetakeNumber = retakesDone + 1;
  const isFinalAttempt = nextRetakeNumber >= MAX_RETAKES;

  // Check for existing pending/approved request
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowLrn = String(row[1]);
    const rowAid = String(row[4]);
    const rowStatus = String(row[9]);

    if (rowLrn === String(lrn) &&
        rowAid === String(assessmentId) &&
        (rowStatus === 'pending' || rowStatus === 'approved')) {
      return {
        ok: true,
        existing: true,
        requestId: row[0],
        status: rowStatus,
        retakeNumber: Number(row[14]) || 0,
        unlockCode: rowStatus === 'approved' ? row[10] : null,
        message: 'Existing request found'
      };
    }
  }

  const requestId = 'REQ-' + lrn + '-' + Date.now();
  const studentName = ((student?.lastName || '') + ', ' + (student?.firstName || '')).replace(/^, |, $/g, '');
  const section = student?.section || '';
  const now = new Date().toISOString();

  sheet.appendRow([
    requestId, lrn, studentName, section,
    assessmentId, reason || 'failed-attempt',
    score || 0, total || 0, now,
    'pending', '', '', '', '',
    nextRetakeNumber, isFinalAttempt ? 'TRUE' : 'FALSE'
  ]);

  logEvent('requestRetake', lrn, assessmentId + ' (retake #' + nextRetakeNumber + ')');
  return {
    ok: true,
    requestId,
    requestedAt: now,
    retakeNumber: nextRetakeNumber,
    isFinalAttempt,
    maxRetakes: MAX_RETAKES,
    message: 'Request created'
  };
}

function handleGetStudentRequests(body) {
  const lrn = String(body.lrn || '');
  if (!lrn) return { ok: false, error: 'Missing lrn' };

  const sheet = getOrCreateSheet(SHEET_NAME_REQUESTS, REQUEST_HEADERS);
  const data = sheet.getDataRange().getValues();
  const records = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[1]) !== lrn) continue;

    records.push({
      requestId: row[0],
      lrn: String(row[1]),
      assessmentId: row[4],
      requestedAt: row[8],
      status: row[9],
      unlockCode: row[10] || null,
      codeGeneratedAt: row[11] || null,
      codeExpiresAt: row[12] || null,
      appliedAt: row[13] || null,
      retakeNumber: Number(row[14]) || 0,
      isFinalAttempt: row[15] === 'TRUE'
    });
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

    records.push({
      requestId: row[0],
      lrn: String(row[1]),
      studentName: row[2],
      section: row[3],
      assessmentId: aid,
      reason: row[5],
      score: Number(row[6]) || 0,
      total: Number(row[7]) || 0,
      requestedAt: row[8],
      status: row[9],
      unlockCode: row[10] || null,
      codeGeneratedAt: row[11] || null,
      codeExpiresAt: row[12] || null,
      appliedAt: row[13] || null,
      retakeNumber: Number(row[14]) || 0,
      isFinalAttempt: row[15] === 'TRUE'
    });
  }

  records.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (b.status === 'pending' && a.status !== 'pending') return 1;
    return new Date(b.requestedAt) - new Date(a.requestedAt);
  });

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
      const currentStatus = String(data[i][9]);
      if (currentStatus === 'applied') return { ok: false, error: 'Request already applied' };
      if (currentStatus === 'cancelled') return { ok: false, error: 'Request was cancelled' };

      const code = generateUniqueCode(sheet);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

      sheet.getRange(i + 1, 10).setValue('approved');
      sheet.getRange(i + 1, 11).setValue(code);
      sheet.getRange(i + 1, 12).setValue(now.toISOString());
      sheet.getRange(i + 1, 13).setValue(expiresAt.toISOString());

      logEvent('approveRetake', data[i][1], requestId + ' → ' + code);
      return {
        ok: true,
        requestId,
        unlockCode: code,
        codeGeneratedAt: now.toISOString(),
        codeExpiresAt: expiresAt.toISOString(),
        message: 'Code generated'
      };
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
      const currentStatus = String(data[i][9]);
      if (currentStatus === 'applied') return { ok: false, error: 'Cannot cancel — already applied' };

      sheet.getRange(i + 1, 10).setValue('cancelled');
      logEvent('cancelRequest', data[i][1], requestId);
      return { ok: true, requestId, message: 'Request cancelled' };
    }
  }
  return { ok: false, error: 'Request not found' };
}

function handleRedeemUnlockCode(body) {
  const lrn = String(body.lrn || '');
  const code = String(body.code || '').toUpperCase().trim();

  if (!lrn || !code) return { ok: false, error: 'Missing lrn or code' };

  const sheet = getOrCreateSheet(SHEET_NAME_REQUESTS, REQUEST_HEADERS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    if (String(row[10]).toUpperCase() !== code) continue;
    if (String(row[1]) !== lrn) continue;

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

    return {
      ok: true,
      requestId: row[0],
      assessmentId: row[4],
      appliedAt: now,
      retakeNumber: Number(row[14]) || 0,
      isFinalAttempt: row[15] === 'TRUE',
      message: 'Unlock applied'
    };
  }

  return { ok: false, error: 'Code not found or not linked to this student' };
}

/* ============================================================
   UTILITIES
   ============================================================ */

function requireTeacherToken(token) {
  if (!token) throw new Error('Teacher token required');
  const hash = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8
  );
  const hex = hash.map((b) => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0')).join('');
  if (hex !== TEACHER_TOKEN_HASH) throw new Error('Invalid teacher token');
}

function rowToRecord(row) {
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

function generateUniqueCode(sheet) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const data = sheet.getDataRange().getValues();
  const existing = new Set();
  for (let i = 1; i < data.length; i++) {
    if (data[i][10]) existing.add(String(data[i][10]).toUpperCase());
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    let code = 'RTK-';
    for (let k = 0; k < 8; k++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
      if (k === 3) code += '-';
    }
    if (!existing.has(code)) return code;
  }
  throw new Error('Could not generate unique code');
}

function logEvent(action, lrn, details) {
  try {
    const sheet = getOrCreateSheet(SHEET_NAME_LOG, LOG_HEADERS);
    sheet.appendRow([new Date().toISOString(), action, lrn || '', details || '']);
  } catch (e) { /* silent */ }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
