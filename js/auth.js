/* auth.js — Google OAuth sign-in and token management */

function initAuth() {
  if (typeof google === 'undefined' || !google.accounts) { setTimeout(initAuth, 200); return; }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: cfg.clientId, scope: SCOPES,
    callback: (resp) => {
      if(resp.error) {
        if(resp.error === 'popup_closed_by_user' || resp.error === 'access_denied') {
          setSync('', 'Not signed in'); document.getElementById('signInBtn').style.display = 'inline-flex'; return;
        }
        setSync('', 'Not signed in'); document.getElementById('signInBtn').style.display = 'inline-flex';
        if(resp.error !== 'immediate_failed') { toast('Sign-in failed: '+resp.error, true); }
        return;
      }
      accessToken = resp.access_token;
      document.getElementById('signInBtn').style.display = 'none';
      setSync('connected', 'Connected'); pullAll();
      const expiresIn = (resp.expires_in || 3600) * 1000;
      if(tokenRefreshTimer) clearTimeout(tokenRefreshTimer);
      tokenRefreshTimer = setTimeout(silentRefresh, Math.max(60000, expiresIn - 5*60*1000));
    }
  });
  silentRefresh();
}

function silentRefresh() {
  if(!tokenClient) return;
  try { tokenClient.requestAccessToken({ prompt: '' }); }
  catch(e) { console.warn('Silent refresh failed', e); document.getElementById('signInBtn').style.display = 'inline-flex'; }
}

function googleSignIn() {
  if(!tokenClient) { toast('Auth not ready, try again', true); return; }
  const prompt = accessToken ? '' : 'consent';
  tokenClient.requestAccessToken({ prompt });
}

function setSync(s, text) {
  const el = document.getElementById('syncStatus');
  el.className = 'sync-status ' + s;
  document.getElementById('syncText').textContent = text;
}
