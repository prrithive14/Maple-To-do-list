/* sheets.js — Google Sheets API helpers */
/* archive.js — Archive system (v2 fix) */

async function archiveTask(taskId, reason) {
  const t = state.tasks.find(x => x.id === taskId);
  if (!t) throw new Error("Task not found: " + taskId);
  const archiveRecord = { ...t, archivedAt: nowIso(), archiveReason: reason };
  const row = objToRow(archiveRecord, ARCHIVE_COLS);

  // Direct append to Archive sheet — bypasses sheetsAppend to avoid encoding issues
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/Archive!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] })
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error('Archive append failed: ' + (err.error?.message || r.status));
  }

  await deleteRowById(SHEET_TABS.tasks, taskId);
  state.tasks = state.tasks.filter(x => x.id !== taskId);
  state.archived.push(archiveRecord);
  return t;
}

async function restoreTask(taskId) {
  const a = state.archived.find(x => x.id === taskId);
  if (!a) throw new Error("Archived task not found: " + taskId);
  const t = {};
  TASK_COLS.forEach(col => t[col] = a[col] || '');
  t.status = (a.status === 'Done') ? 'Not started' : a.status;
  t.updatedAt = nowIso();
  await sheetsAppend(`Tasks!A1`, [objToRow(t, TASK_COLS)]);
  await deleteRowById(SHEET_TABS.archive, taskId);
  state.archived = state.archived.filter(x => x.id !== taskId);
  state.tasks.push(t);
  return t;
}

async function autoArchiveOldDone() {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toISOString();
  const toArchive = state.tasks.filter(t => t.status === 'Done' && t.updatedAt && t.updatedAt < cutoffStr);
  if (toArchive.length === 0) return;
  for (const t of toArchive) {
    try { await archiveTask(t.id, 'completed'); } catch (e) { console.error('Auto-archive failed for', t.id, e); }
  }
  toast(`Auto-archived ${toArchive.length} completed task${toArchive.length > 1 ? 's' : ''}`);
  refreshAll(); cacheLocal();
}

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
  const filtered = state.archived.filter(a => {
    if (search && !(a.name || '').toLowerCase().includes(search) && !(a.notes || '').toLowerCase().includes(search)) return false;
    if (reason && a.archiveReason !== reason) return false;
    return true;
  }).sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));
  if (filtered.length === 0) {
    root.innerHTML = '<div class="empty"><h3>No archived tasks</h3><p>Completed tasks auto-archive after 7 days. Deleted tasks also appear here.</p></div>'; return;
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
