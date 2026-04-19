/* companies.js — Company CRUD, table/card views */

function setCompanyView(v) {
  state.view = v;
  document.getElementById('viewTable').classList.toggle('active', v==='table');
  document.getElementById('viewCards').classList.toggle('active', v==='cards');
  renderCompanies();
}

function renderCompanies() {
  const root = document.getElementById('companiesContainer');
  const search = (document.getElementById('companySearch')?.value||'').toLowerCase();
  const status = document.getElementById('filterCompanyStatus')?.value || '';
  const owner = document.getElementById('filterCompanyOwner')?.value || '';
  const filtered = state.companies.filter(c => {
    if(search && !((c.name||'')+(c.industry||'')+(c.contact||'')).toLowerCase().includes(search)) return false;
    if(status && c.status !== status) return false;
    if(owner && c.owner !== owner) return false;
    return true;
  });
  if(filtered.length === 0) { root.innerHTML = `<div class="empty"><h3>No companies yet</h3><p>Click "+ Add company" to start building your CRM.</p></div>`; return; }
  if(state.view === 'cards') {
    root.innerHTML = `<div class="company-grid">${filtered.map(c => {
      const lastVisit = state.visits.filter(v=>v.companyId===c.id).sort((a,b)=>(b.date||'').localeCompare(a.date||''))[0];
      const taskCount = state.tasks.filter(t=>t.companyId===c.id).length;
      return `<div class="company-card" onclick="openCompanyModal('${c.id}')">
        <div class="company-card-name">${esc(c.name)}</div>
        <div class="company-card-industry">${esc(c.industry||'—')}${c.size?' · '+esc(c.size):''}</div>
        <div><span class="status-pill status-${c.status||'Prospect'}">${c.status||'Prospect'}</span></div>
        <div class="company-card-row"><span>Last interaction</span><span>${c.lastInteraction?formatDate(c.lastInteraction):'—'}</span></div>
        <div class="company-card-row"><span>Pipeline</span><span>${c.value?'$'+Number(c.value).toLocaleString():'—'}</span></div>
        <div class="company-card-row"><span>${taskCount} task${taskCount!==1?'s':''}</span><span>${lastVisit?lastVisit.type:''}</span></div></div>`;
    }).join('')}</div>`;
  } else {
    root.innerHTML = `<div class="company-table"><table>
      <thead><tr><th>Company</th><th>Status</th><th>Contact</th><th>Phone</th><th>Pipeline</th><th>Last interaction</th><th>Owner</th><th>Tasks</th></tr></thead>
      <tbody>${filtered.map(c => {
        const taskCount = state.tasks.filter(t=>t.companyId===c.id).length;
        return `<tr onclick="openCompanyModal('${c.id}')">
          <td><div class="company-name-cell">${esc(c.name)}</div><div class="company-industry">${esc(c.industry||'')}</div></td>
          <td><span class="status-pill status-${c.status||'Prospect'}">${c.status||'Prospect'}</span></td>
          <td>${esc(c.contact||'—')}</td><td>${esc(c.phone||'—')}</td>
          <td>${c.value?'$'+Number(c.value).toLocaleString():'—'}</td>
          <td>${c.lastInteraction?formatDate(c.lastInteraction):'—'}</td>
          <td>${esc(c.owner||'—')}</td><td>${taskCount}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }
}

function openCompanyModal(id) {
  state.editingCompany = id ? state.companies.find(c=>c.id===id) : null;
  const c = state.editingCompany || { id: newId('CO'), name:'', industry:'', size:'', makes:'', address:'', contact:'', phone:'', email:'', website:'', linkedin:'', status:'Prospect', value:'', owner:'Prrithive', lastInteraction:'', notes:'', createdAt: nowIso() };
  document.getElementById('companyModalTitle').textContent = id ? 'Edit company' : 'New company';
  ['Name','Industry','Size','Makes','Address','Contact','Phone','Email','Website','LinkedIn','Status','Value','Owner','Last','Notes'].forEach(k => {
    const map = {Last:'lastInteraction'}; const key = map[k] || k.charAt(0).toLowerCase()+k.slice(1);
    const el = document.getElementById('c'+k); if(el) el.value = c[key]||'';
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
  if(!c || !confirm(`Delete ${c.name}? Linked tasks/visits will remain but be unlinked.`)) return;
  state.companies = state.companies.filter(x=>x.id!==c.id);
  refreshAll(); closeCompanyModal();
  try { await deleteRowById(SHEET_TABS.companies, c.id); toast('Deleted'); } catch(e) { toast('Delete failed remotely', true); }
}

function openTaskModalForCompany() { if(!state.editingCompany) return; state.taskForCompany = state.editingCompany.id; closeCompanyModal(); openTaskModal(); }
