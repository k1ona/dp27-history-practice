/**
 * DP27 History Practice — sync endpoint and register.
 * Author: Ali Dukayev.
 *
 * Deploy as a web app: Execute as "Me", access "Anyone". The PIN (or a token issued at sign-in) is the gate.
 * See SETUP.md for the step-by-step set-up.
 *
 * Requests (all answers are JSON):
 *   POST body {action, studentId, pin | token, payload}, sent as text/plain.
 *     action "login"    → {ok, studentId, level, token, hasBackup, backupAt}
 *     action "submit"   → payload = dp27.submission.v1; saves Submissions/<submissionId>.json and a row
 *     action "progress" → payload = dp27.progress.v1 with a full backup; saves Backups/<studentId>.json
 *     action "feedback" → that student's feedback whose status is "ready" (teacher-only fields removed)
 *     action "restore"  → that student's last backup
 *   GET  ?path=feedback&studentId=…&pin=…   and   ?path=restore&studentId=…&pin=…   (same answers)
 *   (the path may also be given as /exec/feedback or /exec/restore)
 */

// 1. Paste the ID of the Drive folder that should hold everything (from its address bar), then run setup().
var PARENT_FOLDER_ID = '';

var NAMES = {
  root: 'DP27 Practice',
  submissions: 'Submissions',
  feedback: 'Feedback',
  backups: 'Backups',
  sheet: 'DP27 Practice Register'
};

var HEADERS = {
  Students: ['studentId', 'name', 'level', 'pinHash', 'active', 'newPin (typed here, replaced by a hash)'],
  Submissions: ['receivedAt', 'submissionId', 'parentSubmissionId', 'studentId', 'level', 'sectionId', 'questionId', 'paper',
    'taskType', 'draft', 'questionText', 'commandTerm', 'namedFactor', 'timeframe', 'sourceSetId', 'responseText', 'responses',
    'wordCount', 'minutesSpent', 'timed', 'autoCheckMet', 'autoCheckNotMet', 'autoCheckDetails', 'selfCheckMet', 'selfCheckNotMet',
    'createdAt', 'appVersion', 'schema', 'fileId', 'feedbackStatus'],
  Feedback: ['ingestedAt', 'submissionId', 'studentId', 'placementType', 'placementValue', 'placementOutOf', 'markForPrediction',
    'markOutOf', 'writtenAt', 'fileId', 'fileName', 'feedbackJson'],
  Progress: ['updatedAt', 'studentId', 'level', 'sectionId', 'chunksRead', 'checkpoint', 'drills', 'tasksDone', 'tasksTotal', 'complete'],
  Predicted: ['studentId', 'name', 'level', 'P1 mean (last 5)', 'P1 %', 'P1 n', 'P2 mean (last 5)', 'P2 %', 'P2 n',
    'P3 mean (last 5)', 'P3 %', 'P3 n', 'IA mark (/25, entered by teacher)', 'Weighted total %', 'Predicted grade', 'Updated'],
  Settings: ['key', 'value', 'note']
};

var DEFAULT_SETTINGS = [
  ['weight.HL.P1', 0.20, 'verify against the legacy guide'],
  ['weight.HL.P2', 0.25, 'verify against the legacy guide'],
  ['weight.HL.P3', 0.35, 'verify against the legacy guide'],
  ['weight.HL.IA', 0.20, 'verify against the legacy guide'],
  ['weight.SL.P1', 0.30, 'verify against the legacy guide'],
  ['weight.SL.P2', 0.45, 'verify against the legacy guide'],
  ['weight.SL.IA', 0.25, 'verify against the legacy guide'],
  ['boundary.7', 86, 'placeholder; replace with session boundaries'],
  ['boundary.6', 74, 'placeholder; replace with session boundaries'],
  ['boundary.5', 63, 'placeholder; replace with session boundaries'],
  ['boundary.4', 51, 'placeholder; replace with session boundaries'],
  ['boundary.3', 38, 'placeholder; replace with session boundaries'],
  ['boundary.2', 26, 'placeholder; replace with session boundaries'],
  ['reference.Nov2025.HL7', 74, 'For reference: the November 2025 report gave HL grade 7 at 74/100'],
  ['limit.submissionKB', 200, 'largest submission accepted'],
  ['limit.backupKB', 5000, 'largest progress backup accepted'],
  ['limit.submitsPerHour', 60, 'per student'],
  ['limit.pinFailuresPerHour', 10, 'per student; further attempts are refused for an hour']
];

