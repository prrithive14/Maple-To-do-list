/* auth.js — Google OAuth sign-in and token management.
   Hybrid auth strategy (GitHub Pages + modern browsers block 3p cookies, so the
   pure Token Client silent path falls back to a popup that load-time code can't
   open). Two GIS clients work together:
     1. On load, `google.accounts.id` (Sign-In) does a browser-native silent session
        check. FedCM is its default behavior — there is no flag to toggle. If a
        Google session exists, handleIdCredential fires; we then call the Token
        Client with prompt: '' to mint the access token (no UI: consent was
        previously granted for this client + scope).
     2. If FedCM reports no session (skipped / notDisplayed / dismissed),
        handleIdNotification reveals the Sign in button. googleSignIn() then
        opens the consent flow on a real user gesture.
     3. After the first token, a setTimeout 5 min before expiry calls
        silentRefresh() (Token Client, prompt: 'none'). This runs *after* a
        session is established, where the iframe path is more reliable.
     4. setTimeout can be throttled in backgrounded tabs, so visibilitychange
        re-checks expiry and refreshes proactively if inside the lead window.
     5. The Sign in button is hidden in HTML and only revealed on a confirmed
        no-session signal — so it never flashes before FedCM resolves.
     6. 5s belt-and-braces: if no token by then, reveal the button anyway. */

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
  // Browser-capability check for diagnostics — does NOT tell us whether GIS itself
  // chose FedCM internally (that's not exposed), only whether the browser supports
  // the underlying IdentityCredential API. Useful for triaging father's machine.
  console.log('[auth] FedCM supported by browser: ' + ('IdentityCredential' in window));
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
  // Hybrid path: ask the Sign-In (ID) client to do a FedCM-based silent session
  // check. On confirmed session → handleIdCredential mints the token via the
  // Token Client. On no-session moments → handleIdNotification reveals the Sign
  // in button. This replaces the on-load tokenClient.requestAccessToken({prompt:
  // 'none'}) call that was getting popup-blocked under strict 3p-cookie rules.
  if (google.accounts.id && typeof google.accounts.id.initialize === 'function') {
    console.log('[auth] initAuth: configuring id client (FedCM session check)');
    google.accounts.id.initialize({
      client_id: cfg.clientId,
      callback: handleIdCredential,
      auto_select: true,
      itp_support: true,
    });
    google.accounts.id.prompt(handleIdNotification);
  } else {
    // No id client available (very old GIS bundle or odd CDN failure). Best we
    // can do is the legacy direct silent refresh, knowing it may popup-block.
    console.warn('[auth] id client unavailable, falling back to direct silentRefresh');
    silentRefresh();
  }
  // Belt-and-braces: if neither the id callback nor the token callback has fired
  // within a few seconds, reveal the Sign in button so a stalled GIS load /
  // unsupported FedCM doesn't leave the user stuck.
  setTimeout(function() {
    if (!accessToken) {
      console.warn('[auth] ' + SIGNIN_FALLBACK_MS + 'ms fallback fired: no token yet, revealing Sign in button');
      showSignInButton();
    }
  }, SIGNIN_FALLBACK_MS);
}

// Fires when google.accounts.id confirms a Google session via FedCM (auto-select
// returning user) or via an interactive One Tap selection. We do NOT decode or
// store the JWT in `resp.credential` — its presence alone is the "session is
// live" signal we need before asking the Token Client for an access token.
// Calling requestAccessToken with prompt: '' here is the documented no-UI path:
// since consent was previously granted for this client + scope, GIS mints the
// token without showing anything. (If GIS DOES try a popup here — same failure
// mode as today — Phase 3.1 will switch the Token Client to ux_mode: 'redirect'.
// The follow-up is pre-approved per the working agreement.)
function handleIdCredential(resp) {
  console.log('[auth] id.callback: session confirmed, requesting access token (credential length=' + (resp && resp.credential ? resp.credential.length : 0) + ')');
  if (!tokenClient) {
    console.warn('[auth] id.callback fired before tokenClient ready — ignoring');
    return;
  }
  try { tokenClient.requestAccessToken({ prompt: '' }); }
  catch(e) {
    console.warn('[auth] requestAccessToken threw synchronously after id.callback', e);
    showSignInButton();
  }
}

// Called for every PromptMomentNotification from google.accounts.id.prompt().
// We extract every documented method's value defensively (any of them can be
// missing or throw on edge cases) and log the whole dump alongside a derived
// `reason` string — per the spec, the named reason methods can return null and
// we want full diagnostic detail if the hybrid path still fails.
function handleIdNotification(n) {
  function safeCall(fnName) {
    try { return typeof n[fnName] === 'function' ? n[fnName]() : undefined; }
    catch(e) { return '(threw:' + e.message + ')'; }
  }
  const dump = {
    momentType: safeCall('getMomentType'),
    isDisplayMoment: safeCall('isDisplayMoment'),
    isDisplayed: safeCall('isDisplayed'),
    isNotDisplayed: safeCall('isNotDisplayed'),
    notDisplayedReason: safeCall('getNotDisplayedReason'),
    isSkippedMoment: safeCall('isSkippedMoment'),
    skippedReason: safeCall('getSkippedReason'),
    isDismissedMoment: safeCall('isDismissedMoment'),
    dismissedReason: safeCall('getDismissedReason'),
  };
  let reason = '(unknown)';
  if (dump.isDisplayMoment) reason = 'displayed';
  else if (dump.isNotDisplayed) reason = 'notDisplayed:' + dump.notDisplayedReason;
  else if (dump.isSkippedMoment) reason = 'skipped:' + dump.skippedReason;
  else if (dump.isDismissedMoment) reason = 'dismissed:' + dump.dismissedReason;
  console.log('[auth] id.prompt notification reason=' + reason + ' raw=' + JSON.stringify(dump));
  // Only reveal the Sign in button on terminal "no session" moments. A display
  // moment means the prompt UI is up; we wait for the credential callback.
  if (reason !== 'displayed') showSignInButton();
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
  // FedCM=<bool> here reflects browser capability only. GIS doesn't expose
  // whether it actually used the FedCM path internally vs. an iframe / popup —
  // this log is for triage (e.g. if father's machine reports FedCM=false we
  // know to check Chrome version / flags).
  console.log('[auth] silentRefresh: using FedCM=' + ('IdentityCredential' in window) + ' (browser capability) at ' + new Date().toISOString());
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
