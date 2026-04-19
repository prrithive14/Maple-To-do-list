/* visits.js — Visit CRUD */

function renderVisitsForCompany(companyId) {
  const visits = state.visits.filter(v=>v.companyId===companyId).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const list = document.getElementById('visitList');
  list.innerHTML = visits.length ? visits.map(v => `<div class="visit-item" onclick="openVisitModal('${v.id}')">
    <div class="visit-head"><span class="visit-date">${formatDate(v.date)} · ${esc(v.outcome||'')}</span><span class="visit-type">${esc(v.type||'')}</span></div>
    ${v.notes?`<div class="visit-notes">${esc(v.notes)}</div>`:''}
    ${v.nextStep?`<div class="visit-next">→ ${esc(v.nextStep)}</div>`:''}
    <div style="font-size:11px;color:var(--ink-mute);margin-top:6px">Logged by ${esc(v.loggedBy||'—')}</div></div>`).join('') : '<div class="empty-mini">No visits logged yet</div>';
  const tasks = state.tasks.filter(t=>t.companyId===companyId);
  document.getElementById('linkedTasks').innerHTML = tasks.length ? tasks.map(t => `<div class="linked-task" onclick="closeCompanyModal();openTaskModal('${t.id}')">
    <span class="status-pill status-${t.status==='Done'?'Won':'Prospect'}">${esc(t.status)}</span><span>${esc(t.name)}</span>
    ${t.date?`<span style="margin-left:auto;font-size:11px;color:var(--ink-mute)">${formatDate(t.date)}</span>`:''}</div>`).join('') : '<div class="empty-mini">No linked tasks</div>';
}

function openVisitModal(id) {
  state.editingVisit = id ? state.visits.find(v=>v.id===id) : null;
  const c = state.editingCompany;
  const v = state.editingVisit || { id: newId('VIS'), companyId: c?c.id:'', date: new Date().toISOString().slice(0,10), type: 'In-person', outcome: 'Positive', notes:'', nextStep:'', loggedBy:'Prrithive', createdAt: nowIso() };
  document.getElementById('vDate').value = v.date||''; document.getElementById('vType').value = v.type||'In-person';
  document.getElementById('vOutcome').value = v.outcome||'Positive'; document.getElementById('vNotes').value = v.notes||'';
  document.getElementById('vNext').value = v.nextStep||''; document.getElementById('vBy').value = v.loggedBy||'Prrithive';
  document.getElementById('vDelete').style.display = id ? 'inline-flex' : 'none';
  if(!id) state.editingVisit = v;
  document.getElementById('visitModal').classList.add('open');
}
function closeVisitModal() { document.getElementById('visitModal').classList.remove('open'); state.editingVisit = null; if(state.editingCompany) renderVisitsForCompany(state.editingCompany.id); }

async function saveVisit() {
  const v = state.editingVisit; if(!v) { closeVisitModal(); return; }
  v.date = document.getElementById('vDate').value; v.type = document.getElementById('vType').value;
  v.outcome = document.getElementById('vOutcome').value; v.notes = document.getElementById('vNotes').value;
  v.nextStep = document.getElementById('vNext').value; v.loggedBy = document.getElementById('vBy').value;
  const idx = state.visits.findIndex(x=>x.id===v.id);
  if(idx >= 0) state.visits[idx] = v; else state.visits.push(v);
  if(state.editingCompany && v.date) {
    state.editingCompany.lastInteraction = v.date;
    if(state.editingCompany.status === 'Prospect') state.editingCompany.status = 'Visited';
    document.getElementById('cLast').value = v.date; document.getElementById('cStatus').value = state.editingCompany.status;
  }
  closeVisitModal(); refreshAll();
  try { await upsertRow(SHEET_TABS.visits, VISIT_COLS, v);
    if(state.editingCompany) await upsertRow(SHEET_TABS.companies, COMPANY_COLS, state.editingCompany);
    toast('Visit logged'); cacheLocal();
  } catch(e) { toast('Saved locally — sync failed', true); }
}

async function deleteVisit() {
  const v = state.editingVisit; if(!v || !confirm('Delete this visit?')) return;
  state.visits = state.visits.filter(x=>x.id!==v.id);
  closeVisitModal(); refreshAll();
  try { await deleteRowById(SHEET_TABS.visits, v.id); toast('Deleted'); } catch(e) { toast('Delete failed remotely', true); }
}
