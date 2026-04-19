/* drive.js — Google Drive file attachments */

async function driveRequest(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + accessToken, ...(opts.headers || {}) } });
  if(!r.ok) throw new Error('Drive API ' + r.status);
  return r.json();
}

async function findOrCreateFolder(name, parentId) {
  let q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if(parentId) q += ` and '${parentId}' in parents`;
  const search = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`);
  if(search.files && search.files.length > 0) return search.files[0].id;
  const meta = { name, mimeType: 'application/vnd.google-apps.folder' };
  if(parentId) meta.parents = [parentId];
  const created = await driveRequest('https://www.googleapis.com/drive/v3/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) });
  return created.id;
}

async function getMapleRootFolder() { return MAPLE_ROOT_FOLDER_ID; }

async function getCompanyFolder(companyName) {
  const rootId = await getMapleRootFolder();
  return await findOrCreateFolder(companyName, rootId);
}

async function uploadFileToDrive(file, folderId) {
  const metadata = { name: file.name, parents: [folderId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,thumbnailLink,size,createdTime', { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken }, body: form });
  if(!r.ok) throw new Error('Upload failed: ' + r.status);
  return await r.json();
}

async function listFilesInFolder(folderId) {
  const q = `'${folderId}' in parents and trashed=false`;
  const result = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,webViewLink,thumbnailLink,size,createdTime)&orderBy=createdTime desc&pageSize=50`);
  return result.files || [];
}

