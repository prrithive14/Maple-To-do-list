/* app.js — Init, tabs, keyboard shortcuts, auto-sync */

function switchTab(name) {
  state.currentTab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  document.getElementById('tab-'+name).style.display = 'block';
  if(name==='dashboard') renderDashboard();
  else if(name==='companies') renderCompanies();
  else if(name==='archive') renderArchive();
  else renderTaskView();
}

function refreshAll() {
  populateFilterOptions(); renderTaskView(); renderCompanies(); renderDashboard();
  refreshOverdueAlert(); refreshTaskCount();
  document.getElementById('countCompanies').textContent = state.companies.length;
  document.getElementById('countArchive').textContent = state.archived.length;
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

function initApp() { showApp(); loadCache(); refreshAll(); initAuth(); }
function forceSync() { if(accessToken) pullAll(); else toast('Sign in first', true); }

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
