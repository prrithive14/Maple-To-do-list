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
      // Fetch the user's email to determine role (Prrithive / Sridharan / Unknown).
      // SECURITY: fetchUserEmail now returns false for unauthorized users (and handles
      // denial internally — revokes token, shows access-denied screen). We must only
      // call pullAll if it returns true, otherwise we'd leak data to a denied user.
      fetchUserEmail().then(function(allowed){
        if (allowed) {
          // Set the assignee filter to "My tasks" so each user lands on their own view.
          // Done before pullAll so the first render uses the right filter.
          if (typeof applyMyTasksDefault === 'function') applyMyTasksDefault();
          pullAll();
        }
        // If !allowed, denyAccess() has already shown the block screen — do nothing.
      }).catch(function(e){
        // Should not happen — fetchUserEmail catches its own errors and denies access.
        // But just in case, fail closed.
        console.error('fetchUserEmail unexpectedly threw:', e);
        denyAccess('(verification error)');
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
// SECURITY: If the email is not in USER_EMAILS, this function blocks access entirely
// by revoking the token and showing the access-denied screen. The caller must check
// the return value — true = allowed, false = denied (caller should NOT proceed).
async function fetchUserEmail() {
  if (!accessToken) return false;
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

    // ===== ALLOWLIST ENFORCEMENT =====
    // If the user isn't in USER_EMAILS, deny access. Revoke the token at Google's end
    // (so cached tokens can't be reused via DevTools), clear local state, and show
    // the access-denied screen. To grant a new user access, add them to USER_EMAILS
    // in config.js — no code change needed here.
    if (state.currentUser === 'Unknown') {
      console.warn('Access denied for', email);
      await denyAccess(email);
      return false;
    }
    return true;
  } catch (e) {
    console.error('fetchUserEmail failed', e);
    // On userinfo fetch failure we cannot verify identity — fail closed for safety.
    state.currentEmail = '';
    state.currentUser = 'Unknown';
    await denyAccess('(could not verify email)');
    return false;
  }
}

// Deny access for an unauthorized user. Revokes the OAuth token at Google's end
// (so it can't be reused), clears local app state, and shows the access-denied screen.
async function denyAccess(email) {
  const tokenToRevoke = accessToken;
  // Clear local state immediately so any in-flight code can't use the token.
  accessToken = null;
  state.currentEmail = '';
  state.currentUser = 'Unknown';
  if (tokenRefreshTimer) { clearTimeout(tokenRefreshTimer); tokenRefreshTimer = null; }

  // Revoke the token at Google's end. Best-effort — even if this fails, local
  // state is already cleared and the access-denied screen blocks the UI.
  if (tokenToRevoke) {
    try {
      // google.accounts.oauth2.revoke is the official client-side revoke API.
      if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2 && google.accounts.oauth2.revoke) {
        google.accounts.oauth2.revoke(tokenToRevoke, function() {});
      } else {
        // Fallback: hit the revoke endpoint directly.
        await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(tokenToRevoke), { method: 'POST' });
      }
    } catch (e) {
      console.warn('Token revoke failed (non-fatal):', e);
    }
  }

  // Show the access-denied screen and hide the main app.
  const denied = document.getElementById('accessDenied');
  const app = document.getElementById('app');
  if (denied) {
    const emailEl = document.getElementById('accessDeniedEmail');
    if (emailEl) emailEl.textContent = email || '(unknown)';
    denied.style.display = 'flex';
  }
  if (app) app.style.display = 'none';
  setSync('error', 'Access denied');
}

// Called by the "Sign out and try a different account" button on the access-denied screen.
// Reloads the page so the user can sign in with a different Google account.
function accessDeniedReload() {
  // Clear any local cache too — an unauthorized user shouldn't see cached data
  // (though they wouldn't have any unless they were previously authorized).
  try { localStorage.removeItem('maple_cache'); } catch(e) {}
  location.reload();
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
