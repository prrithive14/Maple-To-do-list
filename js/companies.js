/* companies.js — Company CRUD, table/card views, sort + pagination */

// Pagination and sort state
var CO_PAGE_SIZE = 15;
var coCurrentPage = 1;
var coSortMode = 'priority';  // 'priority' | 'tasks' | 'visit' | 'alpha'

function setCompanyView(v) {
  state.view = v;
  document.getElementById('viewTable').classList.toggle('active', v==='table');
  document.getElementById('viewCards').classList.toggle('active', v==='cards');
  renderCompanies();
}

// ===== HELPERS =====
// Normalize a website URL so the browser opens it correctly.
// If there's no protocol, prepend https://. If blank, return null.
function normalizeWebsiteUrl(raw) {
  if (!raw) return null;
  var s = String(raw).trim();
  if (!s) return null;
  // Already has a protocol (http, https, ftp, etc.)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  // Looks like a bare domain or path — prepend https://
  return 'https://' + s;
}

// Returns HTML for a small globe icon link, or '' if no website.
// Uses event.stopPropagation to avoid triggering the parent row/card click.
function companyWebsiteLinkHtml(companyObj) {
  var url = normalizeWebsiteUrl(companyObj.website);
  if (!url) return '';
  // Tooltip shows the URL so user knows where it goes before clicking
  var safeUrl = esc(url);
  return '<a href="' + safeUrl + '" target="_blank" rel="noopener noreferrer" ' +
    'onclick="event.stopPropagation()" ' +
    'title="Open ' + safeUrl + '" ' +
    'style="text-decoration:none;color:var(--accent);margin-left:6px;font-size:13px;cursor:pointer" ' +
    'aria-label="Open website in new tab">\ud83c\udf10</a>';
}

// A task is "active" if it's In progress or Not started
function coGetActiveTasksForCompany(companyId) {
  return state.tasks.filter(function(t){
    return t.companyId === companyId && (t.status === 'In progress' || t.status === 'Not started');
  });
}

function coGetOverdueCountForCompany(companyId) {
  var today = new Date(new Date().toDateString());
  var active = coGetActiveTasksForCompany(companyId);
  return active.filter(function(t){ return t.date && new Date(t.date) < today; }).length;
}

function coGetNearestDueForCompany(companyId) {
  var active = coGetActiveTasksForCompany(companyId);
  var withDates = active.filter(function(t){ return t.date; }).map(function(t){ return t.date; });
  if (withDates.length === 0) return null;
  withDates.sort();
  return withDates[0];
}

function coGetVisitDate(companyId) {
  var vp = state.visitPreps.find(function(v){ return v.companyId === companyId; });
  return vp && vp.visitDate ? vp.visitDate : null;
}

function coFormatNextVisit(companyId) {
  var vd = coGetVisitDate(companyId);
  if (!vd) return { text: '—', color: 'var(--ink-mute)' };
  var today = new Date(new Date().toDateString());
  var visit = new Date(vd);
  var daysUntil = Math.round((visit - today) / 86400000);
  if (daysUntil === 0) return { text: formatDate(vd) + ' (today)', color: 'var(--green)' };
  if (daysUntil > 0) return { text: formatDate(vd) + ' (in ' + daysUntil + 'd)', color: 'var(--accent)' };
  return { text: formatDate(vd) + ' (' + Math.abs(daysUntil) + 'd ago)', color: 'var(--red)' };
}

// Priority score — Tier 1 (has active tasks) vs Tier 2 (no active tasks, falls back to VisitPrep)
function coPriorityScore(companyId) {
  var active = coGetActiveTasksForCompany(companyId);

  if (active.length > 0) {
    var overdueCount = coGetOverdueCountForCompany(companyId);
    var nearest = coGetNearestDueForCompany(companyId);
    var nearnessBoost = 0;
    if (nearest) {
      var today = new Date(new Date().toDateString());
      var days = Math.round((new Date(nearest) - today) / 86400000);
      if (days <= 0) nearnessBoost = 90;
      else if (days <= 7) nearnessBoost = 70 - days * 2;
      else if (days <= 30) nearnessBoost = 40 - days;
      else nearnessBoost = 5;
    }
    var score = 10000 + overdueCount * 500 + nearnessBoost + active.length * 5;
    return {
      score: score,
      reason: overdueCount > 0
        ? { icon: '\u26a0', label: overdueCount + ' overdue task' + (overdueCount !== 1 ? 's' : '') }
        : nearest
          ? { icon: '\ud83d\udcc5', label: 'Next task: ' + formatDate(nearest) }
          : { icon: '\ud83d\udccb', label: active.length + ' active task' + (active.length !== 1 ? 's' : '') }
    };
  }

  if (typeof vpPriorityScore === 'function') {
    var vp = vpPriorityScore(companyId);
    return { score: vp.score, reason: vp.reason };
  }
  return { score: 0, reason: { icon: '\u2022', label: '' } };
}

