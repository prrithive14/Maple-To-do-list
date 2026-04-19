/* visitprep.js — Visit Prep with search, filters, visit date, per-item notes/files, PDF */

var VISIT_PREP_PARTS = [
  { title: "Company Research & Strategy", icon: "\ud83d\udd0d", color: "#6366F1",
    items: ["Research the company (size, industry, recent news)","Identify their key products and manufacturing processes","Identify which Maple MPSS services fit (sourcing, CAD, placement engineers, documentation)","List what we will NOT pitch (show we have done our homework)","Identify the decision-maker and right contact","Rate the opportunity (worth pursuing or skip with reason)"] },
  { title: "Preparation Before Visit", icon: "\ud83d\udccb", color: "#F59E0B",
    items: ["Prepare a cold call script tailored to their business","Make the cold call - book the visit or agree to send info","Log the cold call notes","Use AI to create a brochure customized to their company","Review, print, and prepare a digital copy of the brochure","Confirm the meeting 24 hours before","Pack materials: business cards, brochure, notebook"] },
  { title: "Visit Notes & Debrief", icon: "\ud83d\udc68\u200d\ud83d\udc66", color: "#3ECF8E",
    items: ["Who did you meet and what is their role?","What problems do they have that we can solve?","What objections came up?","How interested are they? (Hot / Warm / Cold)","Do we need to adjust pricing or approach?","What is the agreed next step and timeline?","What would you do differently next time?"] }
];
var VP_TOTAL = VISIT_PREP_PARTS.reduce(function(s,p){return s+p.items.length;},0);
var VP_LEADS = [{label:"Hot",emoji:"\ud83d\udd25",color:"#F87171"},{label:"Warm",emoji:"\ud83c\udf24",color:"#FBBF24"},{label:"Cold",emoji:"\u2744\ufe0f",color:"#60A5FA"}];
var vpActiveId = null, vpExpanded = null;
var vpSearchText = '', vpFilterLead = '', vpFilterProgress = '';

function getVP(cid){return state.visitPreps.find(function(v){return v.companyId===cid;});}
function getVPChecks(cid){var v=getVP(cid);if(!v||!v.checks)return[];try{return JSON.parse(v.checks);}catch(e){return[];}}
function getVPNotes(cid){var v=getVP(cid);if(!v||!v.notes)return{};try{var p=JSON.parse(v.notes);return typeof p==='object'&&p!==null?p:{};}catch(e){return typeof v.notes==='string'?{_general:v.notes}:{};}}
function getVPLead(cid){var v=getVP(cid);return v?v.leadRating||'':'';}
function getVPVisitDate(cid){var v=getVP(cid);return v?v.visitDate||'':'';}
function isVPC(cid,pi,ii){return getVPChecks(cid).indexOf(pi+'-'+ii)!==-1;}
function getVPItemNote(cid,pi,ii){return getVPNotes(cid)[pi+'-'+ii]||'';}
function getVPGenNotes(cid){return getVPNotes(cid)._general||'';}
function vpProg(cid){var c=getVPChecks(cid);return Math.round((c.length/VP_TOTAL)*100);}
function vpPartProg(cid,pi){var c=getVPChecks(cid),p=VISIT_PREP_PARTS[pi],d=0;p.items.forEach(function(_,ii){if(c.indexOf(pi+'-'+ii)!==-1)d++;});return{done:d,total:p.items.length};}
function vpHasNote(cid,pi,ii){return(getVPItemNote(cid,pi,ii)).length>0;}

