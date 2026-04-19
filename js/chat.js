/* chat.js — Chat agent v3: 13 tools + bulk import companies from Excel/CSV */

(function chatInit() {
  const fab = document.getElementById("chatFab");
  const panel = document.getElementById("chatPanel");
  const closeBtn = document.getElementById("chatClose");
  const msgs = document.getElementById("chatMessages");
  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("chatSend");
  const attachBtn = document.getElementById("chatAttach");
  const fileInp = document.getElementById("chatFile");
  const preview = document.getElementById("chatPreview");
  let chatHistory = [];
  let pendingImages = [];
  let pendingImportData = null;

  fab.addEventListener("click", () => { panel.classList.toggle("open"); if (panel.classList.contains("open")) input.focus(); });
  closeBtn.addEventListener("click", () => panel.classList.remove("open"));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } });
  sendBtn.addEventListener("click", sendChat);
  attachBtn.addEventListener("click", () => fileInp.click());
  fileInp.addEventListener("change", handleFiles);

  function bubble(text, cls) { const d = document.createElement("div"); d.className = "chatMsg " + cls; d.textContent = text; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d; }

  function isSpreadsheet(file) {
    const ext = file.name.toLowerCase().split('.').pop();
    return ['xlsx', 'xls', 'csv'].includes(ext);
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []); fileInp.value = "";
    for (const f of files) {
      if (isSpreadsheet(f)) {
        await handleSpreadsheetFile(f);
      } else if (f.type.startsWith("image/")) {
        try {
          const compressed = await compressImage(f, 1600, 0.82);
          const id = Math.random().toString(36).slice(2,8);
          pendingImages.push({ id, mediaType: "image/jpeg", data: compressed.base64, dataUrl: compressed.dataUrl });
        } catch(err) { bubble("Failed to read image: " + err.message, "error"); }
      }
    }
    renderPreview();
  }

  async function handleSpreadsheetFile(file) {
    const thinking = bubble("Reading " + file.name + "…", "system");
    try {
      const data = await readFileAsArrayBuffer(file);
      let rows;
      if (file.name.toLowerCase().endsWith('.csv')) {
        rows = parseCSV(new TextDecoder().decode(data));
      } else {
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
      }
      if (!rows || rows.length === 0) { thinking.remove(); bubble("File is empty or could not be parsed.", "error"); return; }
      const companies = rows.map(row => mapRowToCompany(row)).filter(c => c && c.name);
      if (companies.length === 0) { thinking.remove(); bubble("No company data found. Make sure your file has a column for company name.", "error"); return; }
      const existingNames = state.companies.map(c => c.name.toLowerCase().trim());
      const unique = [];
      const dupes = [];
      for (const c of companies) {
        if (existingNames.includes(c.name.toLowerCase().trim())) { dupes.push(c.name); } else { unique.push(c); }
      }
      thinking.remove();
      pendingImportData = { companies: unique, dupes };
      let msg = "Found " + companies.length + " companies in \"" + file.name + "\".";
      if (dupes.length > 0) msg += " " + dupes.length + " duplicate" + (dupes.length > 1 ? "s" : "") + " will be skipped.";
      msg += " Import " + unique.length + " new compan" + (unique.length !== 1 ? "ies" : "y") + "? (Type \"yes\" to confirm)";
      bubble(msg, "assistant");
    } catch (err) { thinking.remove(); bubble("Failed to read file: " + err.message, "error"); }
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("File read failed"));
      reader.readAsArrayBuffer(file);
    });
  }

  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const obj = {};
      headers.forEach((h, i) => obj[h] = vals[i] || '');
      return obj;
    });
  }

  function mapRowToCompany(row) {
    const get = function() {
      const keys = Array.from(arguments);
      for (const k of keys) {
        for (const col of Object.keys(row)) {
          if (col.toLowerCase().trim() === k.toLowerCase()) return String(row[col] || '').trim();
        }
      }
      for (const k of keys) {
        for (const col of Object.keys(row)) {
          if (col.toLowerCase().includes(k.toLowerCase())) return String(row[col] || '').trim();
        }
      }
      return '';
    };
    const name = get('company', 'company name', 'companyname', 'name', 'business', 'business name', 'organization', 'org');
    if (!name) return null;
    return {
      name: name,
      industry: get('industry', 'sector', 'type', 'business type'),
      size: get('size', 'company size', 'employees', 'employee count'),
      makes: get('makes', 'products', 'services', 'what they do', 'description'),
      address: get('address', 'location', 'city', 'full address'),
      contact: get('contact', 'contact name', 'contact person', 'person', 'primary contact', 'poc'),
      phone: get('phone', 'telephone', 'tel', 'mobile', 'phone number', 'contact number'),
      email: get('email', 'e-mail', 'email address', 'contact email'),
      website: get('website', 'web', 'url', 'site'),
      linkedin: get('linkedin', 'linkedin url', 'linkedin profile'),
      status: 'Prospect',
      value: get('value', 'pipeline', 'pipeline value', 'deal value', 'amount'),
      owner: 'Son',
      notes: get('notes', 'comments', 'remarks'),
    };
  }

  async function executeBulkImport() {
    if (!pendingImportData || pendingImportData.companies.length === 0) {
      bubble("No companies to import.", "system");
      pendingImportData = null;
      return;
    }
    const companies = pendingImportData.companies;
    const dupeCount = pendingImportData.dupes.length;
    pendingImportData = null;
    sendBtn.disabled = true;
    const progress = bubble("Importing 0/" + companies.length + "…", "system");
    let imported = 0;
    let failed = 0;
    for (const companyData of companies) {
      try {
        const c = {
          id: newId('CO'), name: companyData.name, industry: companyData.industry || '',
          size: companyData.size || '', makes: companyData.makes || '', address: companyData.address || '',
          contact: companyData.contact || '', phone: companyData.phone || '', email: companyData.email || '',
          website: companyData.website || '', linkedin: companyData.linkedin || '',
          status: companyData.status || 'Prospect', value: companyData.value || '',
          owner: companyData.owner || 'Son', lastInteraction: '', notes: companyData.notes || '',
          createdAt: nowIso(), updatedAt: nowIso()
        };
        state.companies.push(c);
        await upsertRow(SHEET_TABS.companies, COMPANY_COLS, c);
        imported++;
        progress.textContent = "Importing " + imported + "/" + companies.length + "…";
      } catch (err) {
        failed++;
        console.error('Import failed for', companyData.name, err);
      }
    }
    progress.remove();
    let msg = "Imported " + imported + " compan" + (imported !== 1 ? "ies" : "y");
    if (dupeCount > 0) msg += ", skipped " + dupeCount + " duplicate" + (dupeCount !== 1 ? "s" : "");
    if (failed > 0) msg += ", " + failed + " failed";
    bubble("✓ " + msg, "action");
    refreshAll();
    cacheLocal();
    sendBtn.disabled = false;
  }

  function compressImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read failed"));
      reader.onload = () => {
        const img = new Image(); img.onerror = () => reject(new Error("decode failed"));
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > maxDim || h > maxDim) { const r = Math.min(maxDim / w, maxDim / h); w = Math.round(w * r); h = Math.round(h * r); }
          const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", quality); resolve({ dataUrl: dataUrl, base64: dataUrl.split(",")[1] });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderPreview() {
    if (pendingImages.length === 0) { preview.classList.remove("show"); preview.innerHTML = ""; return; }
    preview.classList.add("show");
    preview.innerHTML = pendingImages.map(function(img) {
      return '<div class="chatPreviewItem"><img src="' + img.dataUrl + '" alt=""><button onclick="window.__removeChatImg(\'' + img.id + '\')" title="Remove">×</button></div>';
    }).join("");
  }
  window.__removeChatImg = function(id) { pendingImages = pendingImages.filter(function(x) { return x.id !== id; }); renderPreview(); };

  async function sendChat() {
    const text = input.value.trim(); const images = pendingImages.slice();
    if (pendingImportData && text.toLowerCase().match(/^(yes|y|confirm|ok|go|do it|import|sure)$/)) {
      input.value = ""; bubble(text, "user"); await executeBulkImport(); return;
    } else if (pendingImportData && text.toLowerCase().match(/^(no|n|cancel|skip|nope)$/)) {
      input.value = ""; bubble(text, "user"); pendingImportData = null; bubble("Import cancelled.", "system"); return;
    }
    if (!text && images.length === 0) return;
    if (!accessToken) { bubble("Sign in first so I can write to your Sheet.", "error"); return; }
    input.value = ""; pendingImages = []; renderPreview(); sendBtn.disabled = true;
    bubble(text || "[" + images.length + " business card" + (images.length > 1 ? "s" : "") + " attached]", "user");
    const thinking = bubble(images.length ? "Reading card(s)…" : "Thinking…", "system");
    try {
      const context = {
        today: new Date().toISOString().slice(0,10), user: "Prrithive",
        companies: state.companies.map(function(c) { return { id: c.id, name: c.name }; }),
        tasks: state.tasks.map(function(t) { return { id: t.id, name: t.name, status: t.status, date: t.date, companyId: t.companyId, priority: t.priority, category: t.category, assignee: t.assignee }; }),
        visits: state.visits.slice(-50).map(function(v) { return { date: v.date, type: v.type, companyId: v.companyId, outcome: v.outcome, loggedBy: v.loggedBy }; }),
        categoryGuide: 'Categories: "Sales" (default for company-linked tasks), "Marketing" (LinkedIn, website, content), "Admin" (domain, billing, email setup, GST, taxes), "PR Application" (Express Entry, immigration), "Personal", "Learning" (courses, research), "Other". companyId is OPTIONAL — leave blank for personal/business-ops tasks.'
      };
      const resp = await fetch(CHAT_WORKER_URL, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: chatHistory, context: context, images: images.map(function(i) { return { mediaType: i.mediaType, data: i.data }; }) }) });
      const data = await resp.json(); thinking.remove();
      if (!resp.ok) { bubble("Error: " + (data.error || "unknown"), "error"); return; }
      if (data.reply) bubble(data.reply, "assistant");
      if (data.toolCalls && data.toolCalls.length) {
        const createdByName = {};
        for (const call of data.toolCalls) {
          try {
            if (call.name === "add_task" && (!call.input.companyId || call.input.companyId === "") && call.input.companyName) {
              const key = String(call.input.companyName).toLowerCase().trim();
              if (createdByName[key]) call.input.companyId = createdByName[key];
            }
            const result = await executeChatToolCall(call);
            if (call.name === "add_company" && result.id && result.name) createdByName[result.name.toLowerCase().trim()] = result.id;
            bubble("✓ " + result.summary, "action");
          } catch (err) { bubble("✗ " + call.name + " failed: " + (err.message || err), "error"); }
        }
        refreshAll(); cacheLocal();
      }
      chatHistory.push({ role: "user", content: text || "(business card image)" });
      if (data.reply) chatHistory.push({ role: "assistant", content: data.reply });
      if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
    } catch (err) { thinking.remove(); bubble("Network error: " + err.message, "error"); }
    finally { sendBtn.disabled = false; input.focus(); }
  }

  async function executeChatToolCall(call) {
    const name = call.name, args = call.input;
    switch (name) {
      case "add_task": {
        const defaultCat = args.companyId ? 'Sales' : 'Personal';
        const t = { id: newId('TSK'), name: args.name, status: args.status || 'Not started', priority: args.priority || 'Medium',
          date: args.date || '', duration: args.duration || '', assignee: args.assignee || 'Son', category: args.category || defaultCat,
          companyId: args.companyId || '', notes: args.notes || '', links: args.links || '', createdAt: nowIso(), updatedAt: nowIso() };
        state.tasks.push(t); await upsertRow(SHEET_TABS.tasks, TASK_COLS, t);
        const co = state.companies.find(function(c) { return c.id === args.companyId; });
        return { summary: 'Added task "' + t.name + '"' + (co ? " for " + co.name : "") + (t.date ? " (" + formatDate(t.date) + ")" : "") };
      }
      case "update_task": {
        const t = state.tasks.find(function(x) { return x.id === args.id; }); if (!t) throw new Error("Task not found: " + args.id);
        const tid = t.id; Object.assign(t, args); t.id = tid; t.updatedAt = nowIso();
        await upsertRow(SHEET_TABS.tasks, TASK_COLS, t); return { summary: 'Updated task "' + t.name + '"' };
      }
      case "delete_task": {
        const t = state.tasks.find(function(x) { return x.id === args.id; }); if (!t) throw new Error("Task not found: " + args.id);
        const taskName = t.name; await archiveTask(args.id, 'deleted'); return { summary: 'Archived task "' + taskName + '"' };
      }
      case "delete_company": {
        const c = state.companies.find(function(x) { return x.id === args.id; }); if (!c) throw new Error("Company not found: " + args.id);
        const compName = c.name; state.companies = state.companies.filter(function(x) { return x.id !== args.id; });
        await deleteRowById(SHEET_TABS.companies, args.id); return { summary: 'Deleted company "' + compName + '"' };
      }
      case "bulk_update_tasks": {
        const matched = chatFilterTasks(args.filter); if (matched.length === 0) return { summary: "No tasks matched the filter" };
        for (const t of matched) {
          if (args.updates.status) t.status = args.updates.status; if (args.updates.priority) t.priority = args.updates.priority;
          if (args.updates.date) t.date = args.updates.date; if (args.updates.assignee) t.assignee = args.updates.assignee;
          if (args.updates.category) t.category = args.updates.category; t.updatedAt = nowIso();
          await upsertRow(SHEET_TABS.tasks, TASK_COLS, t);
        }
        return { summary: "Updated " + matched.length + " task" + (matched.length !== 1 ? "s" : "") };
      }
      case "bulk_delete_tasks": {
        const matched = chatFilterTasks(args.filter); if (matched.length === 0) return { summary: "No tasks matched the filter" };
        let count = 0; for (const t of matched) { await archiveTask(t.id, 'deleted'); count++; }
        return { summary: "Archived " + count + " task" + (count !== 1 ? "s" : "") };
      }
      case "query_tasks": { const matched = chatFilterTasks(args.filter); return { summary: "Found " + matched.length + " task" + (matched.length !== 1 ? "s" : "") }; }
      case "query_companies": { const matched = chatFilterCompanies(args.filter); return { summary: "Found " + matched.length + " compan" + (matched.length !== 1 ? "ies" : "y") }; }
      case "get_briefing": {
        const targetDate = args.date || new Date().toISOString().slice(0, 10);
        const todayD = new Date(targetDate);
        const todayTasks = state.tasks.filter(function(t) { return t.date === targetDate && t.status !== 'Done'; });
        const overdueTasks = state.tasks.filter(function(t) { return t.date && new Date(t.date) < todayD && t.status !== 'Done'; });
        const parts = ["📅 " + todayTasks.length + " task" + (todayTasks.length !== 1 ? "s" : "") + " today"];
        if (overdueTasks.length) parts.push("⚠ " + overdueTasks.length + " overdue");
        return { summary: parts.join(' · ') };
      }
      case "get_stats": {
        const today = new Date(); const thisMonthStr = today.toISOString().slice(0,7);
        const lastMonthDate = new Date(today); lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
        const r = { visitsThisMonth: state.visits.filter(function(v) { return v.date && v.date.slice(0,7) === thisMonthStr; }).length,
          visitsLastMonth: state.visits.filter(function(v) { return v.date && v.date.slice(0,7) === lastMonthDate.toISOString().slice(0,7); }).length,
          openTasks: state.tasks.filter(function(t) { return t.status !== 'Done'; }).length,
          overdueCount: state.tasks.filter(function(t) { return t.date && new Date(t.date) < today && t.status !== 'Done'; }).length };
        return { summary: JSON.stringify(r) };
      }
      case "add_company": {
        const notesParts = []; if (args.notes) notesParts.push(args.notes); if (args.contactTitle) notesParts.push("Title: " + args.contactTitle);
        const c = { id: newId('CO'), name: args.name, industry: args.industry || '', size: args.size || '', makes: args.makes || '',
          address: args.address || '', contact: args.contact || '', phone: args.phone || '', email: args.email || '',
          website: args.website || '', linkedin: args.linkedin || '', status: args.status || 'Prospect', value: args.value || '',
          owner: args.owner || 'Son', lastInteraction: '', notes: notesParts.join(' · '), createdAt: nowIso(), updatedAt: nowIso() };
        state.companies.push(c); await upsertRow(SHEET_TABS.companies, COMPANY_COLS, c);
        return { summary: 'Added company "' + c.name + '"' + (c.contact ? " (" + c.contact + ")" : ""), id: c.id, name: c.name };
      }
      case "update_company": {
        const c = state.companies.find(function(x) { return x.id === args.id; }); if (!c) throw new Error("Company not found: " + args.id);
        const cid = c.id; Object.assign(c, args); c.id = cid; c.updatedAt = nowIso();
        await upsertRow(SHEET_TABS.companies, COMPANY_COLS, c); return { summary: "Updated " + c.name };
      }
      case "log_visit": {
        const v = { id: newId('VIS'), companyId: args.companyId, date: args.date, type: args.type,
          outcome: args.outcome || 'Positive', notes: args.notes || '', nextStep: args.nextStep || '',
          loggedBy: args.loggedBy || 'Son', createdAt: nowIso() };
        state.visits.push(v); await upsertRow(SHEET_TABS.visits, VISIT_COLS, v);
        const co = state.companies.find(function(x) { return x.id === args.companyId; });
        if (co && v.date) { co.lastInteraction = v.date; if (co.status === 'Prospect') co.status = 'Visited'; await upsertRow(SHEET_TABS.companies, COMPANY_COLS, co); }
        return { summary: "Logged " + args.type + " visit" + (co ? " with " + co.name : "") + " (" + formatDate(v.date) + ")" };
      }
      default: throw new Error("Unknown tool: " + name);
    }
  }

  function chatFilterTasks(filter) {
    if (!filter) return state.tasks;
    const today = new Date(new Date().toDateString());
    return state.tasks.filter(function(t) {
      if (filter.status && t.status !== filter.status) return false;
      if (filter.priority && t.priority !== filter.priority) return false;
      if (filter.assignee && t.assignee !== filter.assignee) return false;
      if (filter.category && t.category !== filter.category) return false;
      if (filter.companyId && t.companyId !== filter.companyId) return false;
      if (filter.overdue && !(t.date && new Date(t.date) < today && t.status !== 'Done')) return false;
      if (filter.dateExact && t.date !== filter.dateExact) return false;
      if (filter.dateRange) { if (!t.date) return false; if (filter.dateRange.from && t.date < filter.dateRange.from) return false; if (filter.dateRange.to && t.date > filter.dateRange.to) return false; }
      if (filter.search) { var s = filter.search.toLowerCase(); if ((t.name||'').toLowerCase().indexOf(s) === -1 && (t.notes||'').toLowerCase().indexOf(s) === -1) return false; }
      return true;
    });
  }

  function chatFilterCompanies(filter) {
    if (!filter) return state.companies;
    const today = new Date();
    return state.companies.filter(function(c) {
      if (filter.status && (c.status||'Prospect') !== filter.status) return false;
      if (filter.owner && c.owner !== filter.owner) return false;
      if (filter.search) { var s = filter.search.toLowerCase(); if (((c.name||'')+(c.industry||'')+(c.notes||'')).toLowerCase().indexOf(s) === -1) return false; }
      if (filter.noInteractionDays) { if (c.lastInteraction) { var daysSince = Math.floor((today - new Date(c.lastInteraction)) / 86400000); if (daysSince < filter.noInteractionDays) return false; } }
      return true;
    });
  }
})();
