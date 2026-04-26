/* learning.js — Learning tab: training documents and curated links */

// ===== STATE HELPERS =====
// Returns the union of seed categories and any categories that exist on actual documents.
// Sorted alphabetically. "All" is rendered separately by the UI.
function getLearningCategories() {
  const seeds = LEARNING_SEED_CATEGORIES || [];
  const fromDocs = (state.documents || []).map(function(d) { return d.category || ''; }).filter(Boolean);
  const all = Array.from(new Set([].concat(seeds, fromDocs)));
  all.sort(function(a, b) { return a.localeCompare(b); });
  return all;
}

function getLearningCategoryCount(category) {
  return (state.documents || []).filter(function(d) { return d.category === category; }).length;
}

function getFilteredLearningDocs() {
  const search = (document.getElementById('learningSearch')?.value || '').toLowerCase();
  const cat = state.currentLearningCategory || '';
  return (state.documents || []).filter(function(d) {
    if (cat && d.category !== cat) return false;
    if (search) {
      const haystack = ((d.title || '') + ' ' + (d.description || '') + ' ' + (d.category || '')).toLowerCase();
      if (haystack.indexOf(search) === -1) return false;
    }
    return true;
  }).sort(function(a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
}

function setLearningCategory(cat) {
  state.currentLearningCategory = cat || '';
  renderLearning();
}

// ===== RENDER =====
function renderLearning() {
  const root = document.getElementById('learningContainer');
  if (!root) return;

  const cats = getLearningCategories();
  const totalCount = (state.documents || []).length;
  const currentCat = state.currentLearningCategory || '';

  // Sidebar — "All" + each category with count
  const sidebarHtml =
    '<div class="library-sidebar-section"><div class="library-cat ' + (currentCat === '' ? 'active' : '') + '" onclick="setLearningCategory(\'\')">' +
      '<span class="library-cat-name">📚 All</span>' +
      '<span class="library-cat-count">' + totalCount + '</span>' +
    '</div></div>' +
    '<div class="library-sidebar-section">' +
      cats.map(function(c) {
        const count = getLearningCategoryCount(c);
        const empty = count === 0 ? ' empty' : '';
        const active = (currentCat === c) ? ' active' : '';
        return '<div class="library-cat' + active + empty + '" onclick="setLearningCategory(\'' + esc(c).replace(/'/g, "\\'") + '\')">' +
          '<span class="library-cat-name">' + esc(c) + '</span>' +
          '<span class="library-cat-count">' + count + '</span>' +
        '</div>';
      }).join('') +
    '</div>';

  // Card grid
  const docs = getFilteredLearningDocs();
  let gridHtml;
  if (docs.length === 0) {
    if (totalCount === 0) {
      gridHtml = '<div class="empty"><h3>No learning items yet</h3><p>Upload a file or add a link to get started.</p></div>';
    } else {
      gridHtml = '<div class="empty"><h3>No matches</h3><p>Try a different category or search term.</p></div>';
    }
  } else {
    gridHtml = '<div class="library-grid">' + docs.map(function(d) { return learningCardHtml(d); }).join('') + '</div>';
  }

  root.innerHTML =
    '<div class="library-layout">' +
      '<aside class="library-sidebar">' + sidebarHtml + '</aside>' +
      '<div>' +
        '<div class="library-toolbar">' +
          '<div class="library-current-category">' + (currentCat ? esc(currentCat) : 'All Items') + '</div>' +
          '<input class="search-input" id="learningSearch" placeholder="Search learning items…" oninput="renderLearning()" value="' + esc(document.getElementById('learningSearch')?.value || '') + '">' +
          '<button class="btn btn-sm" onclick="openAddLinkModal()">🔗 Add link</button>' +
          '<button class="btn btn-primary btn-sm" onclick="openUploadFileModal()">📁 Upload file</button>' +
        '</div>' +
        gridHtml +
      '</div>' +
    '</div>';

  // Restore search focus if user was typing (oninput re-renders, which loses focus)
  const searchInput = document.getElementById('learningSearch');
  if (searchInput && document.activeElement?.id !== 'learningSearch' && searchInput.value) {
    // Don't auto-focus on render — that would be annoying. Just preserve value (already done via attribute).
  }
}

function learningCardHtml(d) {
  const isUrl = d.type === 'url';
  const icon = isUrl ? '🔗' : fileIcon(d.mimeType);
  const link = isUrl ? d.url : d.driveLink;
  const linkAttr = link ? 'href="' + esc(link) + '" target="_blank" rel="noopener"' : 'href="#" onclick="event.preventDefault()"';
  const desc = (d.description || '').trim();
  const descSnippet = desc.length > 120 ? esc(desc.substring(0, 120)) + '…' : esc(desc);
  return '<div class="library-card" data-doc-id="' + esc(d.id) + '">' +
    '<a class="library-card-body" ' + linkAttr + ' style="display:block;text-decoration:none;color:inherit">' +
      '<div class="library-card-header">' +
        '<div class="library-card-icon">' + icon + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div class="library-card-title" style="font-weight:500;line-height:1.3;margin-bottom:4px">' + esc(d.title || '(untitled)') + '</div>' +
          (d.category ? '<span class="pill pill-cat">' + esc(d.category) + '</span>' : '') +
        '</div>' +
      '</div>' +
      (descSnippet ? '<div style="font-size:12px;color:var(--ink-soft);margin-top:8px;line-height:1.4">' + descSnippet + '</div>' : '') +
      '<div style="font-size:11px;color:var(--ink-mute);margin-top:8px">' +
        (isUrl ? 'Link' : 'File') + ' · ' + (d.uploadedBy ? esc(d.uploadedBy) + ' · ' : '') + (d.uploadedAt ? formatDate(d.uploadedAt.slice(0, 10)) : '') +
      '</div>' +
    '</a>' +
    '<div style="display:flex;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid var(--line)">' +
      '<button class="btn btn-sm" onclick="event.stopPropagation();openEditLearningModal(\'' + esc(d.id) + '\')">Edit</button>' +
      '<button class="btn btn-sm btn-danger" onclick="event.stopPropagation();handleDeleteLearningItem(\'' + esc(d.id) + '\')">Delete</button>' +
    '</div>' +
  '</div>';
}

// ===== MODALS =====
// Three modals share the same DOM container — switch which fields are visible based on type.

function openUploadFileModal() {
  const m = document.getElementById('learningUploadModal');
  if (!m) return;
  document.getElementById('luFile').value = '';
  document.getElementById('luTitle').value = '';
  document.getElementById('luCategory').value = state.currentLearningCategory || '';
  document.getElementById('luDescription').value = '';
  populateLearningCategoryDatalist();
  m.classList.add('open');
}

function closeUploadFileModal() {
  document.getElementById('learningUploadModal').classList.remove('open');
}

function openAddLinkModal() {
  const m = document.getElementById('learningLinkModal');
  if (!m) return;
  document.getElementById('llUrl').value = '';
  document.getElementById('llTitle').value = '';
  document.getElementById('llCategory').value = state.currentLearningCategory || '';
  document.getElementById('llDescription').value = '';
  populateLearningCategoryDatalist();
  m.classList.add('open');
}

function closeAddLinkModal() {
  document.getElementById('learningLinkModal').classList.remove('open');
}

function openEditLearningModal(id) {
  const d = (state.documents || []).find(function(x) { return x.id === id; });
  if (!d) { toast('Item not found', true); return; }
  const m = document.getElementById('learningEditModal');
  document.getElementById('leId').value = d.id;
  document.getElementById('leTitle').value = d.title || '';
  document.getElementById('leCategory').value = d.category || '';
  document.getElementById('leDescription').value = d.description || '';
  populateLearningCategoryDatalist();
  m.classList.add('open');
}

function closeEditLearningModal() {
  document.getElementById('learningEditModal').classList.remove('open');
}

// Populate the shared datalist so all three modals get autocomplete on category.
function populateLearningCategoryDatalist() {
  const dl = document.getElementById('learningCategoriesDatalist');
  if (!dl) return;
  const cats = getLearningCategories();
  dl.innerHTML = cats.map(function(c) { return '<option value="' + esc(c) + '">'; }).join('');
}

// Auto-fill the title field when a file is selected (uses filename without extension)
function onLearningFileSelected() {
  const fileInput = document.getElementById('luFile');
  const titleInput = document.getElementById('luTitle');
  if (!fileInput || !titleInput) return;
  if (fileInput.files && fileInput.files[0] && !titleInput.value) {
    const name = fileInput.files[0].name;
    titleInput.value = name.replace(/\.[^.]+$/, ''); // strip extension
  }
}

// ===== SAVE =====
async function saveUploadFile() {
  const file = document.getElementById('luFile').files[0];
  const title = document.getElementById('luTitle').value.trim();
  const category = document.getElementById('luCategory').value.trim();
  const description = document.getElementById('luDescription').value.trim();
  if (!file) { toast('Please choose a file', true); return; }
  if (!title) { toast('Title is required', true); return; }
  if (!category) { toast('Category is required', true); return; }
  if (!accessToken) { toast('Sign in first', true); return; }

  closeUploadFileModal();
  toast('Uploading "' + file.name + '"...');
  try {
    // Upload to Drive in the right category folder
    const folderId = await getLearningCategoryFolder(category);
    const uploaded = await uploadFileToDrive(file, folderId);
    // Build the doc record and save to Sheet
    const doc = {
      id: newId('DOC'),
      title: title,
      type: 'file',
      category: category,
      description: description,
      url: '',
      driveFileId: uploaded.id,
      driveLink: uploaded.webViewLink || '',
      mimeType: uploaded.mimeType || file.type || '',
      uploadedBy: getCurrentUser(),
      uploadedAt: nowIso(),
      updatedAt: nowIso()
    };
    state.documents.push(doc);
    await upsertRow(SHEET_TABS.documents, DOCUMENT_COLS, doc);
    cacheLocal();
    refreshAll();
    toast('Uploaded "' + title + '"');
  } catch (e) {
    console.error('Learning upload error', e);
    toast('Upload failed: ' + e.message, true);
  }
}

async function saveAddLink() {
  const url = document.getElementById('llUrl').value.trim();
  const title = document.getElementById('llTitle').value.trim();
  const category = document.getElementById('llCategory').value.trim();
  const description = document.getElementById('llDescription').value.trim();
  if (!url) { toast('URL is required', true); return; }
  if (!title) { toast('Title is required', true); return; }
  if (!category) { toast('Category is required', true); return; }
  // Light URL validation — allow http(s)://
  if (!/^https?:\/\//i.test(url)) { toast('URL must start with http:// or https://', true); return; }

  closeAddLinkModal();
  try {
    const doc = {
      id: newId('DOC'),
      title: title,
      type: 'url',
      category: category,
      description: description,
      url: url,
      driveFileId: '',
      driveLink: '',
      mimeType: '',
      uploadedBy: getCurrentUser(),
      uploadedAt: nowIso(),
      updatedAt: nowIso()
    };
    state.documents.push(doc);
    await upsertRow(SHEET_TABS.documents, DOCUMENT_COLS, doc);
    cacheLocal();
    refreshAll();
    toast('Added link "' + title + '"');
  } catch (e) {
    console.error('Add link error', e);
    toast('Save failed: ' + e.message, true);
  }
}

async function saveEditLearning() {
  const id = document.getElementById('leId').value;
  const d = state.documents.find(function(x) { return x.id === id; });
  if (!d) { toast('Item not found', true); closeEditLearningModal(); return; }
  const title = document.getElementById('leTitle').value.trim();
  const category = document.getElementById('leCategory').value.trim();
  const description = document.getElementById('leDescription').value.trim();
  if (!title) { toast('Title is required', true); return; }
  if (!category) { toast('Category is required', true); return; }

  d.title = title;
  d.category = category;
  d.description = description;
  d.updatedAt = nowIso();
  closeEditLearningModal();
  try {
    await upsertRow(SHEET_TABS.documents, DOCUMENT_COLS, d);
    cacheLocal();
    refreshAll();
    toast('Updated "' + title + '"');
  } catch (e) {
    console.error('Edit error', e);
    toast('Save failed: ' + e.message, true);
  }
}

async function handleDeleteLearningItem(id) {
  const d = state.documents.find(function(x) { return x.id === id; });
  if (!d) return;
  const isFile = d.type === 'file';
  const msg = isFile
    ? 'Delete "' + (d.title || 'this item') + '"? The file will move to your Google Drive trash.'
    : 'Delete "' + (d.title || 'this item') + '"? The link will be removed.';
  if (!confirm(msg)) return;

  try {
    // For file-type items, move the Drive file to trash. For URL-type items, skip.
    if (isFile && d.driveFileId) {
      await deleteDriveFile(d.driveFileId);
    }
    // Remove the Sheet row and local state
    await deleteRowById(SHEET_TABS.documents, d.id);
    state.documents = state.documents.filter(function(x) { return x.id !== d.id; });
    cacheLocal();
    refreshAll();
    toast('Deleted "' + (d.title || 'item') + '"');
  } catch (e) {
    console.error('Learning delete error', e);
    toast('Delete failed: ' + e.message, true);
  }
}