async function vpSave(cid,upd){
  var v=getVP(cid);
  if(v){Object.keys(upd).forEach(function(k){v[k]=upd[k];});v.updatedAt=nowIso();await upsertRow(SHEET_TABS.visitprep,VISITPREP_COLS,v);}
  else{var n={companyId:cid,checks:upd.checks||'[]',notes:upd.notes||'{}',leadRating:upd.leadRating||'',visitDate:upd.visitDate||'',updatedAt:nowIso()};state.visitPreps.push(n);await upsertRow(SHEET_TABS.visitprep,VISITPREP_COLS,n);}
  cacheLocal();
}
async function vpToggleCheck(cid,pi,ii){var c=getVPChecks(cid),k=pi+'-'+ii,i=c.indexOf(k);if(i!==-1)c.splice(i,1);else c.push(k);await vpSave(cid,{checks:JSON.stringify(c)});vpRenderChecklist(cid);}
async function vpSetLead(cid,l){var cur=getVPLead(cid);await vpSave(cid,{leadRating:cur===l?'':l});vpRenderChecklist(cid);}
async function vpSetVisitDate(cid){var inp=document.getElementById('vpVisitDate');if(!inp)return;await vpSave(cid,{visitDate:inp.value});toast('Visit date saved');}
async function vpSaveItemNote(cid,pi,ii){var ta=document.getElementById('vpN-'+pi+'-'+ii);if(!ta)return;var n=getVPNotes(cid);n[pi+'-'+ii]=ta.value;await vpSave(cid,{notes:JSON.stringify(n)});toast('Note saved');}
async function vpSaveGenNotes(cid){var ta=document.getElementById('vpGen');if(!ta)return;var n=getVPNotes(cid);n._general=ta.value;await vpSave(cid,{notes:JSON.stringify(n)});toast('Notes saved');}

function vpExpand(pi,ii){var k=pi+'-'+ii;vpExpanded=(vpExpanded===k)?null:k;vpRenderChecklist(vpActiveId);
  if(vpExpanded===k&&vpActiveId){var co=state.companies.find(function(c){return c.id===vpActiveId;});if(co){renderVPItemFiles(co.name,VISIT_PREP_PARTS[pi].items[ii],'vpF-'+pi+'-'+ii);}}
}
function vpFileBtn(pi,ii){var inp=document.getElementById('vpFI-'+pi+'-'+ii);if(inp)inp.click();}
async function vpFileUpload(pi,ii,inp){if(!vpActiveId)return;var co=state.companies.find(function(c){return c.id===vpActiveId;});if(!co)return;await handleVPItemFileUpload(inp.files,co.name,VISIT_PREP_PARTS[pi].items[ii],'vpF-'+pi+'-'+ii);inp.value='';}

function vpUpdateSearch(){var el=document.getElementById('vpSearch');vpSearchText=el?el.value.toLowerCase():'';renderVisitPrep();}
function vpUpdateFilterLead(val){vpFilterLead=val;renderVisitPrep();}
function vpUpdateFilterProgress(val){vpFilterProgress=val;renderVisitPrep();}

function vpGetFilteredCompanies(){
  var cos=state.companies.slice();
  // Filter by search
  if(vpSearchText){cos=cos.filter(function(c){return(c.name||'').toLowerCase().indexOf(vpSearchText)!==-1||(c.contact||'').toLowerCase().indexOf(vpSearchText)!==-1||(c.industry||'').toLowerCase().indexOf(vpSearchText)!==-1;});}
  // Filter by lead
  if(vpFilterLead){cos=cos.filter(function(c){return getVPLead(c.id)===vpFilterLead;});}
  // Filter by progress
  if(vpFilterProgress==='not-started'){cos=cos.filter(function(c){return vpProg(c.id)===0;});}
  else if(vpFilterProgress==='in-progress'){cos=cos.filter(function(c){var p=vpProg(c.id);return p>0&&p<100;});}
  else if(vpFilterProgress==='complete'){cos=cos.filter(function(c){return vpProg(c.id)===100;});}
  // Sort: upcoming visit dates first, then no date
  cos.sort(function(a,b){
    var da=getVPVisitDate(a.id),db=getVPVisitDate(b.id);
    if(da&&db)return da.localeCompare(db);
    if(da)return -1;if(db)return 1;
    return(a.name||'').localeCompare(b.name||'');
  });
  return cos;
}