function fileIcon(mimeType) {
  if(!mimeType) return '📄'; if(mimeType.startsWith('image/')) return '🖼️'; if(mimeType.includes('pdf')) return '📕';
  if(mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
  if(mimeType.includes('document') || mimeType.includes('word')) return '📝';
  if(mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📽️';
  if(mimeType.includes('dwg') || mimeType.includes('dxf') || mimeType.includes('cad') || mimeType.includes('acad')) return '📐';
  if(mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar')) return '📦'; return '📄';
}

function formatFileSize(bytes) { if(!bytes) return ''; const b = Number(bytes); if(b < 1024) return b + ' B'; if(b < 1048576) return (b/1024).toFixed(1) + ' KB'; return (b/1048576).toFixed(1) + ' MB'; }

async function renderCompanyFiles(companyName) {
  const grid = document.getElementById('companyFiles'); if(!grid) return;
  if(!accessToken) { grid.innerHTML = '<div class="empty-mini">Sign in to see files</div>'; return; }
  grid.innerHTML = '<div class="empty-mini" style="font-style:italic">Loading files...</div>';
  try {
    const folderId = await getCompanyFolder(companyName);
    document.getElementById('fileDropZone').dataset.folderId = folderId;
    const files = await listFilesInFolder(folderId);
    if(files.length === 0) { grid.innerHTML = '<div class="empty-mini">No files yet — upload quotes, drawings, or photos above</div>'; return; }
    grid.innerHTML = files.map(f => {
      const isImage = f.mimeType && f.mimeType.startsWith('image/');
      const thumb = isImage && f.thumbnailLink ? `<img class="file-card-thumb" src="${f.thumbnailLink}" alt="">` : `<div class="file-card-icon">${fileIcon(f.mimeType)}</div>`;
      return `<a class="file-card" href="${f.webViewLink}" target="_blank" rel="noopener" title="Open in Google Drive">${thumb}<div class="file-card-name">${esc(f.name)}</div><div class="file-card-meta">${formatFileSize(f.size)}</div></a>`;
    }).join('');
  } catch(e) { console.error('Drive list error', e); grid.innerHTML = '<div class="empty-mini">Could not load files</div>'; }
}

async function handleFileUpload(fileList) {
  const files = Array.from(fileList || []); if(files.length === 0) return;
  const company = state.editingCompany; if(!company) { toast('No company selected', true); return; }
  if(!accessToken) { toast('Sign in first', true); return; }
  const progress = document.getElementById('fileUploadProgress'); progress.classList.add('show');
  try {
    const folderId = document.getElementById('fileDropZone').dataset.folderId || await getCompanyFolder(company.name);
    for(let i = 0; i < files.length; i++) { progress.textContent = `Uploading ${i+1}/${files.length}: ${files[i].name}...`; await uploadFileToDrive(files[i], folderId); }
    toast(`${files.length} file${files.length>1?'s':''} uploaded`);
    await renderCompanyFiles(company.name);
  } catch(e) { console.error('Upload error', e); toast('Upload failed: ' + e.message, true); }
  finally { progress.classList.remove('show'); document.getElementById('fileUploadInput').value = ''; }
}

function handleFileDrop(event) { const files = event.dataTransfer?.files; if(files && files.length > 0) handleFileUpload(files); }

// ===== TASK FILE ATTACHMENTS =====
async function getTaskFilesFolder() {
  const rootId = await getMapleRootFolder();
  return await findOrCreateFolder('Task Files', rootId);
}

async function getTaskFolder(taskId, taskName) {
  const parentId = await getTaskFilesFolder();
  const folderName = taskName || taskId;
  return await findOrCreateFolder(folderName, parentId);
}

async function renderTaskFiles(taskId) {
  const grid = document.getElementById('taskFiles'); if (!grid) return;
  if (!accessToken) { grid.innerHTML = '<div class="empty-mini">Sign in to see files</div>'; return; }

  // Check if task has any files by looking at links field
  const t = state.tasks.find(function(x) { return x.id === taskId; });
  if (!t) return;

  grid.innerHTML = '<div class="empty-mini" style="font-style:italic">Loading files...</div>';
  try {
    const tsk = state.tasks.find(function(x) { return x.id === taskId; });
    const folderId = await getTaskFolder(taskId, tsk ? tsk.name : taskId);
    document.getElementById('taskFileDropZone').dataset.folderId = folderId;
    document.getElementById('taskFileDropZone').dataset.taskId = taskId;
    const files = await listFilesInFolder(folderId);
    if (files.length === 0) {
      grid.innerHTML = '<div class="empty-mini">No files attached — drop files above</div>';
      return;
    }
    grid.innerHTML = files.map(function(f) {
      const isImage = f.mimeType && f.mimeType.startsWith('image/');
      const thumb = isImage && f.thumbnailLink ? '<img class="file-card-thumb" src="' + f.thumbnailLink + '" alt="">' : '<div class="file-card-icon">' + fileIcon(f.mimeType) + '</div>';
      return '<a class="file-card" href="' + f.webViewLink + '" target="_blank" rel="noopener" title="Open in Google Drive">' + thumb + '<div class="file-card-name">' + esc(f.name) + '</div><div class="file-card-meta">' + formatFileSize(f.size) + '</div></a>';
    }).join('');
  } catch (e) {
    console.error('Task files error', e);
    grid.innerHTML = '<div class="empty-mini">Could not load files</div>';
  }
}

async function handleTaskFileUpload(fileList) {
  const files = Array.from(fileList || []); if (files.length === 0) return;
  if (!accessToken) { toast('Sign in first', true); return; }
  const taskId = document.getElementById('taskFileDropZone').dataset.taskId;
  if (!taskId) { toast('No task selected', true); return; }
  const progress = document.getElementById('taskFileProgress'); progress.classList.add('show');
  try {
    var tsk2 = state.tasks.find(function(x) { return x.id === taskId; });
    const folderId = document.getElementById('taskFileDropZone').dataset.folderId || await getTaskFolder(taskId, tsk2 ? tsk2.name : taskId);
    for (var i = 0; i < files.length; i++) {
      progress.textContent = 'Uploading ' + (i+1) + '/' + files.length + ': ' + files[i].name + '...';
      await uploadFileToDrive(files[i], folderId);
    }
    toast(files.length + ' file' + (files.length > 1 ? 's' : '') + ' attached');
    // Mark task as having attachments
    var taskObj = state.tasks.find(function(x) { return x.id === taskId; });
    if (taskObj) {
      if (!taskObj.links || taskObj.links.indexOf('drive-attached') === -1) {
        taskObj.links = taskObj.links ? taskObj.links + ' | drive-attached' : 'drive-attached';
      }
      taskObj.updatedAt = nowIso();
      await upsertRow(SHEET_TABS.tasks, TASK_COLS, taskObj);
      cacheLocal();
      renderTaskView();
    }
    await renderTaskFiles(taskId);
  } catch (e) {
    console.error('Task upload error', e);
    toast('Upload failed: ' + e.message, true);
  } finally {
    progress.classList.remove('show');
    document.getElementById('taskFileUploadInput').value = '';
  }
}

function handleTaskFileDrop(event) {
  var files = event.dataTransfer ? event.dataTransfer.files : null;
  if (files && files.length > 0) handleTaskFileUpload(files);
}
