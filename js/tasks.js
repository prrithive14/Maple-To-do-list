/* tasks.js — Task CRUD, kanban, calendar view, overdue management */

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

function getFilteredTasks() {
  const search = document.getElementById('taskSearch').value.toLowerCase();
  const cat = document.getElementById('filterCategory').value;
  const ass = document.getElementById('filterAssignee').value;
  const comp = document.getElementById('filterCompany').value;
  return state.tasks.filter(t => {
    if(state.taskScope === 'company' && !t.companyId) return false;
    if(state.taskScope === 'personal' && t.companyId) return false;
    if(search && !(t.name||'').toLowerCase().includes(search)) return false;
    if(cat && t.category !== cat) return false;
    if(ass && t.assignee !== ass) return false;
    if(comp && t.companyId !== comp) return false;
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
  return `<div class="card" draggable="true" ondragstart="onDragStart(event,'${t.id}')" onclick="openTaskModal('${t.id}')">
    <div class="card-title">${esc(t.name)}</div>
    <div class="card-meta">
      ${t.priority?`<span class="pill pill-priority-${t.priority}">${t.priority}</span>`:''}
      ${t.category?`<span class="pill pill-cat pill-cat-${categoryClass(t.category)}">${esc(t.category)}</span>`:''}
      ${company?`<span class="pill pill-company">🏢 ${esc(company.name)}</span>`:''}
      ${t.date?`<span class="card-date ${overdue?'overdue':''}">${formatDate(t.date)}</span>`:''}
      ${t.assignee?`<span class="card-date">· ${esc(t.assignee)}</span>`:''}${t.links?`<span class="card-date">📎</span>`:''}
    </div></div>`;
}

function onDragStart(e, id) { e.dataTransfer.setData('text/plain', id); e.target.classList.add('dragging'); }
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
        return `<div class="cal-task cal-task-cat-${cc}${isDone?' done':''}" draggable="true" ondragstart="onCalDragStart(event,'${t.id}')" onclick="event.stopPropagation(); openTaskModal('${t.id}')" title="${esc(t.name)}${t.assignee?' · '+esc(t.assignee):''}">${esc(t.name)}</div>`;
      }).join('') || ''}</div></div>`;
  }
  grid.innerHTML = html;
  const noDate = filtered.filter(t => !t.date && t.status !== 'Done');
  let unsched = document.getElementById('calUnscheduled');
  if(!unsched) { unsched = document.createElement('div'); unsched.id = 'calUnscheduled'; document.getElementById('calendarView').appendChild(unsched); }
  unsched.innerHTML = noDate.length > 0 ? `<div class="cal-unscheduled"><div class="cal-unscheduled-title">📌 Unscheduled (${noDate.length})</div><div class="cal-day-tasks">${noDate.map(t => {
    const cc = categoryClass(t.category);
    return `<div class="cal-task cal-task-cat-${cc}" draggable="true" ondragstart="onCalDragStart(event,'${t.id}')" onclick="openTaskModal('${t.id}')" title="${esc(t.name)}">${esc(t.name)}</div>`;
  }).join('')}</div></div>` : '';
}

// ===== CALENDAR DRAG & DROP =====
function onCalDragStart(e, taskId) {
  e.stopPropagation();
  e.dataTransfer.setData('text/plain', taskId);
  e.dataTransfer.effectAllowed = 'move';
  e.target.classList.add('cal-dragging');
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
    notes:'', links:'', createdAt: nowIso()
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
