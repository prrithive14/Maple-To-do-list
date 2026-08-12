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
     6. 5s belt-and-braces: if no token by then, reveal the button anyway.

   NETWORK RESILIENCE (added after users were bounced back to the login button by
   brief connectivity drops). A failed token refresh is NOT a sign-out:
     a. Any refresh failure while the current token is still valid, or while the
        browser reports offline, leaves the session intact — no button, no
        "Not signed in". We just retry.
     b. Retries use a backoff schedule instead of giving up. Previously the refresh
        timer was only ever rescheduled from the SUCCESS path, so one failed attempt
        meant no further attempts and the token silently died.
     c. `online` / `offline` events drive reconnection, so recovery is immediate
        rather than waiting out a backoff tick.
     d. If the GIS script itself failed to load (offline at boot), we re-inject it
        once connectivity is back — a CDN script tag doesn't retry itself. */

// Epoch millis when the current access token expires. 0 means "no valid token".
// Kept in memory only — never persisted to localStorage (would leak credentials).
let tokenExpiry = 0;
// Buffer before expiry inside which we proactively refresh. Deliberately generous:
// it's the window in which the backoff retries below get to run before the token
// actually dies, so a several-minute outage never reaches the user as a re-login.
const TOKEN_REFRESH_LEAD_MS = 10 * 60 * 1000;
// Fallback delay: if silent refresh hasn't produced a token by this point, show the
// Sign in button so the user can recover from a stalled GIS load.
const SIGNIN_FALLBACK_MS = 5000;
// Backoff for retrying a failed silent refresh. Climbs to 5 min and stays there —
// an outage of any length eventually recovers on its own without user action.
const AUTH_RETRY_DELAYS_MS = [5000, 15000, 30000, 60000, 120000, 300000];
let authRetryIndex = 0;
// Set once denyAccess() runs. Hard-stops all retry machinery — without it the
// backoff loop would keep re-minting tokens for a user we just locked out.
let authDenied = false;

// True while the token in hand is still usable. The distinction that matters:
// "refresh failed" is only a sign-out if this is false.
function hasLiveToken() {
  return !!accessToken && tokenExpiry > Date.now();
}

// navigator.onLine is a coarse signal (it means "has a network interface", not
// "the internet works"), so it's only ever used to SUPPRESS a sign-out, never to
// trigger one. False negatives cost us nothing; the retry loop covers them.
function isOffline() {
  return navigator.onLine === false;
}

// Queue the next silent-refresh attempt. Replaces any pending timer so the
// visibilitychange / online paths can't stack duplicate refreshes.
function scheduleAuthRetry(why) {
  if (authDenied) return;
  if (tokenRefreshTimer) clearTimeout(tokenRefreshTimer);
  const delay = AUTH_RETRY_DELAYS_MS[Math.min(authRetryIndex, AUTH_RETRY_DELAYS_MS.length - 1)];
  authRetryIndex++;
  console.log('[auth] retry #' + authRetryIndex + ' scheduled in ' + (delay / 1000) + 's — ' + why);
  tokenRefreshTimer = setTimeout(silentRefresh, delay);
}

function showSignInButton() {
  // Single choke point for the "you are logged out" UI. If the token is still live
  // the user is NOT logged out, whatever the caller thinks — swallow the request.
  // This is what stops a transient refresh error from surfacing a login button.
  if (hasLiveToken()) {
    console.log('[auth] showSignInButton suppressed — token still valid for ' +
      Math.round((tokenExpiry - Date.now()) / 1000) + 's');
    return;
  }
  const btn = document.getElementById('signInBtn');
  if (btn) btn.style.display = 'inline-flex';
}
function hideSignInButton() {
  const btn = document.getElementById('signInBtn');
  if (btn) btn.style.display = 'none';
}

// The GIS bundle comes from a CDN via a plain <script> tag, which does not retry
// itself. Boot with no connection and `google` stays undefined forever, leaving the
// app permanently stuck at "sign in" even after the network returns. Re-injecting a
// fresh tag is the only way back. Guarded so we never queue two at once.
let gisReloadPending = false;
function reloadGisScript() {
  if (gisReloadPending || typeof google !== 'undefined') return;
  gisReloadPending = true;
  console.warn('[auth] GIS script missing — re-injecting from CDN');
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true; s.defer = true;
  s.onload = function() { gisReloadPending = false; console.log('[auth] GIS script reloaded'); };
  s.onerror = function() { gisReloadPending = false; console.warn('[auth] GIS script reload failed'); };
  document.head.appendChild(s);
}

// Counts initAuth's 200ms polls so we can tell "GIS is still parsing" (normal, a few
// ticks) from "the script never arrived" (needs re-injection).
let gisWaitTicks = 0;

