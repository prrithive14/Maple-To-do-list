/* chat.js — Chat agent v5: 18 tools (15 core + 3 learning) + bulk import + meeting mode */

(function chatInit() {
  const fab = document.getElementById("chatFab");
  const panel = document.getElementById("chatPanel");
  const closeBtn = document.getElementById("chatClose");
  const msgs = document.getElementById("chatMessages");
  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("chatSend");
  const attachBtn = document.getElementById("chatAttach");
  const meetingBtn = document.getElementById("chatMeeting");
  const fileInp = document.getElementById("chatFile");
  const preview = document.getElementById("chatPreview");
  let chatHistory = [];
  let pendingImages = [];
  let pendingImportData = null;

  // --- Meeting mode state ---
  let currentMode = 'normal';            // 'normal' | 'meeting'
  let pendingTaskBatch = null;           // { tasks: [...], panelEl, chipEl }
  let batchRowCounter = 0;               // for unique DOM ids on batch rows

  const TASK_UPDATE_FIELDS = ['name','status','priority','date','duration','assignee','category','companyId','notes','links'];
  const COMPANY_UPDATE_FIELDS = ['name','industry','size','makes','address','contact','phone','email','website','linkedin','status','value','owner','lastInteraction','notes'];
  // Daily Log: whitelisted updatable fields. done is a boolean (we normalise to "TRUE"/"FALSE").
  // createdBy/createdAt/updatedBy/updatedAt/id are NEVER in the whitelist — those are server-controlled.
  const LOG_UPDATE_FIELDS = ['date','startTime','endTime','title','done','comment'];
  const DEFAULT_PLACEHOLDER = input.placeholder || "Tell me what to do…";
  const MEETING_PLACEHOLDER = "Paste or dictate your meeting notes. I'll extract action items as tasks.";

  fab.addEventListener("click", () => { panel.classList.toggle("open"); if (panel.classList.contains("open")) input.focus(); });
  closeBtn.addEventListener("click", () => panel.classList.remove("open"));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } });
  sendBtn.addEventListener("click", sendChat);
  attachBtn.addEventListener("click", () => fileInp.click());
  fileInp.addEventListener("change", handleFiles);
  if (meetingBtn) meetingBtn.addEventListener("click", toggleMeetingMode);

  function bubble(text, cls) { const d = document.createElement("div"); d.className = "chatMsg " + cls; d.textContent = text; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d; }

  // ============================================================
  //   MEETING MODE
  // ============================================================

  function toggleMeetingMode() {
    if (currentMode === 'meeting') exitMeetingMode();
    else enterMeetingMode();
  }

  function enterMeetingMode() {
    currentMode = 'meeting';
    if (meetingBtn) meetingBtn.classList.add('active');
    input.classList.add('meeting-mode');
    input.placeholder = MEETING_PLACEHOLDER;

    // Insert mode chip before #chatInputRow
    const chip = document.createElement('div');
    chip.className = 'chatModeChip';
    chip.id = 'chatModeChip';
    chip.innerHTML = '📝 Meeting mode <button type="button" title="Exit meeting mode">×</button>';
    chip.querySelector('button').addEventListener('click', exitMeetingMode);
    const inputRow = document.getElementById('chatInputRow');
    inputRow.parentNode.insertBefore(chip, inputRow);

    input.focus();
  }

  function exitMeetingMode() {
    currentMode = 'normal';
    if (meetingBtn) meetingBtn.classList.remove('active');
    input.classList.remove('meeting-mode');
    input.placeholder = DEFAULT_PLACEHOLDER;
    const chip = document.getElementById('chatModeChip');
    if (chip) chip.remove();
    // Note: we deliberately do NOT clear pendingTaskBatch here. If the user
    // toggles the mode chip mid-review, their batch stays until they act on it.
  }

  // Resolve proposed add_task calls from the worker into a batch of task objects
  // ready for the UI. Maps companyName -> companyId by existing companies.
  function proposedCallsToBatch(toolCalls) {
    const batch = [];
    for (const call of toolCalls) {
      if (call.name !== 'add_task') continue; // defensive — meeting mode should only return add_task
      const args = call.input || {};
      let companyId = args.companyId || '';
      let companyName = args.companyName || '';

      // If companyId given and it exists, we're good. If only companyName given, try to match.
      if (!companyId && companyName) {
        const match = state.companies.find(c => c.name.toLowerCase().trim() === String(companyName).toLowerCase().trim());
        if (match) { companyId = match.id; companyName = ''; /* resolved */ }
      }
      // If companyId given, also populate companyName for display
      let displayCompanyName = '';
      if (companyId) {
        const co = state.companies.find(c => c.id === companyId);
        if (co) displayCompanyName = co.name;
      } else if (companyName) {
        displayCompanyName = companyName + ' (not in CRM)';
      }

      batch.push({
        rowId: 'batchRow_' + (++batchRowCounter),
        checked: true,
        name: args.name || '',
        status: 'Not started',
        priority: args.priority || 'Medium',
        date: args.date || '',
        duration: args.duration || '',
        assignee: args.assignee || getCurrentUser() || 'Prrithive',
        category: args.category || (companyId ? 'Sales' : 'Personal'),
        companyId: companyId,
        unresolvedCompanyName: companyId ? '' : companyName,
        displayCompanyName: displayCompanyName,
        notes: args.notes || '',
        links: args.links || ''
      });
    }
    return batch;
  }

  function renderBatchPanel(batch) {
    // Remove any existing batch panel (defensive — shouldn't happen)
    if (pendingTaskBatch && pendingTaskBatch.panelEl) pendingTaskBatch.panelEl.remove();

    const panelEl = document.createElement('div');
    panelEl.className = 'chatBatchPanel';

    const header = document.createElement('div');
    header.className = 'chatBatchHeader';
    header.innerHTML = '<span>Proposed tasks</span><span class="batchCount">' + batch.length + ' item' + (batch.length !== 1 ? 's' : '') + '</span>';
    panelEl.appendChild(header);

    // Build company options once
    const companyOptionsHTML = '<option value="">— none —</option>' +
      state.companies.map(c => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>').join('');

    for (const t of batch) {
      const row = document.createElement('div');
      row.className = 'chatBatchRow';
      row.dataset.rowId = t.rowId;
      row.innerHTML = `
        <input type="checkbox" ${t.checked ? 'checked' : ''} data-field="checked">
        <input type="text" class="batchName" data-field="name" value="${esc(t.name)}" placeholder="Task name">
        <div class="chatBatchFields">
          <select data-field="assignee">
            <option${t.assignee==='Prrithive'?' selected':''}>Prrithive</option>
            <option${t.assignee==='Sridharan'?' selected':''}>Sridharan</option>
            <option${t.assignee==='Both'?' selected':''}>Both</option>
          </select>
          <input type="date" data-field="date" value="${esc(t.date)}">
          <select data-field="priority">
            <option${t.priority==='Low'?' selected':''}>Low</option>
            <option${t.priority==='Medium'?' selected':''}>Medium</option>
            <option${t.priority==='High'?' selected':''}>High</option>
            <option${t.priority==='Urgent'?' selected':''}>Urgent</option>
          </select>
          <select data-field="category">
            <option${t.category==='Sales'?' selected':''}>Sales</option>
            <option${t.category==='Marketing'?' selected':''}>Marketing</option>
            <option${t.category==='Admin'?' selected':''}>Admin</option>
            <option${t.category==='PR Application'?' selected':''}>PR Application</option>
            <option${t.category==='Personal'?' selected':''}>Personal</option>
            <option${t.category==='Learning'?' selected':''}>Learning</option>
            <option${t.category==='Other'?' selected':''}>Other</option>
          </select>
          <select data-field="companyId">${companyOptionsHTML}</select>
          ${t.unresolvedCompanyName ? '<span class="batchCompanyName" title="Not in CRM — pick a match from the dropdown or leave as none">' + esc(t.unresolvedCompanyName) + '</span>' : ''}
          ${t.notes ? '<span class="batchNotesPreview">' + esc(t.notes) + '</span>' : ''}
        </div>
      `;
      // set select value for companyId
      const compSel = row.querySelector('[data-field="companyId"]');
      if (compSel) compSel.value = t.companyId || '';

      // Wire up edits: any change mutates the task object in batch
      row.addEventListener('change', (e) => {
        const target = e.target;
        if (!target.dataset || !target.dataset.field) return;
        const field = target.dataset.field;
        if (field === 'checked') {
          t.checked = target.checked;
          row.classList.toggle('unchecked', !t.checked);
        } else {
          t[field] = target.value;
        }
        updateBatchCreateButton();
      });
      row.addEventListener('input', (e) => {
        const target = e.target;
        if (target.dataset && target.dataset.field === 'name') {
          t.name = target.value;
          updateBatchCreateButton();
        }
      });

      panelEl.appendChild(row);
    }

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'chatBatchActions';
    actions.innerHTML = `
      <button type="button" data-action="cancel">Cancel</button>
      <button type="button" class="primary" data-action="create">Create tasks</button>
    `;
    actions.querySelector('[data-action="cancel"]').addEventListener('click', cancelBatch);
    actions.querySelector('[data-action="create"]').addEventListener('click', confirmBatch);
    panelEl.appendChild(actions);

    msgs.appendChild(panelEl);
    msgs.scrollTop = msgs.scrollHeight;

    pendingTaskBatch = { tasks: batch, panelEl: panelEl };
    updateBatchCreateButton();
  }

  function updateBatchCreateButton() {
    if (!pendingTaskBatch || !pendingTaskBatch.panelEl) return;
    const checked = pendingTaskBatch.tasks.filter(t => t.checked && t.name.trim() && t.date);
    const btn = pendingTaskBatch.panelEl.querySelector('[data-action="create"]');
    if (!btn) return;
    btn.disabled = checked.length === 0;
    btn.textContent = checked.length ? ('Create ' + checked.length + ' task' + (checked.length !== 1 ? 's' : '')) : 'Create tasks';
  }

  function cancelBatch() {
    if (!pendingTaskBatch) return;
    if (pendingTaskBatch.panelEl) pendingTaskBatch.panelEl.remove();
    pendingTaskBatch = null;
    bubble('Batch cancelled. No tasks were created.', 'system');
  }

  async function confirmBatch() {
    if (!pendingTaskBatch) return;
    const toCreate = pendingTaskBatch.tasks.filter(t => t.checked && t.name.trim() && t.date);
    if (toCreate.length === 0) {
      bubble('Nothing to create — check at least one task with a name and date.', 'error');
      return;
    }
    // Freeze UI: disable all inputs + buttons in the panel
    const panelEl = pendingTaskBatch.panelEl;
    panelEl.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
    const createBtn = panelEl.querySelector('[data-action="create"]');
    const originalLabel = createBtn.textContent;
    createBtn.textContent = 'Creating…';

    sendBtn.disabled = true;
    let created = 0, failed = 0;
    for (const t of toCreate) {
      try {
        const taskObj = {
          id: newId('TSK'),
          name: t.name.trim(),
          status: t.status || 'Not started',
          priority: t.priority || 'Medium',
          date: t.date,
          duration: t.duration || '',
          assignee: t.assignee || 'Prrithive',
          category: t.category || 'Personal',
          companyId: t.companyId || '',
          notes: t.notes || '',
          links: t.links || '',
          createdAt: nowIso(),
          updatedAt: nowIso(),
          reviewer: '',
          reviewStatus: '',
          reviewHistory: ''
        };
        state.tasks.push(taskObj);
        await upsertRow(SHEET_TABS.tasks, TASK_COLS, taskObj);
        created++;
      } catch (err) {
        console.error('Batch create failed for', t.name, err);
        failed++;
      }
    }
    // Tear down panel
    panelEl.remove();
    pendingTaskBatch = null;
    sendBtn.disabled = false;

    let summary = '✓ Created ' + created + ' task' + (created !== 1 ? 's' : '');
    if (failed > 0) summary += ' · ' + failed + ' failed';
    bubble(summary, 'action');
    refreshAll();
    cacheLocal();

    // Exit meeting mode after a successful batch — keeps things clean.
    // If user wants another batch, they tap 📝 again.
    if (currentMode === 'meeting') exitMeetingMode();
  }

  // ============================================================
  //   IMAGES + SPREADSHEET IMPORT (unchanged)
  // ============================================================

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
      owner: 'Prrithive',
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
          owner: companyData.owner || 'Prrithive', lastInteraction: '', notes: companyData.notes || '',
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

  // ============================================================
  //   SEND CHAT
  // ============================================================

  async function sendChat() {
    const text = input.value.trim(); const images = pendingImages.slice();

    // Bulk import confirmation flow (only in normal mode)
    if (currentMode === 'normal') {
      if (pendingImportData && text.toLowerCase().match(/^(yes|y|confirm|ok|go|do it|import|sure)$/)) {
        input.value = ""; bubble(text, "user"); await executeBulkImport(); return;
      } else if (pendingImportData && text.toLowerCase().match(/^(no|n|cancel|skip|nope)$/)) {
        input.value = ""; bubble(text, "user"); pendingImportData = null; bubble("Import cancelled.", "system"); return;
      }
    }

    if (!text && images.length === 0) return;
    if (!accessToken) { bubble("Sign in first so I can write to your Sheet.", "error"); return; }

    // In meeting mode, images are ignored (defer to future extension)
    if (currentMode === 'meeting' && images.length > 0) {
      bubble("Images are ignored in meeting mode. Text notes only.", "system");
      pendingImages = []; renderPreview();
    }

    // If there's already a batch open, don't stack another.
    if (currentMode === 'meeting' && pendingTaskBatch) {
      bubble("Finish or cancel the current batch before sending more notes.", "system");
      return;
    }

    input.value = ""; pendingImages = []; renderPreview(); sendBtn.disabled = true;

    const displayText = text || ("[" + images.length + " business card" + (images.length > 1 ? "s" : "") + " attached]");
    bubble(displayText, "user");
    const thinkingLabel = (currentMode === 'meeting') ? "Reading meeting notes…" : (images.length ? "Reading card(s)…" : "Thinking…");
    const thinking = bubble(thinkingLabel, "system");

    try {
      const context = {
        today: new Date().toISOString().slice(0,10),
        user: getCurrentUser(),
        companies: state.companies.map(function(c) { return { id: c.id, name: c.name }; }),
        tasks: state.tasks.map(function(t) { return { id: t.id, name: t.name, status: t.status, date: t.date, companyId: t.companyId, priority: t.priority, category: t.category, assignee: t.assignee, reviewer: t.reviewer || '', reviewStatus: t.reviewStatus || '' }; }),
        visits: state.visits.slice(-50).map(function(v) { return { date: v.date, type: v.type, companyId: v.companyId, outcome: v.outcome, loggedBy: v.loggedBy }; }),
        categoryGuide: 'Categories: "Sales" (default for company-linked tasks), "Marketing" (LinkedIn, website, content), "Admin" (domain, billing, email setup, GST, taxes), "PR Application" (Express Entry, immigration), "Personal", "Learning" (courses, research), "Other". companyId is OPTIONAL — leave blank for personal/business-ops tasks.',
        reviewGuide: 'Review workflow: tasks can have reviewer="Prrithive"|"Sridharan" and reviewStatus=""|"pending"|"changes_requested"|"approved". Use request_review to ask someone to review, respond_to_review to approve or request changes. Only the named reviewer can approve or request changes. Only the task assignee can re-request review after changes.'
      };

      const resp = await fetch(CHAT_WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: (currentMode === 'meeting') ? [] : chatHistory,  // meeting mode is stateless per-send
          context: context,
          images: (currentMode === 'meeting') ? [] : images.map(function(i) { return { mediaType: i.mediaType, data: i.data }; }),
          mode: currentMode
        })
      });

      const data = await resp.json();
      thinking.remove();

      if (!resp.ok) { bubble("Error: " + (data.error || "unknown"), "error"); return; }

      // === MEETING MODE: defer tool calls into a batch ===
      if (currentMode === 'meeting') {
        if (data.reply) bubble(data.reply, "assistant");
        const addTaskCalls = (data.toolCalls || []).filter(c => c.name === 'add_task');
        const otherCalls = (data.toolCalls || []).filter(c => c.name !== 'add_task');
        if (otherCalls.length > 0) {
          bubble("Ignoring " + otherCalls.length + " non-task tool call" + (otherCalls.length !== 1 ? 's' : '') + " in meeting mode.", "system");
        }
        if (addTaskCalls.length === 0) {
          // No actions found — stay in meeting mode so user can edit and retry
          return;
        }
        const batch = proposedCallsToBatch(addTaskCalls);
        renderBatchPanel(batch);
        // Meeting mode does NOT push to chatHistory — keeps the conversation clean
        return;
      }

      // === NORMAL MODE: existing flow ===
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

  function applyWhitelistedUpdates(target, args, whitelist) {
    for (const field of whitelist) {
      if (args[field] !== undefined) target[field] = args[field];
    }
  }

  // Format history entry same way as tasks.js (keep in sync!)
  function formatHistoryEntry(author, message) {
    var dateStr = new Date().toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
    return '[' + dateStr + ' - ' + author + ']: ' + (message || '');
  }

  async function executeChatToolCall(call) {
    const name = call.name, args = call.input;
    switch (name) {
      case "add_task": {
        const defaultCat = args.companyId ? 'Sales' : 'Personal';
        const t = { id: newId('TSK'), name: args.name, status: args.status || 'Not started', priority: args.priority || 'Medium',
          date: args.date || '', duration: args.duration || '', assignee: args.assignee || 'Prrithive', category: args.category || defaultCat,
          companyId: args.companyId || '', notes: args.notes || '', links: args.links || '', createdAt: nowIso(), updatedAt: nowIso(),
          reviewer: '', reviewStatus: '', reviewHistory: '' };
        state.tasks.push(t); await upsertRow(SHEET_TABS.tasks, TASK_COLS, t);
        const co = state.companies.find(function(c) { return c.id === args.companyId; });
        return { summary: 'Added task "' + t.name + '"' + (co ? " for " + co.name : "") + (t.date ? " (" + formatDate(t.date) + ")" : "") };
      }
      case "update_task": {
        const t = state.tasks.find(function(x) { return x.id === args.id; }); if (!t) throw new Error("Task not found: " + args.id);
        applyWhitelistedUpdates(t, args, TASK_UPDATE_FIELDS);
        t.updatedAt = nowIso();
        await upsertRow(SHEET_TABS.tasks, TASK_COLS, t); return { summary: 'Updated task "' + t.name + '"' };
      }
      case "delete_task": {
        const t = state.tasks.find(function(x) { return x.id === args.id; }); if (!t) throw new Error("Task not found: " + args.id);
        const taskName = t.name; await archiveTask(args.id, 'deleted'); return { summary: 'Archived task "' + taskName + '"' };
      }
      case "request_review": {
        const t = state.tasks.find(function(x){ return x.id === args.taskId; });
        if (!t) throw new Error("Task not found: " + args.taskId);
        if (!canUserReview()) throw new Error("Unknown user — cannot take review actions");
        if (args.reviewer !== 'Prrithive' && args.reviewer !== 'Sridharan') throw new Error("Reviewer must be Prrithive or Sridharan");
        if (args.reviewer === getCurrentUser()) throw new Error("Cannot request review from yourself");
        t.reviewer = args.reviewer;
        t.reviewStatus = 'pending';
        const msg = 'Review requested from ' + args.reviewer + (args.comment ? ' — ' + args.comment : '');
        const entry = formatHistoryEntry(getCurrentUser(), msg);
        t.reviewHistory = t.reviewHistory ? (t.reviewHistory + '\n\n' + entry) : entry;
        t.updatedAt = nowIso();
        await upsertRow(SHEET_TABS.tasks, TASK_COLS, t);
        return { summary: 'Requested review of "' + t.name + '" from ' + args.reviewer };
      }
      case "respond_to_review": {
        const t = state.tasks.find(function(x){ return x.id === args.taskId; });
        if (!t) throw new Error("Task not found: " + args.taskId);
        if (!canUserReview()) throw new Error("Unknown user — cannot take review actions");
        const me = getCurrentUser();
        const resp = (args.response || '').toLowerCase();
        if (resp === 'approve') {
          if (t.reviewer !== me) throw new Error("Only the reviewer (" + t.reviewer + ") can approve");
          if (t.reviewStatus !== 'pending') throw new Error("Review is not pending");
          t.reviewStatus = 'approved';
          const entry = formatHistoryEntry(me, 'Approved' + (args.comment ? ' — ' + args.comment : ''));
          t.reviewHistory = t.reviewHistory ? (t.reviewHistory + '\n\n' + entry) : entry;
        } else if (resp === 'request_changes') {
          if (t.reviewer !== me) throw new Error("Only the reviewer (" + t.reviewer + ") can request changes");
          if (t.reviewStatus !== 'pending') throw new Error("Review is not pending");
          if (!args.comment) throw new Error("Comment is required when requesting changes");
          t.reviewStatus = 'changes_requested';
          const entry = formatHistoryEntry(me, 'Requested changes: ' + args.comment);
          t.reviewHistory = t.reviewHistory ? (t.reviewHistory + '\n\n' + entry) : entry;
        } else if (resp === 're_request') {
          if (t.assignee !== me) throw new Error("Only the task assignee (" + t.assignee + ") can re-request review");
          if (t.reviewStatus !== 'changes_requested') throw new Error("Can only re-request when changes are requested");
          t.reviewStatus = 'pending';
          const entry = formatHistoryEntry(me, 'Re-requested review' + (args.comment ? ': ' + args.comment : ''));
          t.reviewHistory = t.reviewHistory ? (t.reviewHistory + '\n\n' + entry) : entry;
        } else {
          throw new Error("Unknown response: " + args.response + " (must be approve, request_changes, or re_request)");
        }
        t.updatedAt = nowIso();
        await upsertRow(SHEET_TABS.tasks, TASK_COLS, t);
        return { summary: 'Review ' + resp + ' on "' + t.name + '"' };
      }
      case "delete_company": {
        const c = state.companies.find(function(x) { return x.id === args.id; }); if (!c) throw new Error("Company not found: " + args.id);
        const compName = c.name;
        const linkedTasks = state.tasks.filter(function(t) { return t.companyId === args.id; });
        const linkedVisits = state.visits.filter(function(v) { return v.companyId === args.id; });
        const linkedPrep = state.visitPreps.filter(function(p) { return p.companyId === args.id; });
        for (const t of linkedTasks) {
          try { await archiveTask(t.id, 'company_deleted'); }
          catch (e) { console.error('Cascade archive failed for task', t.id, e); }
        }
        for (const v of linkedVisits) {
          try {
            state.visits = state.visits.filter(function(x) { return x.id !== v.id; });
            await deleteRowById(SHEET_TABS.visits, v.id);
          } catch (e) { console.error('Cascade delete failed for visit', v.id, e); }
        }
        for (const p of linkedPrep) {
          try {
            state.visitPreps = state.visitPreps.filter(function(x) { return x.id !== p.id; });
            await deleteRowById(SHEET_TABS.visitprep, p.id);
          } catch (e) { console.error('Cascade delete failed for visit prep', p.id, e); }
        }
        state.companies = state.companies.filter(function(x) { return x.id !== args.id; });
        await deleteRowById(SHEET_TABS.companies, args.id);
        const parts = ['Deleted company "' + compName + '"'];
        if (linkedTasks.length) parts.push('archived ' + linkedTasks.length + ' task' + (linkedTasks.length !== 1 ? 's' : ''));
        if (linkedVisits.length) parts.push('deleted ' + linkedVisits.length + ' visit' + (linkedVisits.length !== 1 ? 's' : ''));
        if (linkedPrep.length) parts.push('deleted visit prep');
        return { summary: parts.join(', ') };
      }
      case "bulk_update_tasks": {
        const matched = chatFilterTasks(args.filter); if (matched.length === 0) return { summary: "No tasks matched the filter" };
        for (const t of matched) {
          applyWhitelistedUpdates(t, args.updates || {}, TASK_UPDATE_FIELDS);
          t.updatedAt = nowIso();
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
        const todayD = new Date(new Date().toDateString());
        const todayTasks = state.tasks.filter(function(t) { return t.date === targetDate && t.status !== 'Done'; });
        const overdueTasks = state.tasks.filter(function(t) { return t.date && new Date(t.date) < todayD && t.status !== 'Done'; });
        const parts = ["📅 " + todayTasks.length + " task" + (todayTasks.length !== 1 ? "s" : "") + " today"];
        if (overdueTasks.length) parts.push("⚠ " + overdueTasks.length + " overdue");
        return { summary: parts.join(' · ') };
      }
      case "get_stats": {
        const today = new Date(new Date().toDateString());
        const thisMonthStr = today.toISOString().slice(0,7);
        const lastMonthDate = new Date(today); lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
        const r = { visitsThisMonth: state.visits.filter(function(v) { return v.date && v.date.slice(0,7) === thisMonthStr; }).length,
          visitsLastMonth: state.visits.filter(function(v) { return v.date && v.date.slice(0,7) === lastMonthDate.toISOString().slice(0,7); }).length,
          openTasks: state.tasks.filter(function(t) { return t.status !== 'Done'; }).length,
          overdueCount: state.tasks.filter(function(t) { return t.date && new Date(t.date) < today && t.status !== 'Done'; }).length };
        return { summary: JSON.stringify(r) };
      }
      // ===== LEARNING TAB TOOLS =====
      // Only URL-type items can be added via chat (file uploads need the UI).
      case "add_learning_item": {
        if (!args.url || !args.title || !args.category) {
          throw new Error("url, title, and category are required");
        }
        if (!/^https?:\/\//i.test(args.url)) {
          throw new Error("url must start with http:// or https://");
        }
        const doc = {
          id: newId('DOC'), title: args.title, type: 'url', category: args.category,
          description: args.description || '', url: args.url,
          driveFileId: '', driveLink: '', mimeType: '',
          uploadedBy: getCurrentUser(), uploadedAt: nowIso(), updatedAt: nowIso()
        };
        state.documents.push(doc);
        await upsertRow(SHEET_TABS.documents, DOCUMENT_COLS, doc);
        return { summary: 'Added link "' + doc.title + '" to ' + doc.category, id: doc.id, title: doc.title };
      }
      case "search_learning": {
        const q = (args.query || '').toLowerCase();
        const cat = args.category || '';
        const matches = (state.documents || []).filter(function(d) {
          if (cat && d.category !== cat) return false;
          if (q) {
            const hay = ((d.title || '') + ' ' + (d.description || '') + ' ' + (d.category || '')).toLowerCase();
            if (hay.indexOf(q) === -1) return false;
          }
          return true;
        }).slice(0, 20).map(function(d) {
          return { id: d.id, title: d.title, type: d.type, category: d.category,
                   url: d.type === 'url' ? d.url : d.driveLink, description: d.description };
        });
        return { summary: 'Found ' + matches.length + ' learning item' + (matches.length === 1 ? '' : 's'), results: matches };
      }
      case "delete_learning_item": {
        if (!args.id) throw new Error("id is required");
        const d = (state.documents || []).find(function(x) { return x.id === args.id; });
        if (!d) throw new Error("Learning item not found: " + args.id);
        // For file-type items, move the Drive file to trash. URL-type just removes the row.
        if (d.type === 'file' && d.driveFileId) {
          await deleteDriveFile(d.driveFileId);
        }
        await deleteRowById(SHEET_TABS.documents, d.id);
        state.documents = state.documents.filter(function(x) { return x.id !== d.id; });
        return { summary: 'Deleted "' + (d.title || 'item') + '"' + (d.type === 'file' ? ' (file moved to Drive trash)' : '') };
      }
      case "add_company": {
        const notesParts = []; if (args.notes) notesParts.push(args.notes); if (args.contactTitle) notesParts.push("Title: " + args.contactTitle);
        const c = { id: newId('CO'), name: args.name, industry: args.industry || '', size: args.size || '', makes: args.makes || '',
          address: args.address || '', contact: args.contact || '', phone: args.phone || '', email: args.email || '',
          website: args.website || '', linkedin: args.linkedin || '', status: args.status || 'Prospect', value: args.value || '',
          owner: args.owner || 'Prrithive', lastInteraction: '', notes: notesParts.join(' · '), createdAt: nowIso(), updatedAt: nowIso() };
        state.companies.push(c); await upsertRow(SHEET_TABS.companies, COMPANY_COLS, c);
        return { summary: 'Added company "' + c.name + '"' + (c.contact ? " (" + c.contact + ")" : ""), id: c.id, name: c.name };
      }
      case "update_company": {
        const c = state.companies.find(function(x) { return x.id === args.id; }); if (!c) throw new Error("Company not found: " + args.id);
        applyWhitelistedUpdates(c, args, COMPANY_UPDATE_FIELDS);
        c.updatedAt = nowIso();
        await upsertRow(SHEET_TABS.companies, COMPANY_COLS, c); return { summary: "Updated " + c.name };
      }
      // ===== DAILY LOG TOOLS =====
      // All four tools are per-user: createdBy/updatedBy come from the signed-in
      // user's lowercased OAuth email (ignored if the model sends one). query_log
      // also filters to the current user — Daily Log is a personal record.
      case "add_log_entry": {
        const me = (state.currentEmail || '').toLowerCase();
        if (!me) throw new Error("Not signed in");
        if (!args.title || !args.date || !args.startTime || !args.endTime) {
          throw new Error("title, date, startTime, endTime are required");
        }
        if (logTimeToMin(args.endTime) <= logTimeToMin(args.startTime)) {
          throw new Error("endTime must be after startTime");
        }
        const entry = {
          id: newId('LOG'),
          date: args.date,
          startTime: args.startTime,
          endTime: args.endTime,
          title: args.title,
          done: (args.done === true || String(args.done).toLowerCase() === 'true') ? 'TRUE' : 'FALSE',
          comment: args.comment || '',
          createdAt: nowIso(),
          createdBy: me,
          updatedAt: nowIso(),
          updatedBy: me
        };
        state.dailyLog.push(entry);
        await upsertRow(SHEET_TABS.dailylog, DAILYLOG_COLS, entry);
        return { summary: 'Logged "' + entry.title + '" ' + entry.date + ' ' + entry.startTime + '–' + entry.endTime, id: entry.id };
      }
      case "tick_log_entry": {
        const me = (state.currentEmail || '').toLowerCase();
        if (!me) throw new Error("Not signed in");
        const e = state.dailyLog.find(function(x) { return x.id === args.id; });
        if (!e) throw new Error("Log entry not found: " + args.id);
        if ((e.createdBy || '').toLowerCase() !== me) throw new Error("Cannot modify another user's log entry");
        // If done is provided, set it; otherwise toggle.
        let nowDone;
        if (args.done === true || String(args.done).toLowerCase() === 'true') nowDone = true;
        else if (args.done === false || String(args.done).toLowerCase() === 'false') nowDone = false;
        else nowDone = !logDoneBool(e.done);
        e.done = nowDone ? 'TRUE' : 'FALSE';
        e.updatedAt = nowIso();
        e.updatedBy = me;
        await upsertRow(SHEET_TABS.dailylog, DAILYLOG_COLS, e);
        return { summary: (nowDone ? 'Ticked "' : 'Unticked "') + e.title + '"' };
      }
      case "update_log_entry": {
        const me = (state.currentEmail || '').toLowerCase();
        if (!me) throw new Error("Not signed in");
        const e = state.dailyLog.find(function(x) { return x.id === args.id; });
        if (!e) throw new Error("Log entry not found: " + args.id);
        if ((e.createdBy || '').toLowerCase() !== me) throw new Error("Cannot modify another user's log entry");
        // Normalise done before whitelist apply.
        const sanitized = Object.assign({}, args);
        if (sanitized.done !== undefined) {
          sanitized.done = (sanitized.done === true || String(sanitized.done).toLowerCase() === 'true') ? 'TRUE' : 'FALSE';
        }
        applyWhitelistedUpdates(e, sanitized, LOG_UPDATE_FIELDS);
        if (e.startTime && e.endTime && logTimeToMin(e.endTime) <= logTimeToMin(e.startTime)) {
          throw new Error("endTime must be after startTime");
        }
        e.updatedAt = nowIso();
        e.updatedBy = me;
        await upsertRow(SHEET_TABS.dailylog, DAILYLOG_COLS, e);
        return { summary: 'Updated log entry "' + e.title + '"' };
      }
      case "query_log": {
        const me = (state.currentEmail || '').toLowerCase();
        if (!me) return { summary: 'Not signed in', results: [] };
        const f = args.filter || {};
        const matched = state.dailyLog.filter(function(e) {
          if ((e.createdBy || '').toLowerCase() !== me) return false;
          if (f.dateExact && e.date !== f.dateExact) return false;
          if (f.dateRange) {
            if (f.dateRange.from && e.date < f.dateRange.from) return false;
            if (f.dateRange.to && e.date > f.dateRange.to) return false;
          }
          if (f.done !== undefined && f.done !== null) {
            const want = (f.done === true || String(f.done).toLowerCase() === 'true');
            if (logDoneBool(e.done) !== want) return false;
          }
          if (f.search) {
            const s = String(f.search).toLowerCase();
            if (((e.title || '') + ' ' + (e.comment || '')).toLowerCase().indexOf(s) === -1) return false;
          }
          return true;
        });
        const done = matched.filter(function(e) { return logDoneBool(e.done); }).length;
        const pct = matched.length === 0 ? 0 : Math.round((done / matched.length) * 100);
        return {
          summary: 'Found ' + matched.length + ' log entr' + (matched.length === 1 ? 'y' : 'ies') + ' · ' + done + '/' + matched.length + ' ticked (' + pct + '%)',
          results: matched.slice(0, 50).map(function(e) {
            return { id: e.id, date: e.date, startTime: e.startTime, endTime: e.endTime, title: e.title, done: logDoneBool(e.done), comment: e.comment };
          })
        };
      }
      case "log_visit": {
        const v = { id: newId('VIS'), companyId: args.companyId, date: args.date, type: args.type,
          outcome: args.outcome || 'Positive', notes: args.notes || '', nextStep: args.nextStep || '',
          loggedBy: args.loggedBy || 'Prrithive', createdAt: nowIso() };
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
      if (filter.reviewer) { if (t.reviewer !== filter.reviewer) return false; }
      if (filter.reviewStatus) { if (t.reviewStatus !== filter.reviewStatus) return false; }
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
