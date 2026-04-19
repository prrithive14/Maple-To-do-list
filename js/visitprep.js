/* visitprep.js — Visit Preparation Checklist with PDF export */

const VISIT_PREP_PARTS = [
  {
    title: "Company Research & Strategy",
    icon: "🔍",
    color: "#6366F1",
    items: [
      "Research the company (size, industry, recent news)",
      "Identify their key products and manufacturing processes",
      "Identify which Maple MPSS services fit (sourcing, CAD, placement engineers, documentation)",
      "List what we will NOT pitch (show we've done our homework)",
      "Identify the decision-maker and right contact",
      "Rate the opportunity (worth pursuing or skip with reason)"
    ]
  },
  {
    title: "Preparation Before Visit",
    icon: "📋",
    color: "#F59E0B",
    items: [
      "Prepare a cold call script tailored to their business",
      "Make the cold call — book the visit or agree to send info",
      "Log the cold call notes",
      "Use AI to create a brochure customized to their company",
      "Review, print, and prepare a digital copy of the brochure",
      "Confirm the meeting 24 hours before",
      "Pack materials: business cards, brochure, notebook"
    ]
  },
  {
    title: "Visit Notes & Debrief",
    icon: "👨‍👦",
    color: "#3ECF8E",
    items: [
      "Who did you meet and what's their role?",
      "What problems do they have that we can solve?",
      "What objections came up?",
      "How interested are they? (Hot / Warm / Cold)",
      "Do we need to adjust pricing or approach?",
      "What's the agreed next step and timeline?",
      "What would you do differently next time?"
    ]
  }
];

const VP_TOTAL_ITEMS = VISIT_PREP_PARTS.reduce(function(s, p) { return s + p.items.length; }, 0);
const VP_LEAD_OPTIONS = [
  { label: "Hot", emoji: "🔥", color: "#F87171" },
  { label: "Warm", emoji: "🌤", color: "#FBBF24" },
  { label: "Cold", emoji: "❄️", color: "#60A5FA" }
];

let vpActiveCompanyId = null;

function getVisitPrep(companyId) {
  return state.visitPreps.find(function(vp) { return vp.companyId === companyId; });
}

function getChecksArray(companyId) {
  var vp = getVisitPrep(companyId);
  if (!vp || !vp.checks) return [];
  try { return JSON.parse(vp.checks); } catch(e) { return []; }
}

function isVPChecked(companyId, partIdx, itemIdx) {
  var checks = getChecksArray(companyId);
  var key = partIdx + '-' + itemIdx;
  return checks.indexOf(key) !== -1;
}

function getVPProgress(companyId) {
  var checks = getChecksArray(companyId);
  return Math.round((checks.length / VP_TOTAL_ITEMS) * 100);
}

function getVPPartProgress(companyId, partIdx) {
  var checks = getChecksArray(companyId);
  var part = VISIT_PREP_PARTS[partIdx];
  var done = 0;
  part.items.forEach(function(_, ii) {
    if (checks.indexOf(partIdx + '-' + ii) !== -1) done++;
  });
  return { done: done, total: part.items.length };
}

function getVPNotes(companyId) {
  var vp = getVisitPrep(companyId);
  return vp ? (vp.notes || '') : '';
}

function getVPLead(companyId) {
  var vp = getVisitPrep(companyId);
  return vp ? (vp.leadRating || '') : '';
}

async function toggleVPCheck(companyId, partIdx, itemIdx) {
  var checks = getChecksArray(companyId);
  var key = partIdx + '-' + itemIdx;
  var idx = checks.indexOf(key);
  if (idx !== -1) checks.splice(idx, 1);
  else checks.push(key);
  await saveVisitPrep(companyId, { checks: JSON.stringify(checks) });
  renderVisitPrepChecklist(companyId);
}

async function setVPLead(companyId, lead) {
  var current = getVPLead(companyId);
  await saveVisitPrep(companyId, { leadRating: current === lead ? '' : lead });
  renderVisitPrepChecklist(companyId);
}

async function saveVPNotes(companyId) {
  var textarea = document.getElementById('vpNotes');
  if (!textarea) return;
  await saveVisitPrep(companyId, { notes: textarea.value });
  toast('Notes saved');
}

async function saveVisitPrep(companyId, updates) {
  var vp = getVisitPrep(companyId);
  if (vp) {
    Object.keys(updates).forEach(function(k) { vp[k] = updates[k]; });
    vp.updatedAt = nowIso();
    await upsertRow(SHEET_TABS.visitprep, VISITPREP_COLS, vp);
  } else {
    var newVp = {
      companyId: companyId,
      checks: updates.checks || '[]',
      notes: updates.notes || '',
      leadRating: updates.leadRating || '',
      updatedAt: nowIso()
    };
    state.visitPreps.push(newVp);
    await upsertRow(SHEET_TABS.visitprep, VISITPREP_COLS, newVp);
  }
  cacheLocal();
}

