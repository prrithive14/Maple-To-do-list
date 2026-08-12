/* archive.js — Archive system using Deleted sheet */

async function archiveTask(taskId, reason) {
  const t = state.tasks.find(x => x.id === taskId);
  if (!t) throw new Error("Task not found: " + taskId);
  const archiveRecord = { ...t, archivedAt: nowIso(), archiveReason: reason };
  const row = objToRow(archiveRecord, DELETED_COLS);

  // Append to Deleted sheet
  await sheetsAppend('Deleted!A1', [row]);

  // Remove from Tasks sheet
  await deleteRowById(SHEET_TABS.tasks, taskId);
  state.tasks = state.tasks.filter(x => x.id !== taskId);
  state.deleted.push(archiveRecord);
  return t;
}

async function restoreTask(taskId) {
  const a = state.deleted.find(x => x.id === taskId);
  if (!a) throw new Error("Archived task not found: " + taskId);
  const t = {};
  TASK_COLS.forEach(col => t[col] = a[col] || '');
  t.status = (a.status === 'Done') ? 'Not started' : a.status;
  t.updatedAt = nowIso();
  await sheetsAppend('Tasks!A1', [objToRow(t, TASK_COLS)]);
  await deleteRowById(SHEET_TABS.deleted, taskId);
  state.deleted = state.deleted.filter(x => x.id !== taskId);
  state.tasks.push(t);
  return t;
}

// NOTE: auto-archiving of old Done tasks was removed. Completed tasks now stay in the
// Tasks sheet indefinitely — they simply drop out of the kanban after DONE_KANBAN_DAYS
// (see isAgedDone() in tasks.js) while remaining visible in the calendar view.
// Archiving is manual only: the Archive button in the task modal, or Delete.

async function manualArchiveTask() {
  const t = state.editingTask; if (!t) return;
  closeTaskModal();
  try { await archiveTask(t.id, 'manual'); refreshAll(); cacheLocal(); toast('Archived "' + t.name + '"'); }
  catch (e) { toast('Archive failed: ' + e.message, true); }
}

async function handleRestore(taskId) {
  if (!confirm('Restore this task back to active tasks?')) return;
  try { const t = await restoreTask(taskId); refreshAll(); cacheLocal(); toast('Restored "' + t.name + '"'); }
  catch (e) { toast('Restore failed: ' + e.message, true); }
}

function renderArchive() {
  const root = document.getElementById('archiveContainer'); if (!root) return;
  const search = (document.getElementById('archiveSearch')?.value || '').toLowerCase();
  const reason = document.getElementById('filterArchiveReason')?.value || '';
  const filtered = state.deleted.filter(a => {
    if (search && !(a.name || '').toLowerCase().includes(search) && !(a.notes || '').toLowerCase().includes(search)) return false;
    if (reason && a.archiveReason !== reason) return false;
    return true;
  }).sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));
  if (filtered.length === 0) {
    root.innerHTML = '<div class="empty"><h3>No archived tasks</h3><p>Tasks you archive from the task modal appear here. Deleted tasks do too.</p></div>'; return;
  }
  root.innerHTML = `<div class="company-table"><table>
    <thead><tr><th>Task</th><th>Status</th><th>Reason</th><th>Archived</th><th>Due date</th><th>Company</th><th></th></tr></thead>
    <tbody>${filtered.map(a => {
      const co = state.companies.find(c => c.id === a.companyId);
      const reasonLabel = a.archiveReason === 'completed' ? '✅ Auto' : a.archiveReason === 'deleted' ? '🗑️ Deleted' : a.archiveReason === 'manual' ? '📦 Manual' : '—';
      return `<tr>
        <td><div class="company-name-cell">${esc(a.name)}</div>${a.category ? '<div class="company-industry">' + esc(a.category) + '</div>' : ''}</td>
        <td><span class="status-pill status-${a.status === 'Done' ? 'Won' : 'Prospect'}">${esc(a.status)}</span></td>
        <td style="font-size:12px">${reasonLabel}</td>
        <td style="font-size:12px">${a.archivedAt ? formatDate(a.archivedAt.slice(0, 10)) : '—'}</td>
        <td style="font-size:12px">${a.date ? formatDate(a.date) : '—'}</td>
        <td style="font-size:12px">${co ? esc(co.name) : '—'}</td>
        <td><button class="btn btn-sm" onclick="handleRestore('${a.id}')">↩ Restore</button></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}