// ===== FILTER + SORT =====
function coFilterAndSortCompanies() {
  var search = (document.getElementById('companySearch')?.value || '').toLowerCase();
  var status = document.getElementById('filterCompanyStatus')?.value || '';
  var owner = document.getElementById('filterCompanyOwner')?.value || '';
  var activeTasksFilter = document.getElementById('filterCompanyActiveTasks')?.value || '';

  var filtered = state.companies.filter(function(c){
    if (search && !((c.name||'') + (c.industry||'') + (c.contact||'')).toLowerCase().includes(search)) return false;
    if (status && c.status !== status) return false;
    if (owner && c.owner !== owner) return false;
    if (activeTasksFilter === 'with') {
      if (coGetActiveTasksForCompany(c.id).length === 0) return false;
    } else if (activeTasksFilter === 'without') {
      if (coGetActiveTasksForCompany(c.id).length > 0) return false;
    }
    return true;
  });

  var enriched = filtered.map(function(c){
    var p = coPriorityScore(c.id);
    return {
      company: c,
      score: p.score,
      reason: p.reason,
      activeCount: coGetActiveTasksForCompany(c.id).length,
      overdueCount: coGetOverdueCountForCompany(c.id),
      nearestDue: coGetNearestDueForCompany(c.id),
      visitDate: coGetVisitDate(c.id),
    };
  });

  if (coSortMode === 'priority') {
    enriched.sort(function(a, b){
      if (b.score !== a.score) return b.score - a.score;
      return (a.company.name || '').localeCompare(b.company.name || '');
    });
  } else if (coSortMode === 'tasks') {
    enriched.sort(function(a, b){
      if (b.overdueCount !== a.overdueCount) return b.overdueCount - a.overdueCount;
      if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount;
      return (a.company.name || '').localeCompare(b.company.name || '');
    });
  } else if (coSortMode === 'visit') {
    var today = new Date(new Date().toDateString());
    enriched.sort(function(a, b){
      var da = a.visitDate, db = b.visitDate;
      if (!da && !db) return (a.company.name || '').localeCompare(b.company.name || '');
      if (!da) return 1;
      if (!db) return -1;
      var dA = new Date(da), dB = new Date(db);
      var aPast = dA < today, bPast = dB < today;
      if (aPast !== bPast) return aPast ? 1 : -1;
      if (!aPast) return dA - dB;
      return dB - dA;
    });
  } else {
    enriched.sort(function(a, b){ return (a.company.name || '').localeCompare(b.company.name || ''); });
  }

  return enriched;
}

function coUpdateSort(val) { coSortMode = val; coCurrentPage = 1; renderCompanies(); }
function coUpdateSearch() { coCurrentPage = 1; renderCompanies(); }
function coUpdateFilter() { coCurrentPage = 1; renderCompanies(); }
function coGoToPage(page) { coCurrentPage = page; renderCompanies(); }

