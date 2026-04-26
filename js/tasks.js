/* tasks.js — Task CRUD, kanban, calendar view, overdue management, review workflow */

function setTaskScope(scope) {
  state.taskScope = scope;
  document.querySelectorAll('#scopeToggle button').forEach(b => b.classList.toggle('active', b.dataset.scope === scope));
  const compFilter = document.getElementById('filterCompany');
  if(compFilter) compFilter.style.display = (scope === 'personal') ? 'none' : '';
  renderTaskView(); refreshTaskCount();
}

function setTaskView(view) {
  state.taskView = view;
  document.querySelectorAll('#taskViewToggle button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('kanban').style.display = (view === 'kanban') ? '' : 'none';
  document.getElementById('calendarView').style.display = (view === 'calendar') ? '' : 'none';
  renderTaskView();
}

function renderTaskView() { if(state.taskView === 'calendar') renderCalendar(); else renderKanban(); }

// ===== REVIEW HELPERS =====
// Returns a badge HTML string for a task's review state, or '' if no review.
function reviewBadgeHtml(task) {
  if (!task.reviewStatus) return '';
  var me = getCurrentUser();
  if (task.reviewStatus === 'pending') {
    // If I'm the reviewer, emphasize "action required"; otherwise neutral
    var isMine = task.reviewer === me;
    var color = isMine ? 'var(--accent)' : 'var(--ink-mute)';
    var label = isMine ? 'Review needed' : 'Pending review';
    return '<span class="pill" style="font-size:10px;color:' + color + ';border:1px solid ' + color + ';padding:1px 6px;border-radius:10px">\ud83d\udc41 ' + label + '</span>';
  }
  if (task.reviewStatus === 'changes_requested') {
    return '<span class="pill" style="font-size:10px;color:var(--red);border:1px solid var(--red);padding:1px 6px;border-radius:10px">\u26a0 Changes requested</span>';
  }
  if (task.reviewStatus === 'approved') {
    return '<span class="pill" style="font-size:10px;color:var(--green);border:1px solid var(--green);padding:1px 6px;border-radius:10px">\u2705 Approved</span>';
  }
  return '';
}

// Appends an entry to reviewHistory in the agreed format.
// History format: "[Apr 19, 2026 - Sridharan]: comment text\n\n" (double-newline separated)
function appendReviewHistory(task, author, message) {
  var dateStr = new Date().toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  var entry = '[' + dateStr + ' - ' + author + ']: ' + (message || '');
  task.reviewHistory = task.reviewHistory ? (task.reviewHistory + '\n\n' + entry) : entry;
}

// Tasks awaiting the current user's review action.
// Includes: pending reviews where I'm the reviewer, AND changes_requested where I'm the task owner (assignee).
function getTasksAwaitingMe() {
  var me = getCurrentUser();
  if (me === 'Unknown') return [];
  return state.tasks.filter(function(t){
    if (t.reviewStatus === 'pending' && t.reviewer === me) return true;
    if (t.reviewStatus === 'changes_requested' && t.assignee === me) return true;
    return false;
  });
}

function refreshReviewAlert() {
  var dot = document.getElementById('reviewAlertDot');
  if (!dot) return;  // gracefully handle if index.html hasn't been updated yet
  var count = getTasksAwaitingMe().length;
  if (count > 0) {
    dot.classList.add('show');
    dot.title = count + ' task' + (count !== 1 ? 's' : '') + ' awaiting your review/action';
  } else {
    dot.classList.remove('show');
    dot.title = '';
  }
}

function getFilteredTasks() {
  const search = document.getElementById('taskSearch').value.toLowerCase();
  const cat = document.getElementById('filterCategory').value;
  const ass = document.getElementById('filterAssignee').value;
  const comp = document.getElementById('filterCompany').value;
  const reviewFilter = document.getElementById('filterReview')?.value || '';
  var me = getCurrentUser();
  return state.tasks.filter(t => {
    // Scope filter — 'all' option was removed; only 'company' or 'personal' apply.
    if(state.taskScope === 'company' && !t.companyId) return false;
    if(state.taskScope === 'personal' && t.companyId) return false;
    if(search && !(t.name||'').toLowerCase().includes(search)) return false;
    if(cat && t.category !== cat) return false;
    // Assignee filter — special values:
    //   'me'         → tasks assigned to current user OR 'Both' OR unassigned (empty)
    //   'unassigned' → tasks with empty/missing assignee
    //   'all' or ''  → no filter (show everything)
    //   anything else (e.g., 'Prrithive', 'Sridharan', 'Both') → exact match
    if (ass === 'me') {
      const a = t.assignee || '';
      if (!(a === me || a === 'Both' || a === '')) return false;
    } else if (ass === 'unassigned') {
      if ((t.assignee || '') !== '') return false;
    } else if (ass && ass !== 'all') {
      if (t.assignee !== ass) return false;
    }
    if(comp && t.companyId !== comp) return false;
    // Review filter
    if (reviewFilter === 'awaiting_me') {
      if (!((t.reviewStatus === 'pending' && t.reviewer === me) ||
            (t.reviewStatus === 'changes_requested' && t.assignee === me))) return false;
    } else if (reviewFilter === 'awaiting_other') {
      if (!(t.reviewStatus === 'pending' && t.reviewer !== me)) return false;
    } else if (reviewFilter === 'changes_requested') {
      if (t.reviewStatus !== 'changes_requested') return false;
    } else if (reviewFilter === 'approved') {
      if (t.reviewStatus !== 'approved') return false;
    } else if (reviewFilter === 'no_review') {
      if (t.reviewStatus) return false;
    }
    return true;
  });
}

// ===== KANBAN =====
function renderKanban() {
  const root = document.getElementById('kanban');
  const statuses = ['Not started','In progress','Done','Blocked'];
  const filtered = getFilteredTasks();
  root.innerHTML = statuses.map(s => {
    const tasks = filtered.filter(t => (t.status||'Not started') === s);
    return `<div class="column" data-status="${s}" ondragover="event.preventDefault()" ondrop="onDrop(event,'${s}')">
      <div class="column-header"><div class="column-title"><span class="swatch"></span>${s}<span class="column-count">${tasks.length}</span></div>
        <button class="column-add" onclick="openTaskModal(null,'${s}')">+ Add</button></div>
      <div class="cards">${tasks.map(t => renderCard(t)).join('') || '<div style="font-size:12px;color:var(--ink-mute);text-align:center;padding:20px">No tasks</div>'}</div></div>`;
  }).join('');
}

function renderCard(t) {
  const company = state.companies.find(c=>c.id===t.companyId);
  const overdue = t.date && new Date(t.date) < new Date(new Date().toDateString()) && t.status !== 'Done';
  const reviewPill = reviewBadgeHtml(t);
  // data-priority drives the colored left-border in styles.css.
  // Empty string = no border (matches tasks with no priority set).
  const prio = t.priority || '';
  return `<div class="card" data-priority="${esc(prio)}" draggable="true" ondragstart="onDragStart(event,'${t.id}')" ondragend="onDragEnd(event)" onclick="openTaskModal('${t.id}')">
    <div class="card-title">${esc(t.name)}</div>
    <div class="card-meta">
      ${t.priority?`<span class="pill pill-priority-${t.priority}">${t.priority}</span>`:''}
      ${t.category?`<span class="pill pill-cat pill-cat-${categoryClass(t.category)}">${esc(t.category)}</span>`:''}
      ${company?`<span class="pill pill-company">🏢 ${esc(company.name)}</span>`:''}
      ${reviewPill}
      ${t.date?`<span class="card-date ${overdue?'overdue':''}">${formatDate(t.date)}</span>`:''}
      ${t.assignee?`<span class="card-date">· ${esc(t.assignee)}</span>`:''}${t.links?`<span class="card-date">📎</span>`:''}
    </div></div>`;
}

function onDragStart(e, id) { e.dataTransfer.setData('text/plain', id); e.target.classList.add('dragging'); }
function onDragEnd(e) {
  if (e.target && e.target.classList) e.target.classList.remove('dragging');
  document.querySelectorAll('.card.dragging').forEach(function(c) { c.classList.remove('dragging'); });
}
async function onDrop(e, status) {
  document.querySelectorAll('.card.dragging').forEach(c=>c.classList.remove('dragging'));
  const id = e.dataTransfer.getData('text/plain');
  const t = state.tasks.find(x=>x.id===id);
  if(!t || t.status === status) return;
  t.status = status; t.updatedAt = nowIso();
  renderKanban(); refreshOverdueAlert();
  try { await upsertRow(SHEET_TABS.tasks, TASK_COLS, t); toast('Moved'); } catch(err) { toast('Save failed', true); }
}

// ===== CALENDAR VIEW =====
let calCurrentWeekStart = getMonday(new Date());
function getMonday(d) { const dt = new Date(d); dt.setHours(0,0,0,0); const day = dt.getDay(); const diff = day === 0 ? -6 : 1 - day; dt.setDate(dt.getDate() + diff); return dt; }
function calWeekOffset(dir) {
  if(dir === 0) calCurrentWeekStart = getMonday(new Date());
  else { calCurrentWeekStart = new Date(calCurrentWeekStart); calCurrentWeekStart.setDate(calCurrentWeekStart.getDate() + dir * 7); }
  renderCalendar();
}

function renderCalendar() {
  const filtered = getFilteredTasks();
  const today = new Date(); today.setHours(0,0,0,0);
  const weekStart = new Date(calCurrentWeekStart);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  document.getElementById('calWeekLabel').textContent = fmt(weekStart) + ' — ' + fmt(weekEnd);
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const grid = document.getElementById('calGrid');
  let html = '';
  for(let i = 0; i < 7; i++) {
    const d = new Date(weekStart); d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0,10);
    const isToday = d.getTime() === today.getTime();
    const isPast = d < today;
    const dayTasks = filtered.filter(t => t.date === dateStr);
    html += `<div class="cal-day${isToday?' today':''}${isPast?' past':''}" ondragover="onCalDragOver(event)" ondragleave="onCalDragLeave(event)" ondrop="onCalDrop(event,'${dateStr}')" onclick="openTaskModalForDate('${dateStr}', event)">
      <div class="cal-day-header"><span>${days[i]}</span><span class="cal-day-num">${d.getDate()}</span></div>
      <div class="cal-day-tasks">${dayTasks.map(t => {
        const cc = categoryClass(t.category); const isDone = t.status === 'Done';
        return `<div class="cal-task cal-task-cat-${cc}${isDone?' done':''}" draggable="true" ondragstart="onCalDragStart(event,'${t.id}')" ondragend="onCalDragEnd(event)" onclick="event.stopPropagation(); openTaskModal('${t.id}')" title="${esc(t.name)}${t.assignee?' · '+esc(t.assignee):''}">${esc(t.name)}</div>`;
      }).join('') || ''}</div></div>`;
  }
  grid.innerHTML = html;
  const noDate = filtered.filter(t => !t.date && t.status !== 'Done');
  let unsched = document.getElementById('calUnscheduled');
  if(!unsched) { unsched = document.createElement('div'); unsched.id = 'calUnscheduled'; document.getElementById('calendarView').appendChild(unsched); }
  unsched.innerHTML = noDate.length > 0 ? `<div class="cal-unscheduled"><div class="cal-unscheduled-title">📌 Unscheduled (${noDate.length})</div><div class="cal-day-tasks">${noDate.map(t => {
    const cc = categoryClass(t.category);
    return `<div class="cal-task cal-task-cat-${cc}" draggable="true" ondragstart="onCalDragStart(event,'${t.id}')" ondragend="onCalDragEnd(event)" onclick="openTaskModal('${t.id}')" title="${esc(t.name)}">${esc(t.name)}</div>`;
  }).join('')}</div></div>` : '';
}

