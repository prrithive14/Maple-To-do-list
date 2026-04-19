/* sheets.js — Google Sheets API helpers */

async function sheetsRead(range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${range}`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer '+accessToken } });
  if(!r.ok) throw new Error('Read failed: '+r.status);
  return (await r.json()).values || [];
}

async function sheetsWrite(range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${range}?valueInputOption=RAW`;
  const r = await fetch(url, { method: 'PUT', headers: { Authorization: 'Bearer '+accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
  if(!r.ok) throw new Error('Write failed: '+r.status);
}

async function sheetsAppend(range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer '+accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
  if(!r.ok) throw new Error('Append failed: '+r.status);
  return await r.json();
}

async function findRowIndex(tab, id) {
  const rows = await sheetsRead(`${tab}!A2:A`);
  for (let i = 0; i < rows.length; i++) { if(rows[i][0] === id) return i + 2; }
  return -1;
}

async function upsertRow(tab, cols, obj) {
  if(!accessToken) throw new Error('Not signed in');
  const row = objToRow(obj, cols);
  const existingIdx = state[tabKeyForName(tab)].some(x => x.id === obj.id) ? await findRowIndex(tab, obj.id) : -1;
  if(existingIdx > 0) { await sheetsWrite(`${tab}!A${existingIdx}:${colLetter(cols.length)}${existingIdx}`, [row]); }
  else { await sheetsAppend(`${tab}!A1`, [row]); }
}

async function deleteRowById(tab, id) {
  const idx = await findRowIndex(tab, id);
  if(idx < 0) return;
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}?fields=sheets(properties(sheetId,title))`;
  const metaResp = await fetch(metaUrl, { headers: { Authorization: 'Bearer '+accessToken } });
  const meta = await metaResp.json();
  const sheet = meta.sheets.find(s => s.properties.title === tab);
  if(!sheet) return;
  const sheetId = sheet.properties.sheetId;
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: 'Bearer '+accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: idx - 1, endIndex: idx } } }] })
  });
}

// Auto-create the Deleted sheet tab if it doesn't exist
async function ensureDeletedSheet() {
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}?fields=sheets(properties(title))`;
  const metaResp = await fetch(metaUrl, { headers: { Authorization: 'Bearer '+accessToken } });
  const meta = await metaResp.json();
  const exists = meta.sheets.some(s => s.properties.title === 'Deleted');
  if(exists) return;

  // Create the sheet tab
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: 'Bearer '+accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: 'Deleted' } } }] })
  });

  // Write headers
  await sheetsWrite('Deleted!A1:O1', [DELETED_COLS]);
  console.log('Created Deleted sheet with headers');
}

async function ensureVisitPrepSheet() {
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}?fields=sheets(properties(title))`;
  const metaResp = await fetch(metaUrl, { headers: { Authorization: 'Bearer '+accessToken } });
  const meta = await metaResp.json();
  if (meta.sheets.some(function(s) { return s.properties.title === 'VisitPrep'; })) return;
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: 'Bearer '+accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: 'VisitPrep' } } }] })
  });
  await sheetsWrite('VisitPrep!A1:F1', [VISITPREP_COLS]);
}

async function pullAll() {
  if(!accessToken) return;
  setSync('syncing','Syncing…');
  try {
    // Ensure Deleted sheet exists before reading
    await ensureDeletedSheet();

    await ensureVisitPrepSheet();
    const [tRows, cRows, vRows, dRows, vpRows] = await Promise.all([
      sheetsRead('Tasks!A2:Z'),
      sheetsRead('Companies!A2:Z'),
      sheetsRead('Visits!A2:Z'),
      sheetsRead('Deleted!A2:Z').catch(function() { return []; }),
      sheetsRead('VisitPrep!A2:Z').catch(function() { return []; }),
    ]);
    state.tasks = tRows.filter(r=>r[0]).map(r=>rowToObj(r, TASK_COLS));
    state.companies = cRows.filter(r=>r[0]).map(r=>rowToObj(r, COMPANY_COLS));
    state.visits = vRows.filter(r=>r[0]).map(r=>rowToObj(r, VISIT_COLS));
    state.deleted = dRows.filter(r=>r[0]).map(r=>rowToObj(r, DELETED_COLS));
    state.visitPreps = vpRows.filter(function(r){return r[0];}).map(function(r){return rowToObj(r, VISITPREP_COLS);});
    cacheLocal(); refreshAll();
    setSync('connected','Synced '+new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}));
    autoArchiveOldDone();
  } catch(e) {
    console.error(e); setSync('error','Sync failed'); toast('Sync failed: '+e.message, true);
  }
}
