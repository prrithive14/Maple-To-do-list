/* state.js — App state, cache, and utility functions */

let state = {
  companies: [], visits: [], tasks: [], deleted: [],
  view: 'table', taskScope: 'all', taskView: 'kanban', currentTab: 'tasks',
  editingTask: null, editingCompany: null, editingVisit: null,
  visitForCompany: null, taskForCompany: null,
};

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
function rowToObj(row, cols) { const o = {}; cols.forEach((c, i) => o[c] = (row[i] !== undefined ? row[i] : '') ); return o; }
function objToRow(o, cols) { return cols.map(c => o[c] !== undefined && o[c] !== null ? String(o[c]) : ''); }

function tabKeyForName(tab) {
  if(tab===SHEET_TABS.tasks) return 'tasks';
  if(tab===SHEET_TABS.companies) return 'companies';
  if(tab===SHEET_TABS.visits) return 'visits';
  if(tab===SHEET_TABS.deleted) return 'deleted';
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
  localStorage.setItem('maple_cache', JSON.stringify({ tasks: state.tasks, companies: state.companies, visits: state.visits, deleted: state.deleted, when: Date.now() }));
}
function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem('maple_cache') || '{}');
    if(c.tasks){ state.tasks = c.tasks; state.companies = c.companies||[]; state.visits = c.visits||[]; state.deleted = c.deleted||[]; }
  } catch(e){}
}