// ===== RENDER =====
function renderCompanies() {
  var root = document.getElementById('companiesContainer');
  if (!root) return;

  var controlsHtml = '<div class="filters" style="margin-bottom:12px;gap:8px;display:flex;flex-wrap:wrap;align-items:center">';
  controlsHtml += '<label style="font-size:11px;color:var(--ink-mute);font-weight:600;text-transform:uppercase">Sort:</label>';
  controlsHtml += '<select class="filter-select" id="companySortSelect" onchange="coUpdateSort(this.value)">';
  controlsHtml += '<option value="priority"' + (coSortMode === 'priority' ? ' selected' : '') + '>Priority (smart)</option>';
  controlsHtml += '<option value="tasks"' + (coSortMode === 'tasks' ? ' selected' : '') + '>By tasks (overdue first)</option>';
  controlsHtml += '<option value="visit"' + (coSortMode === 'visit' ? ' selected' : '') + '>By visit date (soonest first)</option>';
  controlsHtml += '<option value="alpha"' + (coSortMode === 'alpha' ? ' selected' : '') + '>Alphabetical</option>';
  controlsHtml += '</select>';
  controlsHtml += '<label style="font-size:11px;color:var(--ink-mute);font-weight:600;text-transform:uppercase;margin-left:8px">Tasks:</label>';
  controlsHtml += '<select class="filter-select" id="filterCompanyActiveTasks" onchange="coUpdateFilter()">';
  var currentTasksFilter = document.getElementById('filterCompanyActiveTasks')?.value || '';
  controlsHtml += '<option value=""' + (currentTasksFilter === '' ? ' selected' : '') + '>All companies</option>';
  controlsHtml += '<option value="with"' + (currentTasksFilter === 'with' ? ' selected' : '') + '>With active tasks</option>';
  controlsHtml += '<option value="without"' + (currentTasksFilter === 'without' ? ' selected' : '') + '>No active tasks</option>';
  controlsHtml += '</select>';
  controlsHtml += '</div>';

  var ranked = coFilterAndSortCompanies();

  if (ranked.length === 0) {
    root.innerHTML = controlsHtml + '<div class="empty"><h3>No companies match</h3><p>Try clearing filters or searching for something else.</p></div>';
    return;
  }

  var totalPages = Math.max(1, Math.ceil(ranked.length / CO_PAGE_SIZE));
  if (coCurrentPage > totalPages) coCurrentPage = totalPages;
  if (coCurrentPage < 1) coCurrentPage = 1;
  var startIdx = (coCurrentPage - 1) * CO_PAGE_SIZE;
  var endIdx = Math.min(startIdx + CO_PAGE_SIZE, ranked.length);
  var pageSlice = ranked.slice(startIdx, endIdx);

  var sortLabel = coSortMode === 'priority' ? 'priority'
    : coSortMode === 'tasks' ? 'task activity'
    : coSortMode === 'visit' ? 'visit date'
    : 'alphabetical';

  var summary = '<div style="font-size:12px;color:var(--ink-mute);margin-bottom:10px">';
  summary += 'Showing <strong>' + (startIdx + 1) + '\u2013' + endIdx + '</strong> of ' + ranked.length + ' compan' + (ranked.length !== 1 ? 'ies' : 'y');
  summary += ' \u00b7 sorted by ' + sortLabel;
  summary += '</div>';

  var listHtml = '';
  if (state.view === 'cards') {
    listHtml = '<div class="company-grid">' + pageSlice.map(function(entry){
      var c = entry.company;
      var reason = entry.reason;
      var nv = coFormatNextVisit(c.id);
      var lastVisit = state.visits.filter(function(v){ return v.companyId === c.id; }).sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); })[0];
      var taskCount = state.tasks.filter(function(t){ return t.companyId === c.id; }).length;
      var webLink = companyWebsiteLinkHtml(c);
      var html = '<div class="company-card" onclick="openCompanyModal(\'' + c.id + '\')">';
      // Name with inline website globe icon
      html += '<div class="company-card-name" style="display:flex;align-items:center;flex-wrap:wrap">' + esc(c.name) + webLink + '</div>';
      html += '<div class="company-card-industry">' + esc(c.industry || '—') + (c.size ? ' \u00b7 ' + esc(c.size) : '') + '</div>';
      html += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:4px 0">';
      html += '<span class="status-pill status-' + (c.status || 'Prospect') + '">' + (c.status || 'Prospect') + '</span>';
      if (entry.activeCount > 0) {
        var badgeColor = entry.overdueCount > 0 ? 'var(--red)' : 'var(--accent)';
        html += '<span style="font-size:10px;padding:2px 8px;border-radius:12px;background:var(--bg-sunken);color:' + badgeColor + ';font-weight:600;border:1px solid ' + badgeColor + '">';
        html += entry.activeCount + ' active';
        if (entry.overdueCount > 0) html += ' \u00b7 ' + entry.overdueCount + ' overdue';
        html += '</span>';
      }
      html += '</div>';
      if (reason && reason.label) {
        html += '<div style="font-size:11px;color:var(--ink-soft);margin:4px 0;font-weight:500">' + reason.icon + ' ' + esc(reason.label) + '</div>';
      }
      html += '<div class="company-card-row"><span>Last interaction</span><span>' + (c.lastInteraction ? formatDate(c.lastInteraction) : '—') + '</span></div>';
      html += '<div class="company-card-row"><span>Next visit</span><span style="color:' + nv.color + ';font-weight:500">' + esc(nv.text) + '</span></div>';
      html += '<div class="company-card-row"><span>' + taskCount + ' task' + (taskCount !== 1 ? 's' : '') + '</span><span>' + (lastVisit ? esc(lastVisit.type) : '') + '</span></div>';
      html += '</div>';
      return html;
    }).join('') + '</div>';
  } else {
    listHtml = '<div class="company-table"><table>';
    listHtml += '<thead><tr><th>Company</th><th>Status</th><th>Contact</th><th>Phone</th><th>Next visit</th><th>Last interaction</th><th>Owner</th><th>Tasks</th><th>Priority</th></tr></thead>';
    listHtml += '<tbody>' + pageSlice.map(function(entry){
      var c = entry.company;
      var reason = entry.reason;
      var nv = coFormatNextVisit(c.id);
      var webLink = companyWebsiteLinkHtml(c);
      var taskCellHtml;
      if (entry.activeCount > 0) {
        var color = entry.overdueCount > 0 ? 'var(--red)' : 'var(--accent)';
        taskCellHtml = '<span style="color:' + color + ';font-weight:600">' + entry.activeCount + ' active';
        if (entry.overdueCount > 0) taskCellHtml += ' \u00b7 ' + entry.overdueCount + ' overdue';
        taskCellHtml += '</span>';
      } else {
        taskCellHtml = '<span style="color:var(--ink-mute)">—</span>';
      }
      var reasonCellHtml = reason && reason.label
        ? '<span style="font-size:11px;color:var(--ink-soft)">' + reason.icon + ' ' + esc(reason.label) + '</span>'
        : '<span style="color:var(--ink-mute)">—</span>';
      var row = '<tr onclick="openCompanyModal(\'' + c.id + '\')">';
      // Name cell with inline website globe
      row += '<td><div class="company-name-cell" style="display:flex;align-items:center">' + esc(c.name) + webLink + '</div><div class="company-industry">' + esc(c.industry || '') + '</div></td>';
      row += '<td><span class="status-pill status-' + (c.status || 'Prospect') + '">' + (c.status || 'Prospect') + '</span></td>';
      row += '<td>' + esc(c.contact || '—') + '</td>';
      row += '<td>' + esc(c.phone || '—') + '</td>';
      row += '<td style="color:' + nv.color + ';font-weight:500">' + esc(nv.text) + '</td>';
      row += '<td>' + (c.lastInteraction ? formatDate(c.lastInteraction) : '—') + '</td>';
      row += '<td>' + esc(c.owner || '—') + '</td>';
      row += '<td>' + taskCellHtml + '</td>';
      row += '<td>' + reasonCellHtml + '</td>';
      row += '</tr>';
      return row;
    }).join('') + '</tbody></table></div>';
  }

  var paginationHtml = '';
  if (totalPages > 1) {
    paginationHtml = '<div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:20px;padding:12px">';
    if (coCurrentPage > 1) {
      paginationHtml += '<button class="btn btn-sm" onclick="coGoToPage(' + (coCurrentPage - 1) + ')">\u2190 Previous</button>';
    } else {
      paginationHtml += '<button class="btn btn-sm" disabled style="opacity:0.4;cursor:not-allowed">\u2190 Previous</button>';
    }
    paginationHtml += '<span style="font-size:12px;color:var(--ink-mute);font-weight:500">Page ' + coCurrentPage + ' of ' + totalPages + '</span>';
    if (coCurrentPage < totalPages) {
      paginationHtml += '<button class="btn btn-sm" onclick="coGoToPage(' + (coCurrentPage + 1) + ')">Next \u2192</button>';
    } else {
      paginationHtml += '<button class="btn btn-sm" disabled style="opacity:0.4;cursor:not-allowed">Next \u2192</button>';
    }
    paginationHtml += '</div>';
  }

  root.innerHTML = controlsHtml + summary + listHtml + paginationHtml;
}

