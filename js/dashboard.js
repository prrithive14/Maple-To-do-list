/* dashboard.js — Dashboard stats, personalized "Your plate" panel, and cross-entity rendering */

// Priority order for task ranking within the user plate. Higher index = higher priority.
// Overdue is handled separately (it trumps priority).
var PRIORITY_RANK = { 'Urgent': 4, 'High': 3, 'Medium': 2, 'Low': 1 };

function renderDashboard() {
  // Personalized panel at the top — only renders if a known user is signed in
  renderUserPlate();

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

// ===== PERSONALIZED "YOUR PLATE" PANEL =====
// Shown at the top of the Dashboard. Hidden entirely for Unknown users so unrecognized
// sign-ins don't see a half-working personal view.
function renderUserPlate() {
  var panel = document.getElementById('userPlate');
  if (!panel) return;  // graceful degrade if index.html hasn't been updated

  var me = (typeof getCurrentUser === 'function') ? getCurrentUser() : 'Unknown';
  if (me === 'Unknown') {
    panel.style.display = 'none';
    panel.innerHTML = '';
    return;
  }
  panel.style.display = 'block';

  var today = new Date(new Date().toDateString());

  // ----- Section 1: Waiting on you -----
  // Two sources: (a) pending reviews where I'm the reviewer, (b) changes requested on tasks I own
  var awaitingReview = state.tasks.filter(function(t){
    return t.reviewStatus === 'pending' && t.reviewer === me;
  });
  var awaitingFix = state.tasks.filter(function(t){
    return t.reviewStatus === 'changes_requested' && t.assignee === me;
  });

  // ----- Section 2: Your pending tasks -----
  // Active (Not started / In progress), assigned to me OR Both. Ranked by:
  //   overdue first → priority rank desc → due date asc (sooner first, no-date last) → name
  var myActive = state.tasks.filter(function(t){
    if (t.status !== 'Not started' && t.status !== 'In progress') return false;
    // "Both" assignee counts for everyone
    return t.assignee === me || t.assignee === 'Both';
  });

  myActive.sort(function(a, b){
    var aOverdue = a.date && new Date(a.date) < today;
    var bOverdue = b.date && new Date(b.date) < today;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;  // overdue first
    var aPr = PRIORITY_RANK[a.priority] || 0;
    var bPr = PRIORITY_RANK[b.priority] || 0;
    if (bPr !== aPr) return bPr - aPr;  // higher priority first
    if (a.date && b.date) return a.date.localeCompare(b.date);  // earlier date first
    if (a.date) return -1;  // dated before no-date
    if (b.date) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  var topTen = myActive.slice(0, 10);

  // ----- Section 3: Quick stats -----
  var weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
  var myOpenCount = myActive.length;  // already filtered to me + active statuses
  var myOverdueCount = myActive.filter(function(t){ return t.date && new Date(t.date) < today; }).length;
  var myDoneThisWeek = state.tasks.filter(function(t){
    if (t.status !== 'Done') return false;
    if (t.assignee !== me && t.assignee !== 'Both') return false;
    if (!t.updatedAt) return false;
    return new Date(t.updatedAt) >= weekAgo;
  }).length;

  // ===== Build HTML =====
  var h = '<div style="background:var(--bg-card);border:1px solid var(--line);border-radius:var(--radius-lg);padding:16px 18px;margin-bottom:16px">';

  // Header
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">';
  h += '<h3 style="margin:0;font-family:\'Fraunces\',serif;font-size:18px;font-weight:600">\ud83d\udc4b ' + esc(me) + ', here\'s your plate</h3>';
  h += '<span style="font-size:11px;color:var(--ink-mute)">' + new Date().toLocaleDateString('en-CA', {weekday:'long', month:'short', day:'numeric'}) + '</span>';
  h += '</div>';

  // Quick stats row (Section 3 shown first as a small strip, like the overdue banner)
  h += '<div style="display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap;font-size:13px">';
  h += '<span><strong style="color:var(--ink)">' + myOpenCount + '</strong> <span style="color:var(--ink-mute)">pending</span></span>';
  h += '<span style="color:var(--ink-mute)">\u00b7</span>';
  h += '<span><strong style="color:' + (myOverdueCount > 0 ? 'var(--red)' : 'var(--ink)') + '">' + myOverdueCount + '</strong> <span style="color:var(--ink-mute)">overdue</span></span>';
  h += '<span style="color:var(--ink-mute)">\u00b7</span>';
  h += '<span><strong style="color:var(--green)">' + myDoneThisWeek + '</strong> <span style="color:var(--ink-mute)">done this week</span></span>';
  h += '</div>';

  // Two-column layout: Waiting on you (left) + Your top tasks (right)
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';

  // --- Left column: Waiting on you ---
  h += '<div>';
  h += '<div style="font-size:11px;color:var(--ink-mute);font-weight:600;text-transform:uppercase;margin-bottom:8px">\ud83d\udc41 Waiting on you</div>';
  if (awaitingReview.length === 0 && awaitingFix.length === 0) {
    h += '<div style="font-size:13px;color:var(--ink-soft);padding:8px 0">Nothing waiting on you \ud83c\udf89</div>';
  } else {
    if (awaitingReview.length > 0) {
      h += '<div style="font-size:11px;color:var(--accent);font-weight:500;margin-bottom:4px">Reviews to approve (' + awaitingReview.length + ')</div>';
      awaitingReview.slice(0, 5).forEach(function(t){
        var co = state.companies.find(function(c){ return c.id === t.companyId; });
        h += '<div onclick="switchTab(\'tasks\');setTimeout(function(){openTaskModal(\'' + t.id + '\')},100)" style="display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:3px;border-radius:var(--radius);cursor:pointer;font-size:12px;background:var(--bg-sunken)" onmouseover="this.style.background=\'var(--line)\'" onmouseout="this.style.background=\'var(--bg-sunken)\'">';
        h += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(t.name) + '</span>';
        if (co) h += '<span style="font-size:10px;color:var(--ink-mute)">' + esc(co.name) + '</span>';
        h += '</div>';
      });
      if (awaitingReview.length > 5) h += '<div style="font-size:10px;color:var(--ink-mute);padding:2px 8px">+' + (awaitingReview.length - 5) + ' more</div>';
    }
    if (awaitingFix.length > 0) {
      h += '<div style="font-size:11px;color:var(--red);font-weight:500;margin-top:8px;margin-bottom:4px">Changes requested (' + awaitingFix.length + ')</div>';
      awaitingFix.slice(0, 5).forEach(function(t){
        var co = state.companies.find(function(c){ return c.id === t.companyId; });
        h += '<div onclick="switchTab(\'tasks\');setTimeout(function(){openTaskModal(\'' + t.id + '\')},100)" style="display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:3px;border-radius:var(--radius);cursor:pointer;font-size:12px;background:var(--bg-sunken)" onmouseover="this.style.background=\'var(--line)\'" onmouseout="this.style.background=\'var(--bg-sunken)\'">';
        h += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(t.name) + '</span>';
        if (co) h += '<span style="font-size:10px;color:var(--ink-mute)">' + esc(co.name) + '</span>';
        h += '</div>';
      });
      if (awaitingFix.length > 5) h += '<div style="font-size:10px;color:var(--ink-mute);padding:2px 8px">+' + (awaitingFix.length - 5) + ' more</div>';
    }
  }
  h += '</div>';

  // --- Right column: Your top pending tasks ---
  h += '<div>';
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
  h += '<span style="font-size:11px;color:var(--ink-mute);font-weight:600;text-transform:uppercase">\ud83d\udccb Your top tasks</span>';
  if (myActive.length > 10) h += '<span style="font-size:10px;color:var(--ink-mute)">showing 10 of ' + myActive.length + '</span>';
  h += '</div>';
  if (topTen.length === 0) {
    h += '<div style="font-size:13px;color:var(--ink-soft);padding:8px 0">Nothing pending. Take a break \u2615</div>';
  } else {
    topTen.forEach(function(t){
      var co = state.companies.find(function(c){ return c.id === t.companyId; });
      var overdue = t.date && new Date(t.date) < today;
      var prColor = t.priority === 'Urgent' ? 'var(--red)' : t.priority === 'High' ? 'var(--accent)' : 'var(--ink-mute)';
      h += '<div onclick="switchTab(\'tasks\');setTimeout(function(){openTaskModal(\'' + t.id + '\')},100)" style="display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:3px;border-radius:var(--radius);cursor:pointer;font-size:12px;background:var(--bg-sunken)" onmouseover="this.style.background=\'var(--line)\'" onmouseout="this.style.background=\'var(--bg-sunken)\'">';
      if (t.priority) h += '<span style="font-size:9px;padding:1px 6px;border-radius:8px;color:' + prColor + ';border:1px solid ' + prColor + ';font-weight:600;flex-shrink:0">' + t.priority.charAt(0) + '</span>';
      h += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(t.name) + '</span>';
      if (co) h += '<span style="font-size:10px;color:var(--ink-mute);flex-shrink:0">' + esc(co.name) + '</span>';
      if (t.date) h += '<span style="font-size:10px;color:' + (overdue ? 'var(--red)' : 'var(--ink-mute)') + ';flex-shrink:0;font-weight:' + (overdue ? '600' : '400') + '">' + formatDate(t.date) + '</span>';
      h += '</div>';
    });
  }
  h += '</div>';

  h += '</div>';  // close grid
  h += '</div>';  // close panel

  panel.innerHTML = h;
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