// ===== CALENDAR DRAG & DROP =====
function onCalDragStart(e, taskId) {
  e.stopPropagation();
  e.dataTransfer.setData('text/plain', taskId);
  e.dataTransfer.effectAllowed = 'move';
  e.target.classList.add('cal-dragging');
}

function onCalDragEnd(e) {
  if (e.target && e.target.classList) e.target.classList.remove('cal-dragging');
  document.querySelectorAll('.cal-dragging').forEach(function(d) { d.classList.remove('cal-dragging'); });
  document.querySelectorAll('.cal-drop-target').forEach(function(d) { d.classList.remove('cal-drop-target'); });
}

function onCalDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const day = e.target.closest('.cal-day');
  if (day) day.classList.add('cal-drop-target');
}

function onCalDragLeave(e) {
  const day = e.target.closest('.cal-day');
  if (day) day.classList.remove('cal-drop-target');
}

async function onCalDrop(e, dateStr) {
  e.preventDefault();
  e.stopPropagation();
  document.querySelectorAll('.cal-drop-target').forEach(function(d) { d.classList.remove('cal-drop-target'); });
  document.querySelectorAll('.cal-dragging').forEach(function(d) { d.classList.remove('cal-dragging'); });
  const taskId = e.dataTransfer.getData('text/plain');
  if (!taskId) return;
  const t = state.tasks.find(function(x) { return x.id === taskId; });
  if (!t || t.date === dateStr) return;
  t.date = dateStr;
  t.updatedAt = nowIso();
  renderCalendar();
  try { await upsertRow(SHEET_TABS.tasks, TASK_COLS, t); toast('Moved to ' + formatDate(dateStr)); cacheLocal(); }
  catch(err) { toast('Save failed', true); }
}

