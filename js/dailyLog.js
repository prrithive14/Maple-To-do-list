/* dailyLog.js — Daily Log CRUD, detail modal, and quick-add parser.
   Entries are per-user: createdBy/updatedBy hold the lowercased OAuth email.
   Rendering and view-state live in dailyLogCalendar.js. */

// ===== HELPERS =====

// "TRUE"/"true"/true → true; anything else → false. Sheets returns strings.
function logDoneBool(v) {
  if (v === true) return true;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return false;
}

// Returns only entries belonging to the signed-in user. Daily Log is intentionally personal.
// Fallback to empty array if not signed in yet (state.currentEmail is set in auth.js).
function getMyLogEntries() {
  var me = (state.currentEmail || '').toLowerCase();
  if (!me) return [];
  return (state.dailyLog || []).filter(function(e) {
    return (e.createdBy || '').toLowerCase() === me;
  });
}

// "HH:mm" → minutes since 00:00. Returns NaN if malformed.
function logTimeToMin(hhmm) {
  if (!hhmm) return NaN;
  var parts = String(hhmm).split(':');
  if (parts.length !== 2) return NaN;
  var h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return NaN;
  return h * 60 + m;
}

// minutes → "HH:mm"
function logMinToTime(min) {
  var h = Math.floor(min / 60), m = min % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

// ===== QUICK-ADD PARSER =====
// Handles patterns like:
//   "Gym 6-8pm"
//   "Lunch 12-1pm"
//   "Call Dad 14:30-15:00"
//   "Read 9am-10:30am"
//   "Standup 9:00-9:15"
// Returns { title, startTime, endTime } or null if it can't parse a time range.
function parseQuickAddLog(text) {
  if (!text) return null;
  var raw = text.trim();
  // Capture the trailing time range. Allow optional am/pm on each side, and either - or — separator.
  // Group 1: start hour, 2: start min (optional), 3: start am/pm (optional)
  // Group 4: end hour,   5: end min (optional),   6: end am/pm (optional)
  var re = /\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i;
  var m = raw.match(re);
  if (!m) return null;
  var title = raw.slice(0, m.index).trim();
  if (!title) return null;

  var sH = parseInt(m[1], 10), sM = m[2] ? parseInt(m[2], 10) : 0;
  var eH = parseInt(m[4], 10), eM = m[5] ? parseInt(m[5], 10) : 0;
  var sAp = (m[3] || '').toLowerCase(), eAp = (m[6] || '').toLowerCase();

  // If only the end has am/pm, apply it to start too (e.g., "6-8pm").
  // If only the start has am/pm, apply it to end too.
  if (!sAp && eAp) sAp = eAp;
  if (!eAp && sAp) eAp = sAp;

  // Apply am/pm. If still none, assume 24h.
  function apply(h, ap) {
    if (ap === 'pm' && h < 12) return h + 12;
    if (ap === 'am' && h === 12) return 0;
    return h;
  }
  sH = apply(sH, sAp);
  eH = apply(eH, eAp);

  // If end is at-or-before start with no am/pm context, treat end as PM (e.g., "Lunch 12-1" → 12pm-1pm).
  var startMin = sH * 60 + sM, endMin = eH * 60 + eM;
  if (endMin <= startMin && !sAp && !eAp) {
    eH += 12;
    endMin = eH * 60 + eM;
  }
  if (sH < 0 || sH > 23 || eH < 0 || eH > 23 || endMin <= startMin) return null;

  return { title: title, startTime: logMinToTime(startMin), endTime: logMinToTime(endMin) };
}

// Used by the quick-add bar. defaultDate is YYYY-MM-DD; falls back to today.
async function quickAddLogFromText(text, defaultDate) {
  var parsed = parseQuickAddLog(text);
  var dateStr = defaultDate || new Date().toISOString().slice(0, 10);
  if (!parsed) {
    // Couldn't parse — open the modal pre-filled with the typed title.
    openLogModal(null, { date: dateStr, title: (text || '').trim() });
    return;
  }
  var me = (state.currentEmail || '').toLowerCase();
  if (!me) { toast('Sign in first', true); return; }
  var entry = {
    id: newId('LOG'),
    date: dateStr,
    startTime: parsed.startTime,
    endTime: parsed.endTime,
    title: parsed.title,
    done: 'FALSE',
    comment: '',
    createdAt: nowIso(),
    createdBy: me,
    updatedAt: nowIso(),
    updatedBy: me
  };
  state.dailyLog.push(entry);
  try {
    await upsertRow(SHEET_TABS.dailylog, DAILYLOG_COLS, entry);
    if (typeof renderDailyLog === 'function') renderDailyLog();
    cacheLocal();
  } catch (err) {
    state.dailyLog = state.dailyLog.filter(function(x) { return x.id !== entry.id; });
    toast('Save failed: ' + err.message, true);
  }
}

// ===== MODAL =====

function openLogModal(id, defaults) {
  state.editingLog = id ? state.dailyLog.find(function(x) { return x.id === id; }) : null;
  var e = state.editingLog || {};
  var d = defaults || {};
  document.getElementById('logModalTitle').textContent = id ? 'Edit log entry' : 'New log entry';
  document.getElementById('lTitle').value = e.title || d.title || '';
  document.getElementById('lDate').value = e.date || d.date || new Date().toISOString().slice(0, 10);
  document.getElementById('lStart').value = e.startTime || d.startTime || '';
  document.getElementById('lEnd').value = e.endTime || d.endTime || '';
  document.getElementById('lDone').checked = logDoneBool(e.done);
  document.getElementById('lComment').value = e.comment || '';
  document.getElementById('lDelete').style.display = id ? '' : 'none';
  document.getElementById('logModal').classList.add('open');
  setTimeout(function() { document.getElementById('lTitle').focus(); }, 60);
}

function closeLogModal() {
  document.getElementById('logModal').classList.remove('open');
  state.editingLog = null;
}

async function saveLogEntry() {
  var me = (state.currentEmail || '').toLowerCase();
  if (!me) { toast('Sign in first', true); return; }

  var title = document.getElementById('lTitle').value.trim();
  var date = document.getElementById('lDate').value;
  var startTime = document.getElementById('lStart').value;
  var endTime = document.getElementById('lEnd').value;
  var done = document.getElementById('lDone').checked;
  var comment = document.getElementById('lComment').value.trim();

  if (!title) { toast('Title required', true); return; }
  if (!date)  { toast('Date required', true); return; }
  if (!startTime || !endTime) { toast('Start and end time required', true); return; }
  if (logTimeToMin(endTime) <= logTimeToMin(startTime)) { toast('End must be after start', true); return; }

  var existing = state.editingLog;
  var entry = existing ? Object.assign({}, existing) : {
    id: newId('LOG'),
    createdAt: nowIso(),
    createdBy: me
  };
  entry.title = title;
  entry.date = date;
  entry.startTime = startTime;
  entry.endTime = endTime;
  entry.done = done ? 'TRUE' : 'FALSE';
  entry.comment = comment;
  entry.updatedAt = nowIso();
  entry.updatedBy = me;

  // Optimistic update
  if (existing) {
    Object.assign(existing, entry);
  } else {
    state.dailyLog.push(entry);
  }
  closeLogModal();
  if (typeof renderDailyLog === 'function') renderDailyLog();

  try {
    await upsertRow(SHEET_TABS.dailylog, DAILYLOG_COLS, entry);
    cacheLocal();
    toast(existing ? 'Saved' : 'Logged');
  } catch (err) {
    toast('Save failed: ' + err.message, true);
  }
}

async function deleteLogEntry() {
  var e = state.editingLog;
  if (!e) return;
  if (!confirm('Delete this log entry?')) return;
  state.dailyLog = state.dailyLog.filter(function(x) { return x.id !== e.id; });
  closeLogModal();
  if (typeof renderDailyLog === 'function') renderDailyLog();
  try {
    await deleteRowById(SHEET_TABS.dailylog, e.id);
    cacheLocal();
    toast('Deleted');
  } catch (err) {
    toast('Delete failed: ' + err.message, true);
  }
}

// Called by the in-block checkbox.
async function toggleLogDone(id, ev) {
  if (ev) { ev.stopPropagation(); }
  var e = state.dailyLog.find(function(x) { return x.id === id; });
  if (!e) return;
  var nowDone = !logDoneBool(e.done);
  e.done = nowDone ? 'TRUE' : 'FALSE';
  e.updatedAt = nowIso();
  e.updatedBy = (state.currentEmail || '').toLowerCase();
  if (typeof renderDailyLog === 'function') renderDailyLog();
  try {
    await upsertRow(SHEET_TABS.dailylog, DAILYLOG_COLS, e);
    cacheLocal();
  } catch (err) {
    // Revert on failure
    e.done = nowDone ? 'FALSE' : 'TRUE';
    if (typeof renderDailyLog === 'function') renderDailyLog();
    toast('Save failed', true);
  }
}
