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
      setSync('connected', 'Connected');
      // Fetch the user's email to determine role (Prrithive / Sridharan / Unknown)
      // This runs once per sign-in. Must complete before pullAll so review logic knows who we are.
      fetchUserEmail().then(function(){ pullAll(); }).catch(function(e){
        console.warn('User email fetch failed', e);
        pullAll();  // proceed anyway — user will see "Unknown" read-only
      });
      const expiresIn = (resp.expires_in || 3600) * 1000;
      if(tokenRefreshTimer) clearTimeout(tokenRefreshTimer);
      tokenRefreshTimer = setTimeout(silentRefresh, Math.max(60000, expiresIn - 5*60*1000));
    }
  });
  silentRefresh();
}

// Fetch the signed-in user's email from Google userinfo endpoint.
// Requires the userinfo.email scope (added in config.js SCOPES).
async function fetchUserEmail() {
  if (!accessToken) return;
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + accessToken }
    });
    if (!r.ok) throw new Error('userinfo ' + r.status);
    const data = await r.json();
    const email = (data.email || '').toLowerCase();
    state.currentEmail = email;
    state.currentUser = USER_EMAILS[email] || 'Unknown';
    console.log('Signed in as:', email, '→ role:', state.currentUser);
    if (state.currentUser === 'Unknown') {
      toast('Unknown user — review actions disabled', true);
    }
  } catch (e) {
    console.error('fetchUserEmail failed', e);
    state.currentEmail = '';
    state.currentUser = 'Unknown';
  }
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