function openTaskModalForDate(dateStr, event) {
  if(event && event.target.closest('.cal-task')) return;
  openTaskModal(null, 'Not started');
  setTimeout(() => { document.getElementById('tDate').value = dateStr; }, 60);
}

// ===== TASK MODAL =====
function openTaskModal(id, defaultStatus) {
  state.editingTask = id ? state.tasks.find(t=>t.id===id) : null;
  const t = state.editingTask || {
    id: newId('TSK'), name:'', status: defaultStatus||'Not started', priority:'Medium',
    date:'', duration:'', assignee:'Prrithive', category:'', companyId: state.taskForCompany||'',
    notes:'', links:'', createdAt: nowIso(),
    reviewer:'', reviewStatus:'', reviewHistory:''
  };
  if(!id) { t.category = (state.taskForCompany || t.companyId) ? 'Sales' : 'Personal'; }
  state.taskForCompany = null;
  document.getElementById('taskModalTitle').textContent = id ? 'Edit task' : 'New task';
  document.getElementById('tName').value = t.name||'';
  document.getElementById('tStatus').value = t.status||'Not started';
  document.getElementById('tPriority').value = t.priority||'Medium';
  document.getElementById('tDate').value = t.date||'';
  document.getElementById('tDuration').value = t.duration||'';
  document.getElementById('tAssignee').value = t.assignee||'Prrithive';
  document.getElementById('tCategory').value = t.category||'';
  document.getElementById('tCompany').value = t.companyId||'';
  document.getElementById('tNotes').value = t.notes||'';
  document.getElementById('tLinks').value = t.links||'';
  document.getElementById('tDelete').style.display = id ? 'inline-flex' : 'none';
  document.getElementById('tArchive').style.display = id ? 'inline-flex' : 'none';
  document.getElementById('taskFileSection').style.display = id ? 'block' : 'none';
  if (id) renderTaskFiles(id);
  if(!id) state.editingTask = t;
  // Render review section — only shown for existing tasks (id present)
  renderReviewSection(id ? t : null);
  document.getElementById('taskModal').classList.add('open');
  setTimeout(()=>document.getElementById('tName').focus(), 50);
}