function initAuth() {
  if (typeof google === 'undefined' || !google.accounts) {
    gisWaitTicks++;
    // ~4s of waiting means the tag failed rather than being slow. Retry the fetch,
    // but only when there's a network to fetch over — otherwise wait for 'online'.
    if (gisWaitTicks % 20 === 0 && !isOffline()) reloadGisScript();
    if (gisWaitTicks % 20 === 0) console.log('[auth] still waiting for GIS (' + gisWaitTicks + ' ticks, offline=' + isOffline() + ')');
    setTimeout(initAuth, 200);
    return;
  }
  gisWaitTicks = 0;
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

        // A refresh that fails while the existing token is still good — or while the
        // browser is offline — is a transient network problem, not a logout. Keep the
        // session, keep the button hidden, and retry. This is the fix for "it asks me
        // to log in again every time the connection drops".
        if (hasLiveToken() || isOffline()) {
          if (isOffline()) setSync('', 'Offline — will reconnect');
          else setSync('connected', 'Connected');
          scheduleAuthRetry('refresh failed (' + resp.error + ') but session still usable');
          return;
        }

        // Genuinely no usable token. Show the button so the user CAN act, but keep
        // retrying in the background — if this was a long outage and their Google
        // session is still alive, we recover without them touching anything.
        setSync('', 'Not signed in'); showSignInButton();
        scheduleAuthRetry('refresh failed (' + resp.error + ') with no live token');
        if (silentFailureCodes.indexOf(resp.error) === -1) {
          toast('Sign-in failed: '+resp.error, true);
        }
        return;
      }
      accessToken = resp.access_token;
      const expiresInSec = resp.expires_in || 3600;
      tokenExpiry = Date.now() + expiresInSec * 1000;
      console.log('[auth] callback success expires_in=' + expiresInSec + 's scope=' + (resp.scope || '-'));
      authRetryIndex = 0;  // healthy again — next failure starts the backoff from scratch
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
    if (accessToken) return;
    if (isOffline()) {
      // No point offering a login button that cannot possibly succeed. Sit on the
      // cached data and let the 'online' handler drive recovery.
      console.log('[auth] ' + SIGNIN_FALLBACK_MS + 'ms fallback: offline, showing cached data instead of Sign in');
      setSync('', 'Offline — cached data');
      return;
    }
    console.warn('[auth] ' + SIGNIN_FALLBACK_MS + 'ms fallback fired: no token yet, revealing Sign in button');
    showSignInButton();
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
  // Offline, FedCM can't reach Google and always reports notDisplayed — that's a
  // network verdict, not a session verdict, so don't act on it.
  if (reason !== 'displayed' && !isOffline()) showSignInButton();
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

// ===== CONNECTIVITY RECOVERY =====
// The backoff timer alone would eventually recover, but waiting up to 5 minutes after
// the wifi is visibly back feels broken. These events make it immediate.
window.addEventListener('online', function() {
  console.log('[auth] browser reports online — attempting recovery');
  if (authDenied) return;
  authRetryIndex = 0;  // connectivity is a fresh start, not a continuation
  if (typeof google === 'undefined') reloadGisScript();
  if (hasLiveToken()) {
    // Session survived the outage intact. Just resync the data.
    setSync('connected', 'Connected');
    if (typeof pullAll === 'function') pullAll();
  } else {
    // Token died during the outage. prompt:'none' mints a new one with no UI as long
    // as the Google session is alive, so the user never sees a login prompt.
    if (tokenRefreshTimer) { clearTimeout(tokenRefreshTimer); tokenRefreshTimer = null; }
    silentRefresh();
  }
});

window.addEventListener('offline', function() {
  console.log('[auth] browser reports offline — holding session, pausing sync');
  if (authDenied) return;
  // Explicitly NOT clearing accessToken. The token is still valid; only the network
  // is gone. Cached data stays on screen and writes resume on reconnect.
  setSync('', 'Offline — cached data');
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
  // Latch the denial BEFORE clearing state. The retry/backoff machinery checks this
  // flag; without it, the reconnect logic would happily mint a fresh token for the
  // user we're locking out.
  authDenied = true;
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
  // Locked-out user — never re-mint. Must be first.
  if (authDenied) { console.log('[auth] silentRefresh skipped — access denied'); return; }
  if(!tokenClient) {
    console.warn('[auth] silentRefresh called before tokenClient ready — retrying');
    scheduleAuthRetry('tokenClient not ready');
    return;
  }
  // Attempting an OAuth round-trip with no network just burns a retry slot and logs
  // a scary error. Wait it out; the 'online' listener fires the moment we're back.
  if (isOffline()) {
    console.log('[auth] silentRefresh skipped — browser offline, waiting for reconnect');
    setSync('', 'Offline — will reconnect');
    scheduleAuthRetry('offline');
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