function renderVisitPrep() {
  var root = document.getElementById('visitPrepContainer');
  if (!root) return;

  if (vpActiveCompanyId) {
    renderVisitPrepChecklist(vpActiveCompanyId);
    return;
  }

  // Company list view
  var companies = state.companies;
  if (companies.length === 0) {
    root.innerHTML = '<div class="empty"><h3>No companies yet</h3><p>Add companies in the Companies tab first, then prepare for visits here.</p></div>';
    return;
  }

  var html = '<div style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">';
  html += '<h2 style="font-family:\'Fraunces\',serif;font-size:20px;font-weight:600;margin:0">Visit Preparation</h2>';
  html += '</div>';

  html += '<div style="display:flex;flex-direction:column;gap:10px">';
  companies.forEach(function(c) {
    var prog = getVPProgress(c.id);
    var lead = getVPLead(c.id);
    var leadOpt = VP_LEAD_OPTIONS.find(function(o) { return o.label === lead; });

    html += '<div class="company-card" onclick="vpOpenChecklist(\'' + c.id + '\')" style="padding:14px">';
    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">';
    html += '<span style="font-weight:600;font-size:15px;flex:1">' + esc(c.name) + '</span>';
    if (leadOpt) {
      html += '<span style="padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600;color:' + leadOpt.color + ';border:1px solid ' + leadOpt.color + '">' + leadOpt.emoji + ' ' + leadOpt.label + '</span>';
    }
    html += '<span style="font-size:12px;font-weight:600;color:' + (prog === 100 ? 'var(--green)' : 'var(--ink-mute)') + '">' + prog + '%</span>';
    html += '</div>';

    if (c.contact || c.industry) {
      html += '<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">';
      if (c.contact) html += '<span style="font-size:11px;color:var(--ink-soft);background:var(--bg-sunken);padding:2px 8px;border-radius:12px">' + esc(c.contact) + '</span>';
      if (c.industry) html += '<span style="font-size:11px;color:var(--ink-soft);background:var(--bg-sunken);padding:2px 8px;border-radius:12px">' + esc(c.industry) + '</span>';
      html += '</div>';
    }

    // Part progress bars
    html += '<div style="display:flex;gap:8px">';
    VISIT_PREP_PARTS.forEach(function(part, pi) {
      var pp = getVPPartProgress(c.id, pi);
      html += '<div style="flex:1">';
      html += '<div style="display:flex;justify-content:space-between;margin-bottom:3px">';
      html += '<span style="font-size:9px;color:var(--ink-mute);font-weight:600">' + part.icon + ' ' + part.title.split(' ')[0] + '</span>';
      html += '<span style="font-size:9px;color:' + (pp.done === pp.total && pp.done > 0 ? part.color : 'var(--ink-mute)') + '">' + pp.done + '/' + pp.total + '</span>';
      html += '</div>';
      html += '<div style="height:3px;background:var(--line);border-radius:2px;overflow:hidden">';
      html += '<div style="height:100%;width:' + (pp.total > 0 ? (pp.done / pp.total) * 100 : 0) + '%;background:' + part.color + ';border-radius:2px;transition:width 0.3s"></div>';
      html += '</div></div>';
    });
    html += '</div></div>';
  });
  html += '</div>';

  root.innerHTML = html;
}

function vpOpenChecklist(companyId) {
  vpActiveCompanyId = companyId;
  renderVisitPrepChecklist(companyId);
}

function vpBackToList() {
  vpActiveCompanyId = null;
  renderVisitPrep();
}

