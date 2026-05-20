/* export.js — Excel (.xlsx) export of the task list via SheetJS (XLSX, loaded by CDN in index.html).
   Produces a two-sheet workbook: "Daily" and "Strategic", split by taskType.
   Exports the FULL active task list (state.tasks) — NOT filtered by the current Daily/Strategic tab.
   Archived tasks (state.deleted) are intentionally excluded. */

// Column order for both sheets. Keep in sync with the README export-format note.
const EXPORT_COLUMNS = [
  'id','title','description','company','assignee','priority','status',
  'dueDate','taskType','category','createdAt','completedAt',
  'reviewer','reviewStatus','hasAttachments'
];

// Map one task object to a flat export row.
// - title/description/dueDate rename name/notes/date for a friendlier sheet.
// - company resolves companyId → company name (blank if unlinked / not found).
// - completedAt is derived: the schema has no completedAt field, so we use updatedAt
//   only when the task is Done (best available "when finished" signal), else blank.
// - hasAttachments is a Yes/No flag from the 'drive-attached' marker in links — a true
//   file count would need one Drive API call per task, which isn't worth it for an export.
function taskToExportRow(t) {
  const co = state.companies.find(c => c.id === t.companyId);
  const hasAttachments = (t.links || '').indexOf('drive-attached') !== -1;
  return {
    id: t.id || '',
    title: t.name || '',
    description: t.notes || '',
    company: co ? co.name : '',
    assignee: t.assignee || '',
    priority: t.priority || '',
    status: t.status || '',
    dueDate: t.date || '',
    taskType: t.taskType || 'daily',
    category: t.category || '',
    createdAt: t.createdAt || '',
    completedAt: (t.status === 'Done') ? (t.updatedAt || '') : '',
    reviewer: t.reviewer || '',
    reviewStatus: t.reviewStatus || '',
    hasAttachments: hasAttachments ? 'Yes' : 'No'
  };
}

// Build a worksheet. When there are no rows, json_to_sheet would emit a blank
// sheet with no header row — so fall back to writing just the header via aoa_to_sheet.
function buildExportSheet(tasks) {
  if (tasks.length === 0) return XLSX.utils.aoa_to_sheet([EXPORT_COLUMNS]);
  return XLSX.utils.json_to_sheet(tasks.map(taskToExportRow), { header: EXPORT_COLUMNS });
}

// Local-date YYYY-MM-DD for the filename (not UTC — the file is named for the user's day).
function exportDateStamp() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function exportTasksToExcel() {
  if (typeof XLSX === 'undefined') { toast('Export library not loaded', true); return; }
  const tasks = state.tasks || [];
  if (tasks.length === 0) { toast('No tasks to export', true); return; }

  // Split by taskType — strategic vs. everything else (blank counts as daily).
  const strategic = tasks.filter(t => (t.taskType || 'daily') === 'strategic');
  const daily = tasks.filter(t => (t.taskType || 'daily') !== 'strategic');

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildExportSheet(daily), 'Daily');
  XLSX.utils.book_append_sheet(wb, buildExportSheet(strategic), 'Strategic');

  try {
    XLSX.writeFile(wb, 'maple-tasks-' + exportDateStamp() + '.xlsx');
    toast('Exported ' + tasks.length + ' task' + (tasks.length !== 1 ? 's' : '') +
          ' (' + daily.length + ' daily · ' + strategic.length + ' strategic)');
  } catch (e) {
    toast('Export failed: ' + e.message, true);
  }
}