var TASK_TYPES = ['plan', 'paragraph', 'essay', 'p1q1a', 'p1q1b', 'p1q2', 'p1q3', 'p1q4', 'timed_p1', 'timed_p2', 'timed_p3'];
var PREDICTION_TASKS = ['essay', 'p1q1a', 'p1q1b', 'p1q2', 'p1q3', 'p1q4', 'timed_p1', 'timed_p2', 'timed_p3'];
var CELL_LIMIT = 45000;

/* ------------------------------------------------------------------ set-up (run once) */

function setup() {
  if (!PARENT_FOLDER_ID) throw new Error('Paste the Drive folder ID into PARENT_FOLDER_ID at the top of Code.gs first.');
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('ROOT_FOLDER_ID')) throw new Error('setup() has already run. Its IDs are in Project Settings → Script properties.');
  var parent = DriveApp.getFolderById(PARENT_FOLDER_ID);
  var root = parent.createFolder(NAMES.root);
  var subs = root.createFolder(NAMES.submissions);
  var fb = root.createFolder(NAMES.feedback);
  var bk = root.createFolder(NAMES.backups);
  var ss = SpreadsheetApp.create(NAMES.sheet);
  DriveApp.getFileById(ss.getId()).moveTo(root);
  var first = ss.getSheets()[0];
  first.setName('Students');
  Object.keys(HEADERS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
    sh.setFrozenRows(1);
  });
  ss.getSheetByName('Settings').getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
  props.setProperties({
    ROOT_FOLDER_ID: root.getId(),
    SUBMISSIONS_FOLDER_ID: subs.getId(),
    FEEDBACK_FOLDER_ID: fb.getId(),
    BACKUPS_FOLDER_ID: bk.getId(),
    SHEET_ID: ss.getId(),
    PIN_SALT: Utilities.getUuid(),
    TOKEN_SECRET: Utilities.getUuid() + Utilities.getUuid()
  });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'hourly') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('hourly').timeBased().everyHours(1).create();
  Logger.log('DP27 Practice folder: ' + root.getId());
  Logger.log('Submissions folder:  ' + subs.getId());
  Logger.log('Feedback folder:     ' + fb.getId());
  Logger.log('Backups folder:      ' + bk.getId());
  Logger.log('Register sheet:      ' + ss.getId() + '  ' + ss.getUrl());
  Logger.log('Hourly trigger created.');
  return { root: root.getId(), submissions: subs.getId(), feedback: fb.getId(), backups: bk.getId(), sheet: ss.getId() };
}

/** Turns any PIN typed in the "newPin" column of Students into a hash, and clears the typed PIN. Also runs every hour. */
function hashNewPins() {
  var sh = sheet_('Students');
  var values = sh.getDataRange().getValues();
  var changed = 0;
  for (var r = 1; r < values.length; r++) {
    var id = String(values[r][0] || '').trim();
    var pin = String(values[r][5] || '').trim();
    if (!id || !pin) continue;
    if (!/^\d{4,8}$/.test(pin)) {
      sh.getRange(r + 1, 6).setValue('PIN must be 4–8 digits');
      continue;
    }
    sh.getRange(r + 1, 4).setValue(pinHash_(id, pin));
    sh.getRange(r + 1, 6).setValue('');
    changed++;
  }
  Logger.log('PINs hashed: ' + changed);
  return changed;
}

/* ------------------------------------------------------------------ web entry points */

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    var limits = limits_();
    if (raw.length > (limits.backupKB + 64) * 1024) return json_({ ok: false, error: 'too_large' });
    var body = JSON.parse(raw || '{}');
    return json_(handle_(body.action, body, raw.length));
  } catch (err) {
    return json_({ ok: false, error: errorCode_(err) });
  }
}

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var path = String((e && e.pathInfo) || p.path || '').replace(/^\/+/, '');
    if (path !== 'feedback' && path !== 'restore') return json_({ ok: true, service: 'DP27 History Practice' });
    return json_(handle_(path, { studentId: p.studentId, pin: p.pin, token: p.token }, 0));
  } catch (err) {
    return json_({ ok: false, error: errorCode_(err) });
  }
}

