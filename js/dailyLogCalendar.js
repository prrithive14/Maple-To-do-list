/* dailyLogCalendar.js — Google-Calendar-style renderer for the Daily Log.
   Always filters to the signed-in user (see getMyLogEntries in dailyLog.js). */

// Visible hour range. Change these two constants to shift the window.
const DL_START_HOUR = 6;   // 6am
const DL_END_HOUR = 24;    // midnight (exclusive)
const DL_HOUR_PX = 60;     // 1px per minute → 60px per hour

function dlMondayOf(d) {
  var dt = new Date(d); dt.setHours(0, 0, 0, 0);
  var day = dt.getDay();
  var diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  return dt;
}

function dlIsoDate(d) { return d.toISOString().slice(0, 10); }

function dlAnchor() {
  if (!state.dailyLogAnchor) state.dailyLogAnchor = new Date();
  return new Date(state.dailyLogAnchor);
}

function setDailyLogView(v) {
  state.dailyLogView = v;
  document.querySelectorAll('#dlViewToggle button').forEach(function(b) {
    b.classList.toggle('active', b.dataset.dlview === v);
  });
  renderDailyLog();
}

function dlNav(dir) {
  var a = dlAnchor();
  if (dir === 0) { state.dailyLogAnchor = new Date(); renderDailyLog(); return; }
  if (state.dailyLogView === 'day')   a.setDate(a.getDate() + dir);
  if (state.dailyLogView === 'week')  a.setDate(a.getDate() + dir * 7);
  if (state.dailyLogView === 'month') a.setMonth(a.getMonth() + dir);
  state.dailyLogAnchor = a;
  renderDailyLog();
}

// ===== EFFICIENCY BADGE =====
// Scopes to the entries actually rendered in the current view.
function dlBadgeText(visibleEntries) {
  var y = visibleEntries.length;
  var x = visibleEntries.filter(function(e) { return logDoneBool(e.done); }).length;
  var pct = y === 0 ? 0 : Math.round((x / y) * 100);
  return x + '/' + y + ' ticked · ' + pct + '%';
}

// Entries for a given ISO date, sorted by start time.
function dlEntriesForDate(all, dateStr) {
  return all.filter(function(e) { return e.date === dateStr; })
            .sort(function(a, b) { return logTimeToMin(a.startTime) - logTimeToMin(b.startTime); });
}

// ===== OVERLAP LAYOUT =====
// Greedy column assignment for overlapping blocks within a single day.
// Returns array of { entry, col, totalCols } for absolute positioning.
function dlLayoutDay(entries) {
  // Build columns of mutually non-overlapping events.
  var columns = [];
  var laid = entries.map(function(e) {
    return { entry: e, start: logTimeToMin(e.startTime), end: logTimeToMin(e.endTime), col: -1, totalCols: 1 };
  });
  laid.forEach(function(it) {
    for (var c = 0; c < columns.length; c++) {
      var last = columns[c][columns[c].length - 1];
      if (last.end <= it.start) { columns[c].push(it); it.col = c; return; }
    }
    columns.push([it]); it.col = columns.length - 1;
  });
  // For each block, totalCols is the max column-count among any block it overlaps with.
  laid.forEach(function(it) {
    var maxOverlap = 1;
    laid.forEach(function(other) {
      if (other === it) return;
      if (other.start < it.end && other.end > it.start) {
        maxOverlap = Math.max(maxOverlap, other.col + 1, it.col + 1);
      }
    });
    it.totalCols = Math.max(it.totalCols, maxOverlap);
  });
  return laid;
}

// ===== RENDERERS =====

function renderDailyLog() {
  if (!state.dailyLogAnchor) state.dailyLogAnchor = new Date();
  var container = document.getElementById('dailyLogView');
  if (!container) return;
  if (state.dailyLogView === 'day')   renderDailyLogDay(container);
  else if (state.dailyLogView === 'month') renderDailyLogMonth(container);
  else renderDailyLogWeek(container);
}

// Builds the shared hour axis (left rail).
function dlHoursAxisHtml() {
  var rows = '';
  for (var h = DL_START_HOUR; h < DL_END_HOUR; h++) {
    var label = (h === 0) ? '12am' : (h < 12 ? (h + 'am') : (h === 12 ? '12pm' : (h - 12) + 'pm'));
    rows += '<div class="dl-hour-row" style="height:' + DL_HOUR_PX + 'px"><span>' + label + '</span></div>';
  }
  return '<div class="dl-hours-axis">' + rows + '</div>';
}