function renderVisitPrep(){
  var root=document.getElementById('visitPrepContainer');if(!root)return;
  if(vpActiveId){vpRenderChecklist(vpActiveId);return;}
  if(state.companies.length===0){root.innerHTML='<div class="empty"><h3>No companies yet</h3><p>Add companies in the Companies tab first.</p></div>';return;}

  var h='<div style="margin-bottom:16px"><h2 style="font-family:\'Fraunces\',serif;font-size:20px;font-weight:600;margin:0">Visit Preparation</h2></div>';

  // Search + Filters
  h+='<div class="filters" style="margin-bottom:16px">';
  h+='<input class="search-input" id="vpSearch" placeholder="Search companies..." value="'+esc(vpSearchText)+'" oninput="vpUpdateSearch()">';
  h+='<select class="filter-select" onchange="vpUpdateFilterLead(this.value)">';
  h+='<option value=""'+(vpFilterLead===''?' selected':'')+'>All leads</option>';
  VP_LEADS.forEach(function(o){h+='<option value="'+o.label+'"'+(vpFilterLead===o.label?' selected':'')+'>'+o.emoji+' '+o.label+'</option>';});
  h+='<option value="none"'+(vpFilterLead==='none'?' selected':'')+'>Not rated</option>';
  h+='</select>';
  h+='<select class="filter-select" onchange="vpUpdateFilterProgress(this.value)">';
  h+='<option value=""'+(vpFilterProgress===''?' selected':'')+'>All progress</option>';
  h+='<option value="not-started"'+(vpFilterProgress==='not-started'?' selected':'')+'>Not started</option>';
  h+='<option value="in-progress"'+(vpFilterProgress==='in-progress'?' selected':'')+'>In progress</option>';
  h+='<option value="complete"'+(vpFilterProgress==='complete'?' selected':'')+'>Complete</option>';
  h+='</select></div>';

  var cos=vpGetFilteredCompanies();
  if(cos.length===0){
    h+='<div class="empty-mini">No companies match your filters</div>';
    root.innerHTML=h;return;
  }

  h+='<div style="display:flex;flex-direction:column;gap:10px">';
  cos.forEach(function(c){
    var pr=vpProg(c.id),ld=getVPLead(c.id),lo=VP_LEADS.find(function(o){return o.label===ld;}),vd=getVPVisitDate(c.id);
    h+='<div class="company-card" onclick="vpActiveId=\''+c.id+'\';vpExpanded=null;renderVisitPrep()" style="padding:14px">';
    h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">';
    h+='<span style="font-weight:600;font-size:15px;flex:1">'+esc(c.name)+'</span>';
    if(lo)h+='<span style="padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600;color:'+lo.color+';border:1px solid '+lo.color+'">'+lo.emoji+' '+lo.label+'</span>';
    h+='<span style="font-size:12px;font-weight:600;color:'+(pr===100?'var(--green)':'var(--ink-mute)')+'">'+pr+'%</span></div>';

    // Meta row: contact, industry, visit date
    h+='<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">';
    if(c.contact)h+='<span style="font-size:11px;color:var(--ink-soft);background:var(--bg-sunken);padding:2px 8px;border-radius:12px">'+esc(c.contact)+'</span>';
    if(c.industry)h+='<span style="font-size:11px;color:var(--ink-soft);background:var(--bg-sunken);padding:2px 8px;border-radius:12px">'+esc(c.industry)+'</span>';
    if(vd){
      var isUpcoming=vd>=new Date().toISOString().slice(0,10);
      h+='<span style="font-size:11px;color:'+(isUpcoming?'var(--accent)':'var(--ink-mute)')+';background:'+(isUpcoming?'rgba(184,69,31,0.08)':'var(--bg-sunken)')+';padding:2px 8px;border-radius:12px;font-weight:500">\ud83d\udcc5 '+formatDate(vd)+'</span>';
    }
    h+='</div>';

    // Progress bars
    h+='<div style="display:flex;gap:8px">';
    VISIT_PREP_PARTS.forEach(function(part,pi){var pp=vpPartProg(c.id,pi);
      h+='<div style="flex:1"><div style="display:flex;justify-content:space-between;margin-bottom:3px">';
      h+='<span style="font-size:9px;color:var(--ink-mute);font-weight:600">'+part.icon+' '+part.title.split(' ')[0]+'</span>';
      h+='<span style="font-size:9px;color:'+(pp.done===pp.total&&pp.done>0?part.color:'var(--ink-mute)')+'">'+pp.done+'/'+pp.total+'</span></div>';
      h+='<div style="height:3px;background:var(--line);border-radius:2px;overflow:hidden"><div style="height:100%;width:'+(pp.total>0?(pp.done/pp.total)*100:0)+'%;background:'+part.color+';border-radius:2px"></div></div></div>';
    });
    h+='</div></div>';
  });
  h+='</div>';
  root.innerHTML=h;
}