function closeTaskModal() { document.getElementById('taskModal').classList.remove('open'); state.editingTask = null; }

async function saveTask() {
  const t = state.editingTask; if(!t) { closeTaskModal(); return; }
  t.name = document.getElementById('tName').value.trim();
  if(!t.name) { toast('Task name required', true); return; }
  t.status = document.getElementById('tStatus').value; t.priority = document.getElementById('tPriority').value;
  t.date = document.getElementById('tDate').value; t.duration = document.getElementById('tDuration').value;
  t.assignee = document.getElementById('tAssignee').value; t.category = document.getElementById('tCategory').value;
  t.companyId = document.getElementById('tCompany').value; t.notes = document.getElementById('tNotes').value;
  t.links = document.getElementById('tLinks').value; t.updatedAt = nowIso();
  // Review fields (reviewer, reviewStatus, reviewHistory) are NOT read from the form —
  // they're updated exclusively via the review action buttons (requestReview/approveReview/etc.)
  const idx = state.tasks.findIndex(x=>x.id===t.id);
  if(idx >= 0) state.tasks[idx] = t; else state.tasks.push(t);
  refreshAll(); closeTaskModal();
  try { await upsertRow(SHEET_TABS.tasks, TASK_COLS, t); toast('Saved'); cacheLocal(); }
  catch(e) { toast('Saved locally — sync failed', true); }
}