function dlBlockHtml(it) {
  var e = it.entry;
  var startMin = logTimeToMin(e.startTime);
  var endMin = logTimeToMin(e.endTime);
  // Clamp to visible window so off-window blocks don't escape.
  var rangeStart = DL_START_HOUR * 60;
  var rangeEnd = DL_END_HOUR * 60;
  var top = Math.max(0, startMin - rangeStart);
  var heightMin = Math.min(endMin, rangeEnd) - Math.max(startMin, rangeStart);
  if (heightMin <= 0) return '';
  var widthPct = 100 / it.totalCols;
  var leftPct = it.col * widthPct;
  var isDone = logDoneBool(e.done);
  return '<div class="dl-block' + (isDone ? ' dl-block-done' : '') + '"' +
         ' style="top:' + top + 'px;height:' + heightMin + 'px;left:calc(' + leftPct + '% + 2px);width:calc(' + widthPct + '% - 4px)"' +
         ' onclick="openLogModal(\'' + esc(e.id) + '\')"' +
         ' title="' + esc(e.title) + ' — ' + esc(e.startTime) + '–' + esc(e.endTime) + (e.comment ? ' — ' + esc(e.comment) : '') + '">' +
         '<input type="checkbox" class="dl-block-tick"' + (isDone ? ' checked' : '') +
         ' onclick="toggleLogDone(\'' + esc(e.id) + '\', event)">' +
         '<div class="dl-block-title">' + esc(e.title) + '</div>' +
         '<div class="dl-block-time">' + esc(e.startTime) + '–' + esc(e.endTime) + '</div>' +
         '</div>';
}

function renderDailyLogDay(container) {
  var mine = getMyLogEntries();
  var d = dlAnchor();
  var dateStr = dlIsoDate(d);
  var entries = dlEntriesForDate(mine, dateStr);
  var laid = dlLayoutDay(entries);
  var blocksHtml = laid.map(dlBlockHtml).join('');

  var label = d.toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  document.getElementById('dlNavLabel').textContent = label;
  document.getElementById('dlBadge').textContent = dlBadgeText(entries);

  var totalHeight = (DL_END_HOUR - DL_START_HOUR) * DL_HOUR_PX;
  container.innerHTML =
    '<div class="dl-grid dl-grid-day">' +
      dlHoursAxisHtml() +
      '<div class="dl-cols">' +
        '<div class="dl-col" data-date="' + dateStr + '" onclick="dlEmptyClick(event, \'' + dateStr + '\')" style="height:' + totalHeight + 'px">' +
          dlHourLinesHtml() +
          blocksHtml +
        '</div>' +
      '</div>' +
    '</div>';
}

function renderDailyLogWeek(container) {
  var mine = getMyLogEntries();
  var weekStart = dlMondayOf(dlAnchor());
  var days = [];
  for (var i = 0; i < 7; i++) {
    var d = new Date(weekStart); d.setDate(d.getDate() + i);
    days.push(d);
  }
  var fmt = function(d) { return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }); };
  document.getElementById('dlNavLabel').textContent = fmt(weekStart) + ' — ' + fmt(days[6]);

  var visible = [];
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var totalHeight = (DL_END_HOUR - DL_START_HOUR) * DL_HOUR_PX;
  var dayHeaders = '';
  var dayCols = '';
  var dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (var j = 0; j < 7; j++) {
    var dj = days[j];
    var ds = dlIsoDate(dj);
    var isToday = dj.getTime() === today.getTime();
    var entries = dlEntriesForDate(mine, ds);
    visible = visible.concat(entries);
    var laid = dlLayoutDay(entries);
    dayHeaders += '<div class="dl-day-header' + (isToday ? ' today' : '') + '">' +
                    '<span class="dl-day-name">' + dayNames[j] + '</span>' +
                    '<span class="dl-day-num">' + dj.getDate() + '</span>' +
                  '</div>';
    dayCols += '<div class="dl-col" data-date="' + ds + '" onclick="dlEmptyClick(event, \'' + ds + '\')" style="height:' + totalHeight + 'px">' +
                 dlHourLinesHtml() +
                 laid.map(dlBlockHtml).join('') +
               '</div>';
  }

  document.getElementById('dlBadge').textContent = dlBadgeText(visible);
  container.innerHTML =
    '<div class="dl-week-headers">' +
      '<div class="dl-hours-axis-spacer"></div>' +
      dayHeaders +
    '</div>' +
    '<div class="dl-grid dl-grid-week">' +
      dlHoursAxisHtml() +
      '<div class="dl-cols dl-cols-week">' + dayCols + '</div>' +
    '</div>';
}

