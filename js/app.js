/* app.js — Init, tabs, keyboard shortcuts, auto-sync */
function switchTab(name) {
  state.currentTab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  document.getElementById('tab-'+name).style.display = 'block';
  if(name==='dashboard') renderDashboard();
  else if(name==='companies') renderCompanies();
  else if(name==='archive') renderArchive();
  else if(name==='visitprep') renderVisitPrep();
  else if(name==='library') renderLibrary();
  else renderTaskView();
}
function refreshAll() {
  populateFilterOptions(); renderTaskView(); renderCompanies(); renderDashboard();
  refreshOverdueAlert(); refreshTaskCount();
  if (typeof refreshReviewAlert === 'function') refreshReviewAlert();  // review dot on Tasks tab
  document.getElementById('countCompanies').textContent = state.companies.length;
  document.getElementById('countArchive').textContent = state.deleted.length;
  // Library badge + conditional re-render if we're on the tab
  if (typeof renderLibrary === 'function') {
    const libCount = document.getElementById('countLibrary');
    if (libCount) libCount.textContent = (state.documents || []).length;
    if (state.currentTab === 'library') renderLibrary();
  }
  if(state.currentTab === 'visitprep') renderVisitPrep();
  if(state.currentTab === 'archive') renderArchive();
  const overdueCount = getOverdueTasks().length;
  if(overdueCount >= 3 && !sessionStorage.getItem('maple_overdue_shown')) {
    sessionStorage.setItem('maple_overdue_shown', '1'); setTimeout(openOverdueModal, 800);
  }
}
function refreshTaskCount() {
  const scopedCount = state.tasks.filter(t => {
    if(state.taskScope === 'company') return !!t.companyId;
    if(state.taskScope === 'personal') return !t.companyId;
    return true;
  }).length;
  document.getElementById('countTasks').textContent = scopedCount;
}
function populateFilterOptions() {
  const cats = [...new Set(state.tasks.map(t => t.category).filter(Boolean))];
  const sel = document.getElementById('filterCategory');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All categories</option>' + cats.map(c=>`<option>${esc(c)}</option>`).join('');
  sel.value = cur;
  const compSel = document.getElementById('filterCompany');
  const tCompSel = document.getElementById('tCompany');
  const compOpts = state.companies.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  compSel.innerHTML = '<option value="">All companies</option>' + compOpts;
  tCompSel.innerHTML = '<option value="">— None —</option>' + compOpts;
}
function initApp() { showApp(); loadCache(); refreshAll(); initAuth(); applyTheme(); }
function forceSync() { if(accessToken) pullAll(); else toast('Sign in first', true); }

// ===== THEME (light/dark) =====
// Theme is applied pre-paint by the inline script in index.html (reads localStorage,
// defaults to 'dark'). These functions handle runtime toggling and keep the button
// icon in sync with the active theme.
function applyTheme() {
  var theme = document.documentElement.getAttribute('data-theme') || 'dark';
  var btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = (theme === 'dark') ? '☀️' : '🌙';
}
function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme') || 'dark';
  var next = (current === 'dark') ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('maple_theme', next);
  applyTheme();
}
// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if(e.key === 'n' || e.key === 'N') { if(state.currentTab === 'companies') openCompanyModal(); else openTaskModal(); }
  if(e.key === 'Escape') { document.querySelectorAll('.modal-backdrop.open').forEach(m=>m.classList.remove('open')); }
});
// Auto-sync every 60s
setInterval(() => { if(accessToken && document.visibilityState === 'visible') pullAll(); }, 60000);
// Boot
initApp();