function handle_(action, body, size) {
  var student = auth_(body);
  if (action === 'login') return login_(student);
  if (action === 'submit') return submit_(student, body.payload, size);
  if (action === 'progress') return progress_(student, body.payload, size);
  if (action === 'feedback') return { ok: true, feedback: feedbackFor_(student.studentId) };
  if (action === 'restore') return restore_(student);
  throw new Error('bad_action');
}

/* ------------------------------------------------------------------ authentication */

function auth_(body) {
  var id = String((body && body.studentId) || '').trim().toUpperCase();
  if (!/^S\d{2}$/.test(id)) throw new Error('bad_student');
  var limits = limits_();
  var cache = CacheService.getScriptCache();
  var failKey = 'fail:' + id;
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= limits.pinFailuresPerHour) throw new Error('locked');
  var student = findStudent_(id);
  var ok = false;
  if (student && student.active && student.pinHash) {
    if (body.token) ok = verifyToken_(body.token, student);
    else if (body.pin !== undefined && body.pin !== null && body.pin !== '') ok = pinHash_(id, String(body.pin)) === student.pinHash;
  }
  if (!ok) {
    cache.put(failKey, String(fails + 1), 3600);
    throw new Error('bad_credentials');
  }
  return student;
}

function findStudent_(id) {
  var values = sheet_('Students').getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]).trim().toUpperCase() === id) {
      var active = values[r][4];
      return {
        studentId: id,
        name: String(values[r][1] || ''),
        level: String(values[r][2] || 'HL').toUpperCase() === 'SL' ? 'SL' : 'HL',
        pinHash: String(values[r][3] || ''),
        active: active === true || String(active).toUpperCase() === 'TRUE' || String(active).toUpperCase() === 'YES'
      };
    }
  }
  return null;
}

function pinHash_(id, pin) {
  var salt = PropertiesService.getScriptProperties().getProperty('PIN_SALT');
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + id.toUpperCase() + '|' + pin, Utilities.Charset.UTF_8));
}

function makeToken_(student) {
  var issued = String(Date.now());
  return student.studentId + '.' + issued + '.' + sign_(student.studentId + '.' + issued + '.' + student.pinHash.slice(0, 16));
}

function verifyToken_(token, student) {
  var parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== student.studentId) return false;
  return sign_(parts[0] + '.' + parts[1] + '.' + student.pinHash.slice(0, 16)) === parts[2];
}

function sign_(text) {
  var secret = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');
  return hex_(Utilities.computeHmacSha256Signature(text, secret, Utilities.Charset.UTF_8));
}

/* ------------------------------------------------------------------ actions */

function login_(student) {
  var file = findFile_(folder_('BACKUPS_FOLDER_ID'), student.studentId + '.json');
  return {
    ok: true, studentId: student.studentId, level: student.level, token: makeToken_(student),
    hasBackup: !!file, backupAt: file ? file.getLastUpdated().toISOString() : null
  };
}

function submit_(student, s, size) {
  var limits = limits_();
  if (size > limits.submissionKB * 1024) throw new Error('too_large');
  if (!s || s.schema !== 'dp27.submission.v1') throw new Error('bad_schema');
  if (!/^[0-9a-f-]{36}$/i.test(String(s.submissionId))) throw new Error('bad_submission_id');
  if (String(s.studentId).toUpperCase() !== student.studentId) throw new Error('wrong_student');
  if (TASK_TYPES.indexOf(s.taskType) < 0) throw new Error('bad_task_type');
  var folder = folder_('SUBMISSIONS_FOLDER_ID');
  var name = s.submissionId + '.json';
  var existing = findFile_(folder, name);
  if (existing) return { ok: true, duplicate: true, submissionId: s.submissionId };
  rateLimit_(student.studentId, limits.submitsPerHour);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (findFile_(folder, name)) return { ok: true, duplicate: true, submissionId: s.submissionId };
    var file = folder.createFile(name, JSON.stringify(s, null, 2), 'application/json');
    var ac = s.autoCheck || {}, sc = s.selfCheck || {};
    sheet_('Submissions').appendRow([
      new Date().toISOString(), s.submissionId, s.parentSubmissionId || '', student.studentId, s.level || student.level,
      s.sectionId || '', s.questionId || '', s.paper || '', s.taskType, s.draft || 1, cut_(s.questionText),
      s.commandTerm || '', s.namedFactor || '', (s.timeframe || []).join('–'), s.sourceSetId || '', cut_(s.responseText),
      cut_(JSON.stringify(s.responses || [])), s.wordCount || 0, s.minutesSpent || 0, !!s.timed,
      (ac.met || []).join(', '), (ac.notMet || []).join(', '), cut_(JSON.stringify(ac.details || [])),
      (sc.met || []).join(', '), (sc.notMet || []).join(', '), s.createdAt || '', s.appVersion || '', s.schema,
      file.getId(), 'pending'
    ]);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, submissionId: s.submissionId };
}