function dlHourLinesHtml() {
  var lines = '';
  for (var h = 0; h < (DL_END_HOUR - DL_START_HOUR); h++) {
    lines += '<div class="dl-hour-line" style="top:' + (h * DL_HOUR_PX) + 'px"></div>';
  }
  return lines;
}

function renderDailyLogMonth(container) {
  var mine = getMyLogEntries();
  var anchor = dlAnchor();
  var firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  var monthLabel = firstOfMonth.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
  document.getElementById('dlNavLabel').textContent = monthLabel;

  // Start the grid on Monday of the week containing day 1.
  var gridStart = dlMondayOf(firstOfMonth);
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var visible = [];
  var cellsHtml = '';
  var dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var headerHtml = dayNames.map(function(n) { return '<div class="dl-month-dayhead">' + n + '</div>'; }).join('');

  for (var w = 0; w < 6; w++) {
    for (var i = 0; i < 7; i++) {
      var d = new Date(gridStart); d.setDate(d.getDate() + (w * 7 + i));
      var ds = dlIsoDate(d);
      var entries = dlEntriesForDate(mine, ds);
      var inMonth = d.getMonth() === firstOfMonth.getMonth();
      if (inMonth) visible = visible.concat(entries);
      var isToday = d.getTime() === today.getTime();
      var pills = entries.slice(0, 4).map(function(e) {
        var isDone = logDoneBool(e.done);
        return '<div class="dl-month-pill' + (isDone ? ' done' : '') + '" onclick="event.stopPropagation(); openLogModal(\'' + esc(e.id) + '\')" title="' + esc(e.title) + '">' +
                 '<span class="dl-month-time">' + esc(e.startTime) + '</span> ' + esc(e.title) +
               '</div>';
      }).join('');
      var more = entries.length > 4 ? '<div class="dl-month-more">+' + (entries.length - 4) + ' more</div>' : '';
      cellsHtml += '<div class="dl-month-cell' + (inMonth ? '' : ' out') + (isToday ? ' today' : '') + '" onclick="openLogModal(null, {date: \'' + ds + '\'})">' +
                     '<div class="dl-month-num">' + d.getDate() + '</div>' +
                     pills + more +
                   '</div>';
    }
  }

  document.getElementById('dlBadge').textContent = dlBadgeText(visible);
  container.innerHTML =
    '<div class="dl-month-head">' + headerHtml + '</div>' +
    '<div class="dl-month-grid">' + cellsHtml + '</div>';
}

// Click on empty column area → open modal pre-filled with that date + the clicked hour.
function dlEmptyClick(ev, dateStr) {
  // Ignore clicks that bubbled from a block or its checkbox.
  if (ev.target.closest('.dl-block')) return;
  var rect = ev.currentTarget.getBoundingClientRect();
  var y = ev.clientY - rect.top;
  var minFromStart = Math.max(0, Math.floor(y / DL_HOUR_PX * 60));
  // Snap to nearest 15 minutes.
  minFromStart = Math.round(minFromStart / 15) * 15;
  var startTotalMin = DL_START_HOUR * 60 + minFromStart;
  var endTotalMin = startTotalMin + 60; // default 1-hour block
  if (endTotalMin > DL_END_HOUR * 60) endTotalMin = DL_END_HOUR * 60;
  openLogModal(null, {
    date: dateStr,
    startTime: logMinToTime(startTotalMin),
    endTime: logMinToTime(endTotalMin)
  });
}

// Quick-add bar handler.
function dlQuickAddSubmit(ev) {
  if (ev.key && ev.key !== 'Enter') return;
  var inp = document.getElementById('dlQuickAdd');
  var text = inp.value.trim();
  if (!text) return;
  // Default to anchor date if in day view, else today.
  var defaultDate;
  if (state.dailyLogView === 'day') defaultDate = dlIsoDate(dlAnchor());
  else defaultDate = new Date().toISOString().slice(0, 10);
  inp.value = '';
  quickAddLogFromText(text, defaultDate);
}