function renderVisitPrepChecklist(companyId) {
  var root = document.getElementById('visitPrepContainer');
  if (!root) return;
  var company = state.companies.find(function(c) { return c.id === companyId; });
  if (!company) { vpBackToList(); return; }

  var prog = getVPProgress(companyId);
  var lead = getVPLead(companyId);
  var notes = getVPNotes(companyId);

  var html = '';
  html += '<button class="btn btn-sm" onclick="vpBackToList()" style="margin-bottom:16px">← All Companies</button>';

  // Header
  html += '<div style="background:var(--bg-card);border:1px solid var(--line);border-radius:var(--radius-lg);padding:16px;margin-bottom:16px">';
  html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">';
  html += '<h2 style="font-family:\'Fraunces\',serif;font-size:20px;font-weight:600;margin:0;flex:1">' + esc(company.name) + '</h2>';
  html += '<button class="btn btn-sm" onclick="vpExportPDF(\'' + companyId + '\')">📄 Download PDF</button>';
  html += '</div>';

  if (company.contact || company.industry) {
    html += '<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">';
    if (company.contact) html += '<span style="font-size:11px;color:var(--green);background:rgba(74,124,78,0.1);padding:2px 10px;border-radius:12px">' + esc(company.contact) + '</span>';
    if (company.industry) html += '<span style="font-size:11px;color:var(--blue);background:rgba(74,108,138,0.1);padding:2px 10px;border-radius:12px">' + esc(company.industry) + '</span>';
    html += '</div>';
  }

  // Progress bar
  html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">';
  html += '<div style="flex:1;height:6px;background:var(--line);border-radius:3px;overflow:hidden">';
  html += '<div style="height:100%;width:' + prog + '%;background:' + (prog === 100 ? 'var(--green)' : 'var(--accent)') + ';border-radius:3px;transition:width 0.4s"></div>';
  html += '</div>';
  html += '<span style="font-size:12px;font-weight:600;color:' + (prog === 100 ? 'var(--green)' : 'var(--ink-mute)') + '">' + prog + '%</span>';
  html += '</div>';

  // Lead rating
  html += '<div style="display:flex;align-items:center;gap:8px">';
  html += '<span style="font-size:11px;color:var(--ink-mute);font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Lead:</span>';
  VP_LEAD_OPTIONS.forEach(function(opt) {
    var isActive = lead === opt.label;
    html += '<button onclick="setVPLead(\'' + companyId + '\',\'' + opt.label + '\')" class="btn btn-sm" style="font-size:11px;padding:3px 12px;border-radius:20px;';
    if (isActive) html += 'background:rgba(0,0,0,0.05);border-color:' + opt.color + ';color:' + opt.color + ';font-weight:700';
    html += '">' + opt.emoji + ' ' + opt.label + '</button>';
  });
  html += '</div>';
  html += '</div>';

  // Checklist sections
  VISIT_PREP_PARTS.forEach(function(part, pi) {
    var pp = getVPPartProgress(companyId, pi);
    var allDone = pp.done === pp.total;

    html += '<div style="background:var(--bg-card);border:1px solid ' + (allDone ? part.color : 'var(--line)') + ';border-radius:var(--radius-lg);overflow:hidden;margin-bottom:12px;transition:border-color 0.3s">';

    // Section header
    html += '<div style="padding:14px 16px;background:' + part.color + '11;display:flex;align-items:center;gap:10px">';
    html += '<span style="font-size:20px">' + part.icon + '</span>';
    html += '<div style="flex:1">';
    html += '<div style="font-size:14px;font-weight:700">' + part.title + '</div>';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-top:4px">';
    html += '<div style="flex:1;max-width:120px;height:3px;background:var(--line);border-radius:2px;overflow:hidden">';
    html += '<div style="height:100%;width:' + (pp.total > 0 ? (pp.done / pp.total) * 100 : 0) + '%;background:' + part.color + ';border-radius:2px;transition:width 0.3s"></div>';
    html += '</div>';
    html += '<span style="font-size:10px;color:' + (allDone ? part.color : 'var(--ink-mute)') + '">' + pp.done + '/' + pp.total + '</span>';
    html += '</div></div>';
    if (allDone) html += '<span style="padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700;background:' + part.color + '11;color:' + part.color + ';border:1px solid ' + part.color + '">DONE</span>';
    html += '</div>';

    // Checklist items
    html += '<div style="padding:4px 0">';
    part.items.forEach(function(item, ii) {
      var checked = isVPChecked(companyId, pi, ii);
      html += '<div onclick="toggleVPCheck(\'' + companyId + '\',' + pi + ',' + ii + ')" style="display:flex;align-items:flex-start;gap:12px;padding:10px 16px;cursor:pointer;transition:background 0.1s" onmouseover="this.style.background=\'var(--bg-sunken)\'" onmouseout="this.style.background=\'transparent\'">';
      html += '<div style="width:20px;height:20px;border-radius:6px;border:2px solid ' + (checked ? part.color : 'var(--ink-mute)') + ';background:' + (checked ? part.color : 'transparent') + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;transition:all 0.15s">';
      if (checked) html += '<span style="color:#fff;font-size:12px;font-weight:900">✓</span>';
      html += '</div>';
      html += '<span style="font-size:13px;color:' + (checked ? 'var(--ink-mute)' : 'var(--ink)') + ';text-decoration:' + (checked ? 'line-through' : 'none') + ';line-height:1.4;transition:all 0.15s">' + esc(item) + '</span>';
      html += '</div>';
    });
    html += '</div></div>';
  });

  // Notes
  html += '<div style="margin-top:4px">';
  html += '<label style="font-size:11px;font-weight:600;color:var(--ink-mute);display:block;margin-bottom:6px;letter-spacing:0.5px;text-transform:uppercase">📝 Notes</label>';
  html += '<textarea id="vpNotes" onblur="saveVPNotes(\'' + companyId + '\')" placeholder="Key takeaways, objections, next steps…" style="width:100%;min-height:80px;padding:12px;border-radius:var(--radius-lg);border:1px solid var(--line);background:var(--bg-card);color:var(--ink);font-size:13px;font-family:inherit;resize:vertical;outline:none;box-sizing:border-box">' + esc(notes) + '</textarea>';
  html += '</div>';

  root.innerHTML = html;
}

