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

// Archive reasons that represent a DELIBERATE removal rather than housekeeping.
// Bulk restore skips these on purpose: the user chose to get rid of them, and
// 'company_deleted' rows belong to companies that no longer exist, so restoring
// them would leave tasks pointing at a dead companyId.
const INTENTIONAL_DELETE_REASONS = ['deleted', 'company_deleted'];

function isBulkRestorable(a) {
  return INTENTIONAL_DELETE_REASONS.indexOf(a.archiveReason) === -1;
}

// Bulk-restores every archived task that wasn't deliberately deleted — auto-archived
// completions, manual archives, and legacy rows with no reason recorded.
//
// Unlike restoreTask(), this PRESERVES the original status instead of flipping
// Done → Not started. That flip makes sense for restoring one task you want to work on
// again; here it would resurrect months of finished work as open kanban cards. Keeping
// status intact means Done tasks land in the calendar on their original date and — being
// older than DONE_KANBAN_DAYS — stay off the board, which is the point of the restore.
//
// Writes in two batched API calls (one append, one delete) rather than 2N.
async function restoreAllArchived() {
  const toRestore = state.deleted.filter(isBulkRestorable);
  if (toRestore.length === 0) { toast('Nothing to restore'); return; }
  const skippedDeletes = state.deleted.length - toRestore.length;
  if (!confirm(`Restore ${toRestore.length} archived task${toRestore.length > 1 ? 's' : ''} back into Tasks?\n\n` +
    `They keep their original status, so completed ones appear in the calendar on their date and stay off the kanban board.\n\n` +
    (skippedDeletes > 0 ? `${skippedDeletes} deliberately deleted task${skippedDeletes > 1 ? 's' : ''} will be left in the archive.\n\n` : '') +
    `This rewrites the Tasks sheet and can't be undone.`)) return;

  // Skip any whose id is somehow already live in Tasks — restoring would duplicate it.
  const liveIds = new Set(state.tasks.map(t => t.id));
  const fresh = toRestore.filter(a => !liveIds.has(a.id));
  const skipped = toRestore.length - fresh.length;

  try {
    if (fresh.length > 0) {
      const rows = fresh.map(a => {
        const t = {};
        TASK_COLS.forEach(col => t[col] = a[col] || '');
        return objToRow(t, TASK_COLS);
      });
      await sheetsAppend('Tasks!A1', rows);
      fresh.forEach(a => {
        const t = {};
        TASK_COLS.forEach(col => t[col] = a[col] || '');
        state.tasks.push(t);
      });
    }
    // Clear the Deleted rows for everything we handled, including ids skipped as
    // duplicates — leaving those behind would re-offer them on the next click.
    const handledIds = toRestore.map(a => a.id);
    await deleteRowsByIds(SHEET_TABS.deleted, handledIds);
    const handled = new Set(handledIds);
    state.deleted = state.deleted.filter(a => !handled.has(a.id));

    refreshAll(); cacheLocal();
    toast(`Restored ${fresh.length} task${fresh.length !== 1 ? 's' : ''}` + (skipped > 0 ? ` (${skipped} skipped — already in Tasks)` : ''));
  } catch (e) {
    console.error('Bulk restore failed', e);
    toast('Bulk restore failed: ' + e.message + ' — reload to resync', true);
  }
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
  // Bulk-restore button: only offered while auto-archived leftovers actually exist.
  // Set before the empty-state early-return below so it can't get stranded visible.
  const bulkBtn = document.getElementById('restoreAllBtn');
  if (bulkBtn) {
    const restorableCount = state.deleted.filter(isBulkRestorable).length;
    bulkBtn.style.display = restorableCount > 0 ? '' : 'none';
    bulkBtn.textContent = `↩ Restore all archived (${restorableCount})`;
  }
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
      const reasonLabel = a.archiveReason === 'completed' ? '✅ Auto' : a.archiveReason === 'deleted' ? '🗑️ Deleted' : a.archiveReason === 'company_deleted' ? '🏢 Company removed' : a.archiveReason === 'manual' ? '📦 Manual' : '—';
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