function openCompanyModal(id) {
  state.editingCompany = id ? state.companies.find(c=>c.id===id) : null;
  const c = state.editingCompany || { id: newId('CO'), name:'', industry:'', size:'', makes:'', address:'', contact:'', phone:'', email:'', website:'', linkedin:'', status:'Prospect', value:'', owner:'Prrithive', lastInteraction:'', notes:'', createdAt: nowIso() };
  document.getElementById('companyModalTitle').textContent = id ? 'Edit company' : 'New company';
  const fieldMap = {
    Name: 'name', Industry: 'industry', Size: 'size', Makes: 'makes', Address: 'address',
    Contact: 'contact', Phone: 'phone', Email: 'email', Website: 'website',
    LinkedIn: 'linkedin', Status: 'status', Value: 'value', Owner: 'owner',
    Last: 'lastInteraction', Notes: 'notes'
  };
  Object.keys(fieldMap).forEach(suffix => {
    const el = document.getElementById('c' + suffix);
    if (el) el.value = c[fieldMap[suffix]] || '';
  });
  document.getElementById('cDelete').style.display = id ? 'inline-flex' : 'none';
  document.getElementById('visitSection').style.display = id ? 'block' : 'none';
  if(id) renderVisitsForCompany(id);
  if(id && c.name) renderCompanyFiles(c.name);
  if(!id) state.editingCompany = c;
  document.getElementById('companyModal').classList.add('open');
  setTimeout(()=>document.getElementById('cName').focus(), 50);
}
function closeCompanyModal() { document.getElementById('companyModal').classList.remove('open'); state.editingCompany = null; }

