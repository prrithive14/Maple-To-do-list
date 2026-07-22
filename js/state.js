/* state.js — App state, cache, and utility functions */

let state = {
  companies: [], visits: [], tasks: [], deleted: [], visitPreps: [], documents: [], dailyLog: [],
  view: 'table', taskScope: 'personal', taskView: 'kanban', currentTab: 'tasks',
  // Daily Log view state — week is default, calendar starts on the Monday of the current week.
  dailyLogView: 'week', dailyLogAnchor: null,
  // Learning tab — currently selected category. Empty string means "All".
  currentLearningCategory: '',
  // Assignee filter: 'me' = current user's tasks (default), 'all' = everyone,
  // 'Prrithive' / 'Sridharan' / 'Both' / 'unassigned' = specific filters.
  // Default 'me' is set on sign-in once we know who the user is — see auth.js.
  taskAssigneeFilter: 'me',
  // taskType tab switcher: 'daily' (default) | 'strategic' | 'all'. Filters kanban + calendar.
  // Persisted in localStorage['maple_taskType'] — restored just below this object literal.
  taskTypeFilter: 'daily',
  editingTask: null, editingCompany: null, editingVisit: null,
  visitForCompany: null, taskForCompany: null,
  // Identity — populated by auth.js after successful sign-in via fetchUserEmail()
  currentEmail: '',      // raw OAuth email, e.g. "prrithive14@gmail.com"
  currentUser: 'Unknown' // role name from USER_EMAILS map, or "Unknown"
};

// Restore the persisted taskType tab before any render runs. Validated against the
// known values so a stale/garbage localStorage entry can't break filtering.
(function restoreTaskTypeFilter() {
  try {
    var saved = localStorage.getItem('maple_taskType');
    if (saved === 'daily' || saved === 'strategic' || saved === 'all') state.taskTypeFilter = saved;
  } catch (e) {}
})();

let cfg = { ...APP_CONFIG };
let accessToken = null;
let tokenClient = null;
let syncing = false;
let tokenRefreshTimer = null;

