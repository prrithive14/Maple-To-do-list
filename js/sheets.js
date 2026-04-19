/* sheets.js — Google Sheets API helpers */

async function sheetsRead(range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(range)}`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer '+accessToken } });
  if(!r.ok) throw new Error('Read failed: '+r.status);
  return (await r.json()).values || [];
}

async function sheetsWrite(range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
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
  else { await sheetsAppend(`${tab}!A:${colLetter(cols.length)}`, [row]); }
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

async function pullAll() {
  if(!accessToken) return;
  setSync('syncing','Syncing…');
  try {
    const [tRows, cRows, vRows, aRows] = await Promise.all([
      sheetsRead(`${SHEET_TABS.tasks}!A2:Z`),
      sheetsRead(`${SHEET_TABS.companies}!A2:Z`),
      sheetsRead(`${SHEET_TABS.visits}!A2:Z`),
      sheetsRead(`${SHEET_TABS.archive}!A2:O`).catch(() => []),
    ]);
    state.tasks = tRows.filter(r=>r[0]).map(r=>rowToObj(r, TASK_COLS));
    state.companies = cRows.filter(r=>r[0]).map(r=>rowToObj(r, COMPANY_COLS));
    state.visits = vRows.filter(r=>r[0]).map(r=>rowToObj(r, VISIT_COLS));
    state.archived = aRows.filter(r=>r[0]).map(r=>rowToObj(r, ARCHIVE_COLS));
    cacheLocal(); refreshAll();
    setSync('connected','Synced '+new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}));
    autoArchiveOldDone();
  } catch(e) {
    console.error(e); setSync('error','Sync failed'); toast('Sync failed: '+e.message, true);
  }
}