function progress_(student, p, size) {
  var limits = limits_();
  if (size > limits.backupKB * 1024) throw new Error('too_large');
  if (!p || p.schema !== 'dp27.progress.v1') throw new Error('bad_schema');
  if (String(p.studentId).toUpperCase() !== student.studentId) throw new Error('wrong_student');
  var folder = folder_('BACKUPS_FOLDER_ID');
  var name = student.studentId + '.json';
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var text = JSON.stringify({ savedAt: new Date().toISOString(), progress: p.sections || [], backup: p.backup || null });
    var file = findFile_(folder, name);
    if (file) file.setContent(text);
    else folder.createFile(name, text, 'application/json');
    var sh = sheet_('Progress');
    var values = sh.getDataRange().getValues();
    var rowOf = {};
    for (var r = 1; r < values.length; r++) rowOf[values[r][1] + '|' + values[r][3]] = r + 1;
    var now = new Date().toISOString();
    (p.sections || []).forEach(function (x) {
      var row = [now, student.studentId, p.level || student.level, x.sectionId, x.chunksRead || '', x.checkpoint, x.drills,
        x.tasksDone, x.tasksTotal, !!x.complete];
      var at = rowOf[student.studentId + '|' + x.sectionId];
      if (at) sh.getRange(at, 1, 1, row.length).setValues([row]);
      else sh.appendRow(row);
    });
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

function restore_(student) {
  var file = findFile_(folder_('BACKUPS_FOLDER_ID'), student.studentId + '.json');
  if (!file) return { ok: true, backup: null };
  var data = JSON.parse(file.getBlob().getDataAsString());
  return { ok: true, savedAt: data.savedAt, backup: data.backup };
}

/** Feedback whose submission row is "ready", without teacher-only fields. Never returns other students' data. */
function feedbackFor_(studentId) {
  var subs = sheet_('Submissions').getDataRange().getValues();
  var h = HEADERS.Submissions;
  var ready = {};
  for (var r = 1; r < subs.length; r++) {
    if (String(subs[r][h.indexOf('studentId')]).toUpperCase() !== studentId) continue;
    if (String(subs[r][h.indexOf('feedbackStatus')]).toLowerCase() === 'ready') ready[subs[r][h.indexOf('submissionId')]] = true;
  }
  var rows = sheet_('Feedback').getDataRange().getValues();
  var f = HEADERS.Feedback;
  var latest = {};
  for (var i = 1; i < rows.length; i++) {
    var sid = rows[i][f.indexOf('submissionId')];
    if (String(rows[i][f.indexOf('studentId')]).toUpperCase() !== studentId || !ready[sid]) continue;
    latest[sid] = rows[i][f.indexOf('feedbackJson')];
  }
  return Object.keys(latest).map(function (sid) {
    var obj = JSON.parse(latest[sid]);
    delete obj.markForPrediction;
    delete obj.markOutOf;
    return obj;
  });
}

/* ------------------------------------------------------------------ hourly trigger */

function hourly() {
  hashNewPins();
  ingestFeedback();
  updatePredicted();
}

/** Reads new Feedback/*.feedback.json files into the Feedback tab and releases them (unless the row is on hold). */
function ingestFeedback() {
  var fbSheet = sheet_('Feedback');
  var have = {};
  fbSheet.getDataRange().getValues().slice(1).forEach(function (row) { have[row[HEADERS.Feedback.indexOf('fileId')]] = true; });
  var subSheet = sheet_('Submissions');
  var subs = subSheet.getDataRange().getValues();
  var h = HEADERS.Submissions;
  var rowById = {};
  for (var r = 1; r < subs.length; r++) rowById[subs[r][h.indexOf('submissionId')]] = { row: r + 1, studentId: String(subs[r][h.indexOf('studentId')]), status: String(subs[r][h.indexOf('feedbackStatus')]) };
  var files = folder_('FEEDBACK_FOLDER_ID').getFiles();
  var ingested = 0, problems = [];
  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName();
    if (!/\.feedback\.json$/i.test(name) || have[file.getId()]) continue;
    var fb;
    try { fb = JSON.parse(file.getBlob().getDataAsString()); } catch (e) { problems.push(name + ': not valid JSON'); continue; }
    var sub = rowById[fb.submissionId];
    if (fb.schema !== 'dp27.feedback.v1') { problems.push(name + ': schema is not dp27.feedback.v1'); continue; }
    if (!sub) { problems.push(name + ': no submission with id ' + fb.submissionId); continue; }
    if (String(fb.studentId).toUpperCase() !== sub.studentId.toUpperCase()) { problems.push(name + ': studentId does not match the submission'); continue; }
    var placement = fb.placement || {};
    var stripped = JSON.parse(JSON.stringify(fb));
    delete stripped.markForPrediction;
    delete stripped.markOutOf;
    fbSheet.appendRow([new Date().toISOString(), fb.submissionId, sub.studentId, placement.type || '', placement.value || '',
      placement.outOf || '', fb.markForPrediction === undefined ? '' : fb.markForPrediction,
      fb.markOutOf === undefined ? '' : fb.markOutOf, fb.writtenAt || '', file.getId(), name, cut_(JSON.stringify(stripped))]);
    if (sub.status.toLowerCase() !== 'hold') subSheet.getRange(sub.row, h.indexOf('feedbackStatus') + 1).setValue('ready');
    ingested++;
  }
  problems.forEach(function (p) { Logger.log('Feedback file skipped — ' + p); });
  Logger.log('Feedback files ingested: ' + ingested);
  return { ingested: ingested, problems: problems };
}