async function deleteTask() {
  const t = state.editingTask;
  if(!t || !confirm('Archive this task? It will be moved to the Archive tab for reference.')) return;
  closeTaskModal();
  try { await archiveTask(t.id, 'deleted'); refreshAll(); cacheLocal(); toast('Archived'); }
  catch(e) { toast('Archive failed: ' + e.message, true); }
}

// ===== REVIEW SECTION IN MODAL =====
// Renders the review UI inside #reviewSection based on current state and user role.
// Different buttons/inputs appear based on whether there's an active review and what role you are.
function renderReviewSection(task) {
  var section = document.getElementById('reviewSection');
  if (!section) return;  // gracefully degrade if index.html hasn't been updated
  // Hide entirely for new (unsaved) tasks
  if (!task) { section.style.display = 'none'; section.innerHTML = ''; return; }

  section.style.display = 'block';
  var me = getCurrentUser();
  var canAct = canUserReview();
  var status = task.reviewStatus || '';
  var other = otherUser();

  var h = '<div style="margin-top:16px;padding:14px;border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--bg-sunken)">';
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">';
  h += '<strong style="font-size:13px;font-weight:700">\ud83d\udc41 Review</strong>';
  // Status indicator
  if (status === 'pending') h += '<span style="font-size:11px;color:var(--accent);font-weight:600">Pending with ' + esc(task.reviewer || '?') + '</span>';
  else if (status === 'changes_requested') h += '<span style="font-size:11px;color:var(--red);font-weight:600">Changes requested</span>';
  else if (status === 'approved') h += '<span style="font-size:11px;color:var(--green);font-weight:600">Approved by ' + esc(task.reviewer || '?') + '</span>';
  else h += '<span style="font-size:11px;color:var(--ink-mute)">No review yet</span>';
  h += '</div>';

  // Unknown users: read-only
  if (!canAct) {
    if (task.reviewHistory) {
      h += '<div style="white-space:pre-wrap;font-size:12px;color:var(--ink-soft);background:var(--bg-card);padding:10px;border-radius:var(--radius);margin-bottom:8px">' + esc(task.reviewHistory) + '</div>';
    }
    h += '<div style="font-size:11px;color:var(--ink-mute);font-style:italic">Sign in as Prrithive or Sridharan to take review actions.</div>';
    h += '</div>';
    section.innerHTML = h;
    return;
  }

  // History (always show if present)
  if (task.reviewHistory) {
    h += '<div style="white-space:pre-wrap;font-size:12px;color:var(--ink-soft);background:var(--bg-card);padding:10px;border-radius:var(--radius);margin-bottom:10px;max-height:160px;overflow-y:auto">' + esc(task.reviewHistory) + '</div>';
  }

  // State-based controls
  if (!status) {
    // No review yet — anyone can request one. Default reviewer is the other user.
    h += '<label style="font-size:11px;color:var(--ink-mute);font-weight:600;text-transform:uppercase;display:block;margin-bottom:4px">Request review from:</label>';
    h += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">';
    h += '<select id="reviewReviewer" style="flex:1;padding:6px;border:1px solid var(--line);border-radius:var(--radius);background:var(--bg-card);color:var(--ink);font-size:12px">';
    ['Prrithive', 'Sridharan'].forEach(function(name){
      if (name !== me) h += '<option value="' + name + '"' + (name === other ? ' selected' : '') + '>' + name + '</option>';
    });
    h += '</select>';
    h += '</div>';
    h += '<textarea id="reviewComment" placeholder="Optional note for reviewer..." style="width:100%;min-height:50px;padding:8px;border:1px solid var(--line);border-radius:var(--radius);background:var(--bg-card);color:var(--ink);font-size:12px;font-family:inherit;resize:vertical;box-sizing:border-box;margin-bottom:8px"></textarea>';
    h += '<button class="btn btn-primary btn-sm" onclick="doRequestReview()">Request review</button>';
  } else if (status === 'pending') {
    // Pending. If I'm the reviewer → show approve/request-changes. Otherwise → show waiting message + cancel option.
    if (task.reviewer === me) {
      h += '<label style="font-size:11px;color:var(--ink-mute);font-weight:600;text-transform:uppercase;display:block;margin-bottom:4px">Your response:</label>';
      h += '<textarea id="reviewComment" placeholder="Optional comment (required for changes)..." style="width:100%;min-height:50px;padding:8px;border:1px solid var(--line);border-radius:var(--radius);background:var(--bg-card);color:var(--ink);font-size:12px;font-family:inherit;resize:vertical;box-sizing:border-box;margin-bottom:8px"></textarea>';
      h += '<div style="display:flex;gap:8px">';
      h += '<button class="btn btn-primary btn-sm" onclick="doApproveReview()" style="background:var(--green);border-color:var(--green);color:white">\u2705 Approve</button>';
      h += '<button class="btn btn-sm" onclick="doRequestChanges()" style="color:var(--red);border-color:var(--red)">\u26a0 Request changes</button>';
      h += '</div>';
    } else {
      h += '<div style="font-size:12px;color:var(--ink-soft);margin-bottom:8px">Waiting for ' + esc(task.reviewer) + ' to respond.</div>';
      h += '<button class="btn btn-sm" onclick="doCancelReview()" style="color:var(--ink-mute)">Cancel review request</button>';
    }
  } else if (status === 'changes_requested') {
    // Changes requested. If I'm the task assignee → show re-request. Otherwise just show status.
    if (task.assignee === me) {
      h += '<label style="font-size:11px;color:var(--ink-mute);font-weight:600;text-transform:uppercase;display:block;margin-bottom:4px">What did you change?</label>';
      h += '<textarea id="reviewComment" placeholder="Describe your changes..." style="width:100%;min-height:50px;padding:8px;border:1px solid var(--line);border-radius:var(--radius);background:var(--bg-card);color:var(--ink);font-size:12px;font-family:inherit;resize:vertical;box-sizing:border-box;margin-bottom:8px"></textarea>';
      h += '<button class="btn btn-primary btn-sm" onclick="doReRequestReview()">Re-request review</button>';
    } else {
      h += '<div style="font-size:12px;color:var(--ink-soft)">Waiting for ' + esc(task.assignee) + ' to address the changes.</div>';
    }
  } else if (status === 'approved') {
    // Approved — allow reopening (e.g. if further changes needed later)
    h += '<button class="btn btn-sm" onclick="doReopenReview()" style="color:var(--ink-mute)">Reopen review</button>';
  }

  h += '</div>';
  section.innerHTML = h;
}