function newId(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`; }
function nowIso() { return new Date().toISOString(); }
function esc(s) { return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function formatDate(d) { if(!d) return ''; const dt = new Date(d); if(isNaN(dt)) return d; return dt.toLocaleDateString('en-CA', { month:'short', day:'numeric' }); }
function colLetter(n) { let s = ''; while(n > 0){ const m = (n-1)%26; s = String.fromCharCode(65+m) + s; n = Math.floor((n-1)/26); } return s; }
function rowToObj(row, cols) {
  const o = {};
  cols.forEach((c, i) => o[c] = (row[i] !== undefined ? row[i] : ''));
  // taskType backfill: pre-migration rows have a blank cell — normalise to 'daily'
  // so nothing downstream ever sees an empty taskType. Only fires when taskType is
  // a column in `cols` (Tasks/Deleted); other entities have no such key.
  if (o.taskType === '') o.taskType = 'daily';
  return o;
}
function objToRow(o, cols) { return cols.map(c => o[c] !== undefined && o[c] !== null ? String(o[c]) : ''); }

function tabKeyForName(tab) {
  if(tab===SHEET_TABS.tasks) return 'tasks';
  if(tab===SHEET_TABS.companies) return 'companies';
  if(tab===SHEET_TABS.visits) return 'visits';
  if(tab===SHEET_TABS.deleted) return 'deleted';
  if(tab===SHEET_TABS.visitprep) return 'visitPreps';
  if(tab===SHEET_TABS.documents) return 'documents';
  if(tab===SHEET_TABS.dailylog) return 'dailyLog';
}

// ===== USER IDENTITY =====
// Returns the role name of the signed-in user: "Prrithive" | "Sridharan" | "Unknown"
function getCurrentUser() {
  return state.currentUser || 'Unknown';
}

// Returns true if current user can take review actions (anyone recognized can).
// Unknown users get read-only access — they can see tasks but not approve/request review.
function canUserReview() {
  return state.currentUser === 'Prrithive' || state.currentUser === 'Sridharan';
}

// Returns the "other" user for review purposes. Used as default reviewer.
function otherUser() {
  if (state.currentUser === 'Prrithive') return 'Sridharan';
  if (state.currentUser === 'Sridharan') return 'Prrithive';
  return '';
}

// ===== ROLE CAPABILITIES =====
// True if the signed-in user's role is in RESTRICTED_ROLES (config.js). Restricted
// users only see their own tasks and can't delete companies. See config.js for details.
function isRestrictedUser() {
  return (typeof RESTRICTED_ROLES !== 'undefined') &&
         RESTRICTED_ROLES.indexOf(state.currentUser) !== -1;
}
// Company deletion is allowed for every recognized user except restricted ones.
function canDeleteCompanies() {
  return !isRestrictedUser();
}

// Base list for any DISPLAY read of tasks. Restricted users only ever see tasks
// whose assignee is EXACTLY their own name (strict — no 'Both', no unassigned).
// Every display read-site (task board, calendar, company pages, dashboard, counts)
// bases off this so the restriction lives in one place. Mutation/lookup-by-id paths
// that act on a specific known task do NOT use this.
function visibleTasks() {
  if (isRestrictedUser()) {
    var me = getCurrentUser();
    return state.tasks.filter(function(t){ return (t.assignee || '') === me; });
  }
  return state.tasks;
}

function categoryClass(cat) {
  if(!cat) return 'Other';
  const c = cat.toLowerCase();
  if(c.includes('sales')) return 'Sales';
  if(c.includes('marketing') || c.includes('linkedin') || c.includes('website') || c.includes('content')) return 'Marketing';
  if(c.includes('admin') || c.includes('domain') || c.includes('billing') || c.includes('gst') || c.includes('email')) return 'Admin';
  if(c.includes('pr application') || c.includes('express entry') || c.includes('immigration')) return 'PR';
  if(c.includes('personal')) return 'Personal';
  if(c.includes('learn') || c.includes('study') || c.includes('research') || c.includes('course') || c.includes('pmp')) return 'Learning';
  return 'Other';
}

function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.className = 'toast', 2500);
}

function loadConfig() { try { cfg = JSON.parse(localStorage.getItem('maple_cfg') || '{}'); } catch(e){ cfg = {}; } }
function saveConfig() { localStorage.setItem('maple_cfg', JSON.stringify(cfg)); }
function showSetup() { document.getElementById('setupScreen').style.display = 'block'; document.getElementById('app').style.display = 'none'; }
function showApp() { document.getElementById('setupScreen').style.display = 'none'; document.getElementById('app').style.display = 'block'; }

function saveSetup() {
  const cid = document.getElementById('setupClientId').value.trim();
  const sid = document.getElementById('setupSheetId').value.trim();
  const cal = document.getElementById('setupCalendarId').value.trim();
  if(!cid || !sid){ toast('Client ID and Sheet ID are required', true); return; }
  cfg = { clientId: cid, sheetId: sid, calendarId: cal || 'primary' };
  saveConfig(); initApp();
}

function openSettings() {
  document.getElementById('setClientId').value = cfg.clientId || '';
  document.getElementById('setSheetId').value = cfg.sheetId || '';
  document.getElementById('setCalendarId').value = cfg.calendarId || '';
  document.getElementById('settingsModal').classList.add('open');
}
function closeSettings() { document.getElementById('settingsModal').classList.remove('open'); }
function saveSettings() {
  cfg.clientId = document.getElementById('setClientId').value.trim();
  cfg.sheetId = document.getElementById('setSheetId').value.trim();
  cfg.calendarId = document.getElementById('setCalendarId').value.trim() || 'primary';
  saveConfig(); closeSettings(); toast('Settings saved — sign in again to apply');
}
function resetApp() {
  if(!confirm('Reset all settings and local cache? Sheet data will not be touched.')) return;
  localStorage.removeItem('maple_cfg'); localStorage.removeItem('maple_cache'); location.reload();
}

function cacheLocal() {
  localStorage.setItem('maple_cache', JSON.stringify({ tasks: state.tasks, companies: state.companies, visits: state.visits, deleted: state.deleted, visitPreps: state.visitPreps, documents: state.documents, dailyLog: state.dailyLog, when: Date.now() }));
}
function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem('maple_cache') || '{}');
    if(c.tasks){ state.tasks = c.tasks; state.companies = c.companies||[]; state.visits = c.visits||[]; state.deleted = c.deleted||[]; state.visitPreps = c.visitPreps||[]; state.documents = c.documents||[]; state.dailyLog = c.dailyLog||[]; normalizeTaskTypes(); }
  } catch(e){}
}

// Cached tasks written before the taskType migration won't have the field.
// rowToObj covers fresh sheet reads; this covers the localStorage cache path.
function normalizeTaskTypes() {
  (state.tasks || []).forEach(function(t){ if(!t.taskType) t.taskType = 'daily'; });
  (state.deleted || []).forEach(function(t){ if(!t.taskType) t.taskType = 'daily'; });
}
