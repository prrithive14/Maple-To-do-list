/* app.js — Init, tabs, keyboard shortcuts, auto-sync */
function switchTab(name) {
  state.currentTab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  document.getElementById('tab-'+name).style.display = 'block';
  if(name==='companies') renderCompanies();
  else if(name==='archive') renderArchive();
  else if(name==='visitprep') renderVisitPrep();
  else if(name==='learning') renderLearning();
  else if(name==='dailylog') renderDailyLog();
  else renderTaskView();
}
function refreshAll() {
  populateFilterOptions(); renderTaskView(); renderCompanies();
  refreshOverdueAlert(); refreshTaskCount();
  if (typeof refreshReviewAlert === 'function') refreshReviewAlert();  // review dot on Tasks tab
  document.getElementById('countCompanies').textContent = state.companies.length;
  document.getElementById('countArchive').textContent = state.deleted.length;
  // Learning badge + conditional re-render if we're on the tab
  const learningCount = document.getElementById('countLearning');
  if (learningCount) learningCount.textContent = (state.documents || []).length;
  if (state.currentTab === 'learning' && typeof renderLearning === 'function') renderLearning();
  // Daily Log badge counts only entries belonging to the signed-in user.
  const dlCount = document.getElementById('countDailyLog');
  if (dlCount && typeof getMyLogEntries === 'function') dlCount.textContent = getMyLogEntries().length;
  if (state.currentTab === 'dailylog' && typeof renderDailyLog === 'function') renderDailyLog();
  if(state.currentTab === 'visitprep') renderVisitPrep();
  if(state.currentTab === 'archive') renderArchive();
  const overdueCount = getOverdueTasks().length;
  if(overdueCount >= 3 && !sessionStorage.getItem('maple_overdue_shown')) {
    sessionStorage.setItem('maple_overdue_shown', '1'); setTimeout(openOverdueModal, 800);
  }
}
function refreshTaskCount() {
  // taskScope is always 'company' or 'personal' now (the 'all' option was removed).
  const scopedCount = state.tasks.filter(t => {
    if(state.taskScope === 'company') return !!t.companyId;
    return !t.companyId; // 'personal'
  }).length;
  document.getElementById('countTasks').textContent = scopedCount;
}
function populateFilterOptions() {
  // Categories actually used in existing tasks
  const usedCats = [...new Set(state.tasks.map(t => t.category).filter(Boolean))];

  // Filter dropdown ("All categories ▾") — only shows what's actually in use,
  // since filtering by an empty category yields zero results.
  const sel = document.getElementById('filterCategory');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All categories</option>' + usedCats.map(c=>`<option>${esc(c)}</option>`).join('');
  sel.value = cur;

  // Task modal datalist — common categories first (always visible for fast picking),
  // then any other categories that exist in the data but aren't in COMMON_TASK_CATEGORIES.
  // Free-text input is preserved — users can type anything and it saves as-is.
  const dl = document.getElementById('categoryOptions');
  if (dl) {
    const common = (typeof COMMON_TASK_CATEGORIES !== 'undefined' ? COMMON_TASK_CATEGORIES : []);
    const extra = usedCats.filter(c => common.indexOf(c) === -1);
    dl.innerHTML = common.concat(extra).map(c => `<option value="${esc(c)}">`).join('');
  }

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

// Called by auth.js once after a successful sign-in for an authorized user.
// Sets the assignee filter to "My tasks" so each person lands on their own view.
// Always overrides — fresh sign-in = fresh "show me my tasks" view.
function applyMyTasksDefault() {
  const sel = document.getElementById('filterAssignee');
  if (sel) {
    sel.value = 'me';
    state.taskAssigneeFilter = 'me';
    if (typeof renderTaskView === 'function') renderTaskView();
  }
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