async function doRequestReview() {
  var t = state.editingTask; if (!t) return;
  var reviewer = document.getElementById('reviewReviewer')?.value;
  var comment = (document.getElementById('reviewComment')?.value || '').trim();
  if (!reviewer) { toast('Pick a reviewer', true); return; }
  t.reviewer = reviewer;
  t.reviewStatus = 'pending';
  appendReviewHistory(t, getCurrentUser(), 'Review requested from ' + reviewer + (comment ? ' — ' + comment : ''));
  t.updatedAt = nowIso();
  await persistReviewChange(t, 'Review requested from ' + reviewer);
}

async function doApproveReview() {
  var t = state.editingTask; if (!t) return;
  if (t.reviewer !== getCurrentUser()) { toast('Only the reviewer can approve', true); return; }
  var comment = (document.getElementById('reviewComment')?.value || '').trim();
  t.reviewStatus = 'approved';
  appendReviewHistory(t, getCurrentUser(), 'Approved' + (comment ? ' — ' + comment : ''));
  t.updatedAt = nowIso();
  await persistReviewChange(t, 'Review approved');
}

async function doRequestChanges() {
  var t = state.editingTask; if (!t) return;
  if (t.reviewer !== getCurrentUser()) { toast('Only the reviewer can request changes', true); return; }
  var comment = (document.getElementById('reviewComment')?.value || '').trim();
  if (!comment) { toast('Please add a comment explaining the changes needed', true); return; }
  t.reviewStatus = 'changes_requested';
  appendReviewHistory(t, getCurrentUser(), 'Requested changes: ' + comment);
  t.updatedAt = nowIso();
  await persistReviewChange(t, 'Changes requested');
}