function vpRenderChecklist(cid){
  var root=document.getElementById('visitPrepContainer');if(!root)return;
  var co=state.companies.find(function(c){return c.id===cid;});if(!co){vpActiveId=null;renderVisitPrep();return;}
  var pr=vpProg(cid),ld=getVPLead(cid),gn=getVPGenNotes(cid),vd=getVPVisitDate(cid);

  var h='<button class="btn btn-sm" onclick="vpActiveId=null;vpExpanded=null;renderVisitPrep()" style="margin-bottom:16px">&larr; All Companies</button>';

  // Header card
  h+='<div style="background:var(--bg-card);border:1px solid var(--line);border-radius:var(--radius-lg);padding:16px;margin-bottom:16px">';
  h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">';
  h+='<h2 style="font-family:\'Fraunces\',serif;font-size:20px;font-weight:600;margin:0;flex:1">'+esc(co.name)+'</h2>';
  h+='<button class="btn btn-sm" onclick="vpPDF(\''+cid+'\')">&#128196; PDF</button></div>';

  if(co.contact||co.industry){h+='<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">';
    if(co.contact)h+='<span style="font-size:11px;color:var(--green);background:rgba(74,124,78,0.1);padding:2px 10px;border-radius:12px">'+esc(co.contact)+'</span>';
    if(co.industry)h+='<span style="font-size:11px;color:var(--blue);background:rgba(74,108,138,0.1);padding:2px 10px;border-radius:12px">'+esc(co.industry)+'</span>';
    h+='</div>';}

  // Visit date
  h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">';
  h+='<span style="font-size:11px;color:var(--ink-mute);font-weight:600;text-transform:uppercase">Visit Date:</span>';
  h+='<input type="date" id="vpVisitDate" value="'+esc(vd)+'" onchange="vpSetVisitDate(\''+cid+'\')" style="padding:4px 8px;border:1px solid var(--line);border-radius:var(--radius);background:var(--bg-card);color:var(--ink);font-size:12px;font-family:inherit">';
  if(vd){var daysUntil=Math.ceil((new Date(vd)-new Date(new Date().toDateString()))/86400000);
    if(daysUntil>0)h+='<span style="font-size:11px;color:var(--accent);font-weight:500">in '+daysUntil+' day'+(daysUntil!==1?'s':'')+'</span>';
    else if(daysUntil===0)h+='<span style="font-size:11px;color:var(--green);font-weight:600">Today!</span>';
    else h+='<span style="font-size:11px;color:var(--red);font-weight:500">'+Math.abs(daysUntil)+' day'+(Math.abs(daysUntil)!==1?'s':'')+' ago</span>';
  }
  h+='</div>';

  // Progress
  h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><div style="flex:1;height:6px;background:var(--line);border-radius:3px;overflow:hidden">';
  h+='<div style="height:100%;width:'+pr+'%;background:'+(pr===100?'var(--green)':'var(--accent)')+';border-radius:3px;transition:width 0.4s"></div></div>';
  h+='<span style="font-size:12px;font-weight:600;color:'+(pr===100?'var(--green)':'var(--ink-mute)')+'">'+pr+'%</span></div>';

  // Lead
  h+='<div style="display:flex;align-items:center;gap:8px"><span style="font-size:11px;color:var(--ink-mute);font-weight:600;text-transform:uppercase">Lead:</span>';
  VP_LEADS.forEach(function(o){var a=ld===o.label;
    h+='<button onclick="vpSetLead(\''+cid+'\',\''+o.label+'\')" class="btn btn-sm" style="font-size:11px;padding:3px 12px;border-radius:20px;'+(a?'border-color:'+o.color+';color:'+o.color+';font-weight:700':'')+'">'+o.emoji+' '+o.label+'</button>';
  });
  h+='</div></div>';

  // Checklist sections
  VISIT_PREP_PARTS.forEach(function(part,pi){
    var pp=vpPartProg(cid,pi),ad=pp.done===pp.total;
    h+='<div style="background:var(--bg-card);border:1px solid '+(ad?part.color:'var(--line)')+';border-radius:var(--radius-lg);overflow:hidden;margin-bottom:12px">';
    h+='<div style="padding:14px 16px;background:'+part.color+'11;display:flex;align-items:center;gap:10px">';
    h+='<span style="font-size:20px">'+part.icon+'</span><div style="flex:1"><div style="font-size:14px;font-weight:700">'+part.title+'</div>';
    h+='<div style="display:flex;align-items:center;gap:8px;margin-top:4px"><div style="flex:1;max-width:120px;height:3px;background:var(--line);border-radius:2px;overflow:hidden">';
    h+='<div style="height:100%;width:'+(pp.total>0?(pp.done/pp.total)*100:0)+'%;background:'+part.color+';border-radius:2px"></div></div>';
    h+='<span style="font-size:10px;color:'+(ad?part.color:'var(--ink-mute)')+'">'+pp.done+'/'+pp.total+'</span></div></div>';
    if(ad)h+='<span style="padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700;color:'+part.color+';border:1px solid '+part.color+'">DONE</span>';
    h+='</div><div style="padding:4px 0">';

    part.items.forEach(function(item,ii){
      var ck=isVPC(cid,pi,ii),exp=vpExpanded===pi+'-'+ii,hn=vpHasNote(cid,pi,ii),itn=getVPItemNote(cid,pi,ii);
      h+='<div style="border-bottom:1px solid var(--line-soft)">';
      h+='<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 16px;cursor:pointer" onclick="vpExpand('+pi+','+ii+')">';
      h+='<div onclick="event.stopPropagation();vpToggleCheck(\''+cid+'\','+pi+','+ii+')" style="width:20px;height:20px;border-radius:6px;border:2px solid '+(ck?part.color:'var(--ink-mute)')+';background:'+(ck?part.color:'transparent')+';display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;cursor:pointer">';
      if(ck)h+='<span style="color:#fff;font-size:12px;font-weight:900">&check;</span>';
      h+='</div>';
      h+='<span style="font-size:13px;color:'+(ck?'var(--ink-mute)':'var(--ink)')+';text-decoration:'+(ck?'line-through':'none')+';line-height:1.4;flex:1">'+esc(item)+'</span>';
      if(hn)h+='<span style="font-size:10px;color:var(--ink-mute)">&#128221;</span>';
      h+='<span style="font-size:10px;color:var(--ink-mute);transform:rotate('+(exp?'180':'0')+'deg);transition:transform 0.2s">&#9660;</span></div>';

      if(exp){
        h+='<div style="padding:8px 16px 12px 46px;background:var(--bg-sunken)">';
        h+='<div style="margin-bottom:8px"><label style="font-size:10px;color:var(--ink-mute);font-weight:600;text-transform:uppercase;display:block;margin-bottom:4px">Notes</label>';
        h+='<textarea id="vpN-'+pi+'-'+ii+'" onblur="vpSaveItemNote(\''+cid+'\','+pi+','+ii+')" placeholder="Add notes, findings, details..." style="width:100%;min-height:60px;padding:8px;border-radius:var(--radius);border:1px solid var(--line);background:var(--bg-card);color:var(--ink);font-size:12px;font-family:inherit;resize:vertical;outline:none;box-sizing:border-box">'+esc(itn)+'</textarea></div>';
        h+='<div><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">';
        h+='<label style="font-size:10px;color:var(--ink-mute);font-weight:600;text-transform:uppercase">Files</label>';
        h+='<button onclick="vpFileBtn('+pi+','+ii+')" class="btn btn-sm" style="font-size:10px;padding:2px 8px">&#128206; Attach</button>';
        h+='<input type="file" id="vpFI-'+pi+'-'+ii+'" multiple style="display:none" onchange="vpFileUpload('+pi+','+ii+',this)"></div>';
        h+='<div id="vpF-'+pi+'-'+ii+'" style="display:flex;flex-wrap:wrap;gap:4px"></div></div></div>';
      }
      h+='</div>';
    });
    h+='</div></div>';
  });

  // General notes
  h+='<div style="margin-top:4px"><label style="font-size:11px;font-weight:600;color:var(--ink-mute);display:block;margin-bottom:6px;text-transform:uppercase">&#128221; General Notes</label>';
  h+='<textarea id="vpGen" onblur="vpSaveGenNotes(\''+cid+'\')" placeholder="Overall strategy, key takeaways, next steps..." style="width:100%;min-height:80px;padding:12px;border-radius:var(--radius-lg);border:1px solid var(--line);background:var(--bg-card);color:var(--ink);font-size:13px;font-family:inherit;resize:vertical;outline:none;box-sizing:border-box">'+esc(gn)+'</textarea></div>';
  root.innerHTML=h;
}