async function saveCompany() {
  const c = state.editingCompany; if(!c) { closeCompanyModal(); return; }
  c.name = document.getElementById('cName').value.trim();
  if(!c.name) { toast('Company name required', true); return; }
  c.industry = document.getElementById('cIndustry').value; c.size = document.getElementById('cSize').value;
  c.makes = document.getElementById('cMakes').value; c.address = document.getElementById('cAddress').value;
  c.contact = document.getElementById('cContact').value; c.phone = document.getElementById('cPhone').value;
  c.email = document.getElementById('cEmail').value; c.website = document.getElementById('cWebsite').value;
  c.linkedin = document.getElementById('cLinkedIn').value; c.status = document.getElementById('cStatus').value;
  c.value = document.getElementById('cValue').value; c.owner = document.getElementById('cOwner').value;
  c.lastInteraction = document.getElementById('cLast').value; c.notes = document.getElementById('cNotes').value;
  c.updatedAt = nowIso();
  const idx = state.companies.findIndex(x=>x.id===c.id);
  if(idx >= 0) state.companies[idx] = c; else state.companies.push(c);
  refreshAll(); closeCompanyModal();
  try { await upsertRow(SHEET_TABS.companies, COMPANY_COLS, c); toast('Saved'); cacheLocal(); }
  catch(e) { toast('Saved locally — sync failed', true); }
}

async function deleteCompany() {
  const c = state.editingCompany;
  if (!c) return;

  const linkedTasks = state.tasks.filter(t => t.companyId === c.id);
  const linkedVisits = state.visits.filter(v => v.companyId === c.id);
  const linkedPrep = state.visitPreps.filter(p => p.companyId === c.id);

  let msg = `Delete ${c.name}?`;
  const effects = [];
  if (linkedTasks.length) effects.push(`Archive ${linkedTasks.length} linked task${linkedTasks.length !== 1 ? 's' : ''} (recoverable from Archive tab)`);
  if (linkedVisits.length) effects.push(`Permanently delete ${linkedVisits.length} visit${linkedVisits.length !== 1 ? 's' : ''}`);
  if (linkedPrep.length) effects.push(`Permanently delete visit prep data`);
  if (effects.length) {
    msg += '\n\nThis will also:\n• ' + effects.join('\n• ');
  }
  if (!confirm(msg)) return;

  closeCompanyModal();

  let taskErrors = 0;
  for (const t of linkedTasks) {
    try { await archiveTask(t.id, 'company_deleted'); }
    catch (e) { console.error('Cascade archive failed for task', t.id, e); taskErrors++; }
  }

  let visitErrors = 0;
  for (const v of linkedVisits) {
    try {
      state.visits = state.visits.filter(x => x.id !== v.id);
      await deleteRowById(SHEET_TABS.visits, v.id);
    } catch (e) { console.error('Cascade delete failed for visit', v.id, e); visitErrors++; }
  }

  let prepErrors = 0;
  for (const p of linkedPrep) {
    try {
      state.visitPreps = state.visitPreps.filter(x => x.id !== p.id);
      await deleteRowById(SHEET_TABS.visitprep, p.id);
    } catch (e) { console.error('Cascade delete failed for visit prep', p.id, e); prepErrors++; }
  }

  state.companies = state.companies.filter(x => x.id !== c.id);
  try { await deleteRowById(SHEET_TABS.companies, c.id); }
  catch (e) { toast('Company delete failed remotely', true); console.error(e); }

  refreshAll();
  cacheLocal();

  const totalErrors = taskErrors + visitErrors + prepErrors;
  if (totalErrors === 0) {
    toast(`Deleted ${c.name} and all linked data`);
  } else {
    toast(`Deleted ${c.name} — ${totalErrors} linked item${totalErrors !== 1 ? 's' : ''} failed to sync`, true);
  }
}

function openTaskModalForCompany() { if(!state.editingCompany) return; state.taskForCompany = state.editingCompany.id; closeCompanyModal(); openTaskModal(); }