async function doReRequestReview() {
  var t = state.editingTask; if (!t) return;
  if (t.assignee !== getCurrentUser()) { toast('Only the task owner can re-request review', true); return; }
  var comment = (document.getElementById('reviewComment')?.value || '').trim();
  t.reviewStatus = 'pending';
  appendReviewHistory(t, getCurrentUser(), 'Re-requested review' + (comment ? ': ' + comment : ''));
  t.updatedAt = nowIso();
  await persistReviewChange(t, 'Review re-requested');
}

async function doCancelReview() {
  var t = state.editingTask; if (!t) return;
  if (!confirm('Cancel this review request? The review will be removed and history preserved.')) return;
  appendReviewHistory(t, getCurrentUser(), 'Review request cancelled');
  t.reviewStatus = '';
  t.reviewer = '';
  t.updatedAt = nowIso();
  await persistReviewChange(t, 'Review cancelled');
}

async function doReopenReview() {
  var t = state.editingTask; if (!t) return;
  if (!confirm('Reopen this review? It will go back to pending with the original reviewer.')) return;
  t.reviewStatus = 'pending';
  appendReviewHistory(t, getCurrentUser(), 'Reopened review');
  t.updatedAt = nowIso();
  await persistReviewChange(t, 'Review reopened');
}

async function persistReviewChange(task, successMsg) {
  // Update local state, save to sheet, refresh everything including the review section
  var idx = state.tasks.findIndex(x => x.id === task.id);
  if (idx >= 0) state.tasks[idx] = task;
  try {
    await upsertRow(SHEET_TABS.tasks, TASK_COLS, task);
    toast(successMsg);
    cacheLocal();
    refreshAll();
    // Re-render the review section so buttons update to new state
    renderReviewSection(task);
  } catch (e) {
    toast('Save failed: ' + e.message, true);
    console.error(e);
  }
}