/** Rebuilds the teacher-only Predicted tab. Keeps the IA marks the teacher has typed in. */
function updatePredicted() {
  var settings = settings_();
  var pred = sheet_('Predicted');
  var P = HEADERS.Predicted;
  var iaCol = P.indexOf('IA mark (/25, entered by teacher)');
  var oldIA = {};
  pred.getDataRange().getValues().slice(1).forEach(function (row) { if (row[0]) oldIA[row[0]] = row[iaCol]; });
  var subs = sheet_('Submissions').getDataRange().getValues();
  var h = HEADERS.Submissions;
  var subInfo = {};
  for (var r = 1; r < subs.length; r++) subInfo[subs[r][h.indexOf('submissionId')]] = { paper: subs[r][h.indexOf('paper')], taskType: subs[r][h.indexOf('taskType')] };
  var fbRows = sheet_('Feedback').getDataRange().getValues().slice(1);
  var F = HEADERS.Feedback;
  var marks = {}; // studentId → paper → [{at, mark, outOf}]
  fbRows.forEach(function (row) {
    var info = subInfo[row[F.indexOf('submissionId')]];
    var mark = row[F.indexOf('markForPrediction')], outOf = row[F.indexOf('markOutOf')];
    if (!info || PREDICTION_TASKS.indexOf(info.taskType) < 0 || mark === '' || outOf === '' || Number(outOf) <= 0) return;
    var sid = String(row[F.indexOf('studentId')]).toUpperCase();
    marks[sid] = marks[sid] || {};
    (marks[sid][info.paper] = marks[sid][info.paper] || []).push({ at: String(row[F.indexOf('writtenAt')] || row[0]), mark: Number(mark), outOf: Number(outOf) });
  });
  var students = sheet_('Students').getDataRange().getValues().slice(1).filter(function (row) { return row[0]; });
  var out = students.map(function (row) {
    var sid = String(row[0]).toUpperCase(), level = String(row[2] || 'HL').toUpperCase() === 'SL' ? 'SL' : 'HL';
    var line = [sid, row[1], level];
    var pct = {};
    ['P1', 'P2', 'P3'].forEach(function (paper) {
      var list = ((marks[sid] || {})[paper] || []).sort(function (a, b) { return a.at < b.at ? -1 : 1; }).slice(-5);
      if (level === 'SL' && paper === 'P3') { line.push('—', '—', 0); return; }
      if (list.length < 2) { line.push('insufficient data', '', list.length); return; }
      var sum = 0, sumOut = 0;
      list.forEach(function (x) { sum += x.mark; sumOut += x.outOf; });
      pct[paper] = (sum / sumOut) * 100;
      line.push(Math.round((sum / list.length) * 100) / 100, Math.round(pct[paper] * 10) / 10, list.length);
    });
    var ia = oldIA[sid] === undefined ? '' : oldIA[sid];
    line.push(ia);
    var papers = level === 'SL' ? ['P1', 'P2'] : ['P1', 'P2', 'P3'];
    var total = '', grade = '';
    var complete = papers.every(function (p) { return pct[p] !== undefined; }) && ia !== '' && !isNaN(Number(ia));
    if (complete) {
      total = papers.reduce(function (acc, p) { return acc + settings['weight.' + level + '.' + p] * pct[p]; }, 0) +
        settings['weight.' + level + '.IA'] * (Number(ia) / 25) * 100;
      total = Math.round(total * 10) / 10;
      grade = gradeFor_(total, settings);
    } else {
      total = 'insufficient data';
      grade = 'insufficient data';
    }
    line.push(total, grade, new Date().toISOString());
    return line;
  });
  var last = pred.getLastRow();
  if (last > 1) pred.getRange(2, 1, last - 1, P.length).clearContent();
  if (out.length) pred.getRange(2, 1, out.length, P.length).setValues(out);
  return out;
}

