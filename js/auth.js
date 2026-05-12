/* auth.js — Google OAuth sign-in and token management.
   Silent refresh strategy:
   1. On load, attempt `prompt: 'none'` (strict silent). If Google session is active and
      consent was previously granted, we get a new token with no UI.
   2. On every successful token, set a setTimeout to refresh ~5 min before expiry.
   3. `setTimeout` can be throttled in backgrounded tabs, so also re-check on
      `visibilitychange` — if the token is about to expire when the tab becomes visible,
      kick a silent refresh immediately.
   4. The Sign in button is hidden in HTML and only revealed after a confirmed silent-
      refresh failure — so the user never sees it flash before silent refresh resolves. */

// Epoch millis when the current access token expires. 0 means "no valid token".
// Kept in memory only — never persisted to localStorage (would leak credentials).
let tokenExpiry = 0;
// Buffer before expiry inside which we proactively refresh.
const TOKEN_REFRESH_LEAD_MS = 5 * 60 * 1000;
// Fallback delay: if silent refresh hasn't produced a token by this point, show the
// Sign in button so the user can recover from a stalled GIS load.
const SIGNIN_FALLBACK_MS = 5000;

function showSignInButton() {
  const btn = document.getElementById('signInBtn');
  if (btn) btn.style.display = 'inline-flex';
}
function hideSignInButton() {
  const btn = document.getElementById('signInBtn');
  if (btn) btn.style.display = 'none';
}

function initAuth() {
  if (typeof google === 'undefined' || !google.accounts) {
    console.log('[auth] GIS not ready yet, retrying in 200ms');
    setTimeout(initAuth, 200);
    return;
  }
  console.log('[auth] initAuth: creating tokenClient');
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: cfg.clientId, scope: SCOPES,
    callback: (resp) => {
      if(resp.error) {
        // Log the FULL response so the failure code/subtype is captured verbatim —
        // we need this to distinguish immediate_failed (silent path expected to
        // sometimes fail) from real bugs. Phase 3 fix selection depends on this.
        console.warn('[auth] callback error=' + resp.error +
          ' subtype=' + (resp.error_subtype || '-') +
          ' description=' + (resp.error_description || '-') +
          ' details=' + JSON.stringify(resp));
        // Expected silent-failure codes: user has no active Google session, third-party
        // cookies blocked, or the user dismissed an explicit popup. Surface the button
        // without a toast — the popup attempt itself is enough signal to the user.
        const silentFailureCodes = ['immediate_failed', 'popup_failed_to_open', 'popup_closed_by_user', 'access_denied'];
        setSync('', 'Not signed in'); showSignInButton();
        if (silentFailureCodes.indexOf(resp.error) === -1) {
          toast('Sign-in failed: '+resp.error, true);
        }
        return;
      }
      accessToken = resp.access_token;
      const expiresInSec = resp.expires_in || 3600;
      tokenExpiry = Date.now() + expiresInSec * 1000;
      console.log('[auth] callback success expires_in=' + expiresInSec + 's scope=' + (resp.scope || '-'));
      hideSignInButton();
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
      if(tokenRefreshTimer) clearTimeout(tokenRefreshTimer);
      const ms = Math.max(60000, expiresInSec * 1000 - TOKEN_REFRESH_LEAD_MS);
      tokenRefreshTimer = setTimeout(silentRefresh, ms);
    }
  });
  silentRefresh();
  // Belt-and-braces #1: if silent refresh hasn't produced a token within a few seconds,
  // surface the Sign in button so a stalled GIS load doesn't leave the user stuck.
  setTimeout(function() {
    if (!accessToken) {
      console.warn('[auth] ' + SIGNIN_FALLBACK_MS + 'ms fallback fired: no token yet, revealing Sign in button');
      showSignInButton();
    }
  }, SIGNIN_FALLBACK_MS);
}

// Belt-and-braces #2: setTimeout can be throttled when the tab is backgrounded, so the
// 55-min refresh timer can fire after the token has already expired. Re-check on every
// visibility-restore event and refresh proactively if we're inside the lead window.
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState !== 'visible') return;
  if (!tokenClient || !accessToken) return;
  const remainingMs = tokenExpiry - Date.now();
  if (remainingMs < TOKEN_REFRESH_LEAD_MS) {
    console.log('[auth] visibilitychange: token expiring in ' + Math.round(remainingMs/1000) + 's, kicking silent refresh');
    silentRefresh();
  }
});

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
  tokenExpiry = 0;
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

// Strict silent refresh. `prompt: 'none'` instructs GIS to fail (with `immediate_failed`)
// rather than show any UI when consent or session selection would be needed. That's
// exactly what we want — silent on the happy path, no surprise popups, button shown
// quietly on failure.
function silentRefresh() {
  if(!tokenClient) {
    console.warn('[auth] silentRefresh called before tokenClient ready — skipping');
    return;
  }
  console.log('[auth] silentRefresh: requesting token with prompt=none at ' + new Date().toISOString());
  try { tokenClient.requestAccessToken({ prompt: 'none' }); }
  catch(e) {
    console.warn('[auth] silentRefresh threw synchronously', e);
    showSignInButton();
  }
}
// Explicit Sign in from the button. We default to '' (GIS picks the best UX:
// re-consent if scopes changed, otherwise account picker for first-time use).
function googleSignIn() {
  if(!tokenClient) { toast('Auth not ready, try again', true); return; }
  const prompt = accessToken ? '' : 'consent';
  console.log('[auth] googleSignIn: interactive request with prompt=' + (prompt || '(empty)'));
  tokenClient.requestAccessToken({ prompt });
}
function setSync(s, text) {
  const el = document.getElementById('syncStatus');
  el.className = 'sync-status ' + s;
  document.getElementById('syncText').textContent = text;
}