// ===== PDF EXPORT =====
function vpExportPDF(companyId) {
  var company = state.companies.find(function(c) { return c.id === companyId; });
  if (!company) return;

  var prog = getVPProgress(companyId);
  var lead = getVPLead(companyId);
  var notes = getVPNotes(companyId);

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
  html += '<title>Visit Prep - ' + esc(company.name) + '</title>';
  html += '<style>';
  html += 'body{font-family:Arial,sans-serif;color:#1a1a1a;max-width:700px;margin:0 auto;padding:40px 30px;font-size:13px;line-height:1.5}';
  html += 'h1{font-size:22px;margin:0 0 4px;color:#b8451f}';
  html += 'h2{font-size:15px;margin:24px 0 10px;padding:8px 12px;border-radius:6px}';
  html += '.meta{font-size:12px;color:#666;margin-bottom:16px}';
  html += '.progress-bar{height:8px;background:#e8e2d5;border-radius:4px;margin:8px 0 16px;overflow:hidden}';
  html += '.progress-fill{height:100%;border-radius:4px}';
  html += '.item{display:flex;align-items:flex-start;gap:10px;padding:6px 0;border-bottom:1px solid #f0ece3}';
  html += '.check{width:16px;height:16px;border:2px solid #ccc;border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;margin-top:1px}';
  html += '.check.done{background:#4a7c4e;border-color:#4a7c4e;color:#fff}';
  html += '.done-text{text-decoration:line-through;color:#999}';
  html += '.notes{margin-top:20px;padding:12px;background:#f8f6f1;border-radius:6px;white-space:pre-wrap}';
  html += '.lead{display:inline-block;padding:3px 12px;border-radius:20px;font-weight:700;font-size:12px;margin-left:8px}';
  html += '.footer{margin-top:30px;font-size:10px;color:#999;text-align:center;border-top:1px solid #e8e2d5;padding-top:12px}';
  html += '@media print{body{padding:20px}}';
  html += '</style></head><body>';

  // Header
  html += '<h1>Maple MPSS — Visit Prep</h1>';
  html += '<div class="meta">';
  html += '<strong style="font-size:18px;color:#1a1a1a">' + esc(company.name) + '</strong><br>';
  if (company.contact) html += 'Contact: ' + esc(company.contact) + '<br>';
  if (company.industry) html += 'Industry: ' + esc(company.industry) + '<br>';
  if (lead) {
    var leadOpt = VP_LEAD_OPTIONS.find(function(o) { return o.label === lead; });
    html += 'Lead: <span class="lead" style="border:1px solid ' + (leadOpt ? leadOpt.color : '#999') + ';color:' + (leadOpt ? leadOpt.color : '#999') + '">' + lead + '</span><br>';
  }
  html += 'Progress: ' + prog + '% · Generated: ' + new Date().toLocaleDateString('en-CA');
  html += '</div>';

  // Progress bar
  html += '<div class="progress-bar"><div class="progress-fill" style="width:' + prog + '%;background:' + (prog === 100 ? '#4a7c4e' : '#b8451f') + '"></div></div>';

  // Sections
  VISIT_PREP_PARTS.forEach(function(part, pi) {
    var pp = getVPPartProgress(companyId, pi);
    html += '<h2 style="background:' + part.color + '15;border-left:4px solid ' + part.color + '">' + part.icon + ' ' + part.title + ' <span style="font-size:11px;color:#999;font-weight:400">(' + pp.done + '/' + pp.total + ')</span></h2>';
    part.items.forEach(function(item, ii) {
      var checked = isVPChecked(companyId, pi, ii);
      html += '<div class="item">';
      html += '<div class="check' + (checked ? ' done' : '') + '">' + (checked ? '✓' : '') + '</div>';
      html += '<span' + (checked ? ' class="done-text"' : '') + '>' + esc(item) + '</span>';
      html += '</div>';
    });
  });

  // Notes
  if (notes) {
    html += '<div class="notes"><strong>📝 Notes:</strong><br>' + esc(notes) + '</div>';
  }

  html += '<div class="footer">Maple MPSS — Company Visit Preparation Report</div>';
  html += '</body></html>';

  // Open in new window and trigger print
  var win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  setTimeout(function() { win.print(); }, 500);
}