function gradeFor_(total, settings) {
  for (var g = 7; g >= 2; g--) if (total >= Number(settings['boundary.' + g])) return g;
  return 1;
}

/* ------------------------------------------------------------------ helpers */

function settings_() {
  var out = {};
  DEFAULT_SETTINGS.forEach(function (row) { out[row[0]] = row[1]; });
  sheet_('Settings').getDataRange().getValues().slice(1).forEach(function (row) { if (row[0] !== '') out[row[0]] = row[1]; });
  return out;
}

function limits_() {
  var s = settings_();
  return { submissionKB: Number(s['limit.submissionKB']), backupKB: Number(s['limit.backupKB']),
    submitsPerHour: Number(s['limit.submitsPerHour']), pinFailuresPerHour: Number(s['limit.pinFailuresPerHour']) };
}

function rateLimit_(id, perHour) {
  var cache = CacheService.getScriptCache();
  var key = 'rate:' + id + ':' + Math.floor(Date.now() / 3600000);
  var n = Number(cache.get(key) || 0);
  if (n >= perHour) throw new Error('rate_limited');
  cache.put(key, String(n + 1), 3700);
}

function sheet_(name) {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('not_set_up');
  return SpreadsheetApp.openById(id).getSheetByName(name);
}

function folder_(key) {
  var id = PropertiesService.getScriptProperties().getProperty(key);
  if (!id) throw new Error('not_set_up');
  return DriveApp.getFolderById(id);
}

function findFile_(folder, name) {
  var it = folder.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}

function cut_(s) {
  s = s === undefined || s === null ? '' : String(s);
  return s.length > CELL_LIMIT ? s.slice(0, CELL_LIMIT) + ' …[cut; full text in the JSON file]' : s;
}

function hex_(bytes) {
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

function errorCode_(err) {
  var known = ['bad_student', 'bad_credentials', 'locked', 'bad_action', 'too_large', 'bad_schema', 'bad_submission_id',
    'wrong_student', 'bad_task_type', 'rate_limited', 'not_set_up'];
  var m = String((err && err.message) || err);
  return known.indexOf(m) >= 0 ? m : 'server_error';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