// PDF Export
function vpPDF(cid){
  var co=state.companies.find(function(c){return c.id===cid;});if(!co)return;
  var pr=vpProg(cid),ld=getVPLead(cid),gn=getVPGenNotes(cid),vd=getVPVisitDate(cid);
  var p='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Visit Prep - '+esc(co.name)+'</title>';
  p+='<style>body{font-family:Arial,sans-serif;color:#1a1a1a;max-width:700px;margin:0 auto;padding:40px 30px;font-size:13px;line-height:1.5}';
  p+='h1{font-size:22px;margin:0 0 4px;color:#b8451f}h2{font-size:15px;margin:24px 0 10px;padding:8px 12px;border-radius:6px}';
  p+='.meta{font-size:12px;color:#666;margin-bottom:16px}.pb{height:8px;background:#e8e2d5;border-radius:4px;margin:8px 0 16px;overflow:hidden}';
  p+='.pf{height:100%;border-radius:4px}.item{padding:6px 0;border-bottom:1px solid #f0ece3}';
  p+='.ir{display:flex;align-items:flex-start;gap:10px}.ck{width:16px;height:16px;border:2px solid #ccc;border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;margin-top:1px}';
  p+='.ck.d{background:#4a7c4e;border-color:#4a7c4e;color:#fff}.dt{text-decoration:line-through;color:#999}';
  p+='.in{margin:4px 0 0 26px;padding:6px 10px;background:#f8f6f1;border-radius:4px;font-size:12px;color:#555;white-space:pre-wrap}';
  p+='.gn{margin-top:20px;padding:12px;background:#f8f6f1;border-radius:6px;white-space:pre-wrap}';
  p+='.ft{margin-top:30px;font-size:10px;color:#999;text-align:center;border-top:1px solid #e8e2d5;padding-top:12px}@media print{body{padding:20px}}</style></head><body>';
  p+='<h1>Maple MPSS - Visit Prep</h1><div class="meta"><strong style="font-size:18px;color:#1a1a1a">'+esc(co.name)+'</strong><br>';
  if(co.contact)p+='Contact: '+esc(co.contact)+'<br>';
  if(co.industry)p+='Industry: '+esc(co.industry)+'<br>';
  if(vd)p+='Visit Date: '+formatDate(vd)+'<br>';
  if(ld){var lo=VP_LEADS.find(function(o){return o.label===ld;});p+='Lead: <span style="padding:3px 12px;border-radius:20px;font-weight:700;font-size:12px;border:1px solid '+(lo?lo.color:'#999')+';color:'+(lo?lo.color:'#999')+'">'+ld+'</span><br>';}
  p+='Progress: '+pr+'% &middot; Generated: '+new Date().toLocaleDateString('en-CA')+'</div>';
  p+='<div class="pb"><div class="pf" style="width:'+pr+'%;background:'+(pr===100?'#4a7c4e':'#b8451f')+'"></div></div>';
  VISIT_PREP_PARTS.forEach(function(part,pi){var pp=vpPartProg(cid,pi);
    p+='<h2 style="background:'+part.color+'15;border-left:4px solid '+part.color+'">'+part.icon+' '+part.title+' <span style="font-size:11px;color:#999;font-weight:400">('+pp.done+'/'+pp.total+')</span></h2>';
    part.items.forEach(function(item,ii){var ck=isVPC(cid,pi,ii),nt=getVPItemNote(cid,pi,ii);
      p+='<div class="item"><div class="ir"><div class="ck'+(ck?' d':'')+'">'+(ck?'&#10003;':'')+'</div>';
      p+='<span'+(ck?' class="dt"':'')+'>'+esc(item)+'</span></div>';
      if(nt)p+='<div class="in">'+esc(nt)+'</div>';
      p+='</div>';
    });
  });
  if(gn)p+='<div class="gn"><strong>General Notes:</strong><br>'+esc(gn)+'</div>';
  p+='<div class="ft">Maple MPSS - Company Visit Preparation Report</div></body></html>';
  var w=window.open('','_blank');w.document.write(p);w.document.close();setTimeout(function(){w.print();},500);
}
