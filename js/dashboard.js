/* dashboard.js — Dashboard stats and rendering */

function renderDashboard() {
  const stats = computeStats();
  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="stat-label">Total companies</div><div class="stat-value">${stats.totalCompanies}</div><div class="stat-sub">${stats.activeCompanies} active</div></div>
    <div class="stat-card"><div class="stat-label">Pipeline value</div><div class="stat-value">$${stats.pipelineValue.toLocaleString()}</div><div class="stat-sub">across ${stats.pipelineCount} companies</div></div>
    <div class="stat-card"><div class="stat-label">Visits this week</div><div class="stat-value">${stats.visitsThisWeek}</div><div class="stat-sub">${stats.visitsLastWeek} last week</div></div>
    <div class="stat-card"><div class="stat-label">Tasks open</div><div class="stat-value">${stats.openTasks}</div><div class="stat-sub">${stats.overdueTasks} overdue</div></div>
    <div class="stat-card"><div class="stat-label">Response rate</div><div class="stat-value">${stats.responseRate}%</div><div class="stat-sub">visited → quoted+</div></div>
    <div class="stat-card"><div class="stat-label">Win rate</div><div class="stat-value">${stats.winRate}%</div><div class="stat-sub">quoted → won</div></div>`;

  const statuses = ['Prospect','Visited','Quoted','Won','Lost'];
  const counts = statuses.map(s => state.companies.filter(c => (c.status||'Prospect') === s).length);
  const max = Math.max(...counts, 1);
  document.getElementById('funnelChart').innerHTML = statuses.map((s, i) => `<div class="funnel-row"><div class="funnel-label">${s}</div><div class="funnel-bar"><div class="funnel-fill ${s}" style="width:${(counts[i]/max)*100}%">${counts[i]||''}</div></div></div>`).join('');

  const recent = [...state.visits].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0, 8);
  document.getElementById('activityList').innerHTML = recent.length ? recent.map(v => {
    const c = state.companies.find(x=>x.id===v.companyId);
    return `<div class="activity-item"><div class="activity-icon" style="background:var(--bg-card);border:1px solid var(--line)">${v.type==='Call'?'📞':v.type==='Email'?'✉️':v.type==='LinkedIn'?'💼':'🤝'}</div>
      <div class="activity-body"><div class="activity-title">${esc(c?c.name:'Unknown')} — ${esc(v.outcome||v.type)}</div>
      <div class="activity-meta">${formatDate(v.date)} · by ${esc(v.loggedBy||'')}${v.nextStep?' · next: '+esc(v.nextStep):''}</div></div></div>`;
  }).join('') : '<div class="empty-mini">No visits logged yet</div>';

  const withValue = state.companies.filter(c => Number(c.value) > 0).sort((a,b)=>Number(b.value)-Number(a.value)).slice(0, 8);
  document.getElementById('pipelineList').innerHTML = withValue.length ? withValue.map(c => {
    const total = withValue.reduce((s,x)=>s+Number(x.value||0),0); const pct = (Number(c.value)/total)*100;
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:13px">
      <div style="flex:0 0 140px;font-weight:500">${esc(c.name)}</div>
      <div style="flex:1;height:18px;background:var(--bg-sunken);border-radius:var(--radius);position:relative"><div style="width:${pct}%;height:100%;background:var(--accent-soft);border-radius:var(--radius)"></div></div>
      <div style="flex:0 0 80px;text-align:right;font-weight:500">$${Number(c.value).toLocaleString()}</div></div>`;
  }).join('') : '<div class="empty-mini">Add pipeline values to companies to see this chart</div>';

  const today = new Date(); today.setHours(0,0,0,0);
  const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate()+7);
  const due = state.tasks.filter(t => t.date && new Date(t.date) <= weekEnd && t.status !== 'Done').sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  document.getElementById('dueThisWeek').innerHTML = due.length ? due.slice(0,10).map(t => {
    const c = state.companies.find(x=>x.id===t.companyId); const overdue = new Date(t.date) < today;
    return `<div onclick="switchTab('tasks');setTimeout(()=>openTaskModal('${t.id}'),100)" style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:var(--radius);cursor:pointer;font-size:13px" onmouseover="this.style.background='var(--bg-sunken)'" onmouseout="this.style.background=''">
      <span class="status-pill ${overdue?'status-Lost':'status-Visited'}" style="font-size:10px">${formatDate(t.date)}</span><span style="flex:1">${esc(t.name)}</span>
      ${c?`<span style="font-size:11px;color:var(--ink-mute)">${esc(c.name)}</span>`:''}</div>`;
  }).join('') : '<div class="empty-mini">Nothing due this week 🎉</div>';
}

function computeStats() {
  const today = new Date(); today.setHours(0,0,0,0);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate()-7);
  const twoWeeksAgo = new Date(today); twoWeeksAgo.setDate(twoWeeksAgo.getDate()-14);
  const visitsThisWeek = state.visits.filter(v=>v.date && new Date(v.date) >= weekAgo).length;
  const visitsLastWeek = state.visits.filter(v=>{ const d = new Date(v.date); return d >= twoWeeksAgo && d < weekAgo; }).length;
  const visited = state.companies.filter(c=>['Visited','Quoted','Won','Lost'].includes(c.status)).length;
  const quotedPlus = state.companies.filter(c=>['Quoted','Won'].includes(c.status)).length;
  const won = state.companies.filter(c=>c.status==='Won').length;
  const quoted = state.companies.filter(c=>['Quoted','Won','Lost'].includes(c.status)).length;
  return {
    totalCompanies: state.companies.length, activeCompanies: state.companies.filter(c=>c.status!=='Lost').length,
    pipelineValue: state.companies.reduce((s,c)=>s+Number(c.value||0),0),
    pipelineCount: state.companies.filter(c=>Number(c.value)>0).length,
    visitsThisWeek, visitsLastWeek,
    openTasks: state.tasks.filter(t=>t.status!=='Done').length,
    overdueTasks: state.tasks.filter(t=>t.date && new Date(t.date) < today && t.status!=='Done').length,
    responseRate: visited ? Math.round((quotedPlus/visited)*100) : 0,
    winRate: quoted ? Math.round((won/quoted)*100) : 0,
  };
}