// ===== OVERDUE =====
function getOverdueTasks() {
  const today = new Date(new Date().toDateString());
  return state.tasks.filter(t => t.date && t.status !== 'Done' && new Date(t.date) < today);
}

function refreshOverdueAlert() {
  const overdue = getOverdueTasks();
  const banner = document.getElementById('overdueBanner');
  const dot = document.getElementById('taskAlertDot');
  if(!banner || !dot) return;
  if(overdue.length > 0) {
    banner.classList.add('show');
    document.getElementById('overdueBannerText').textContent = `${overdue.length} task${overdue.length>1?'s':''} overdue`;
    dot.classList.add('show');
  } else { banner.classList.remove('show'); dot.classList.remove('show'); }
}

function openOverdueModal() {
  const overdue = getOverdueTasks().sort((a,b) => new Date(a.date) - new Date(b.date));
  const list = document.getElementById('overdueList');
  if(overdue.length === 0) { list.innerHTML = '<div class="empty-mini">No overdue tasks. 🎉</div>'; }
  else {
    list.innerHTML = overdue.map(t => {
      const company = state.companies.find(c => c.id === t.companyId);
      const daysLate = Math.floor((new Date(new Date().toDateString()) - new Date(t.date)) / 86400000);
      return `<div class="overdue-row" data-id="${t.id}">
        <div class="overdue-row-head"><div>
          <div class="overdue-row-name">${esc(t.name)}</div>
          <div class="overdue-row-meta">${daysLate} day${daysLate!==1?'s':''} late · was ${formatDate(t.date)}${company ? ' · 🏢 ' + esc(company.name) : ''}${t.priority ? ' · ' + esc(t.priority) : ''}</div>
        </div></div>
        <div class="overdue-actions">
          <button onclick="rescheduleOverdue('${t.id}', 0)">Today</button>
          <button onclick="rescheduleOverdue('${t.id}', 1)">Tomorrow</button>
          <button onclick="rescheduleOverdue('${t.id}', 7)">+1 week</button>
          <input type="date" class="custom-date" onchange="rescheduleOverdueCustom('${t.id}', this.value)">
          <button class="done-btn" onclick="markOverdueDone('${t.id}')">✓ Done</button>
          <button onclick="closeOverdueModal(); openTaskModal('${t.id}')">Edit…</button>
        </div></div>`;
    }).join('');
  }
  document.getElementById('overdueModal').classList.add('open');
}
function closeOverdueModal() { document.getElementById('overdueModal').classList.remove('open'); }

async function rescheduleOverdue(id, daysFromToday) {
  const t = state.tasks.find(x => x.id === id); if(!t) return;
  const d = new Date(); d.setDate(d.getDate() + daysFromToday);
  t.date = d.toISOString().slice(0,10); t.updatedAt = nowIso();
  await persistTaskAndRefresh(t, daysFromToday === 0 ? 'Moved to today' : daysFromToday === 1 ? 'Moved to tomorrow' : `Moved +${daysFromToday} days`);
}
async function rescheduleOverdueCustom(id, dateStr) {
  if(!dateStr) return; const t = state.tasks.find(x => x.id === id); if(!t) return;
  t.date = dateStr; t.updatedAt = nowIso(); await persistTaskAndRefresh(t, 'Rescheduled to ' + formatDate(dateStr));
}
async function markOverdueDone(id) {
  const t = state.tasks.find(x => x.id === id); if(!t) return;
  t.status = 'Done'; t.updatedAt = nowIso(); await persistTaskAndRefresh(t, 'Marked done');
}
async function persistTaskAndRefresh(t, msg) {
  try { await upsertRow(SHEET_TABS.tasks, TASK_COLS, t); toast(msg); renderTaskView(); refreshOverdueAlert(); refreshTaskCount(); cacheLocal();
    if(document.getElementById('overdueModal').classList.contains('open')) openOverdueModal();
  } catch(err) { toast('Save failed: ' + err.message, true); }
}
