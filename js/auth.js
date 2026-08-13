/* auth.js — Google sign-in via the authorization-code flow, brokered by the Worker.

   THE PROBLEM THIS REPLACES. The previous implementation used Google Identity
   Services' *implicit* token flow: the browser asked GIS for an access token
   directly. That flow issues no refresh token, so the only way back to a working
   session after a page refresh was a silent re-auth through a hidden Google
   iframe (One Tap / FedCM). Chrome and Safari block the third-party cookies that
   path depends on, so it failed constantly and fell back to a popup that load-time
   code isn't allowed to open — surfacing the "Sign in with Google" button several
   times a day. No amount of retry logic could fix it, because an access token only
   lives an hour and nothing was allowed to outlive the page.

   HOW IT WORKS NOW.
     1. Sign in redirects the whole page to Google (no iframe, no popup, no
        third-party cookies involved — this is why it is reliable).
     2. Google redirects back with a one-time `code`. We POST it to the Worker,
        which holds the client secret and trades it for an access token AND a
        refresh token.
     3. The Worker keeps the refresh token in KV and hands back a random session
        id. That id — and nothing else — goes in localStorage.
     4. Every page load and every hourly expiry POSTs the session id to the Worker
        and gets a fresh access token back. Completely silent, no Google UI.
     5. The session id expires after SESSION_TTL_SECONDS (24h), so a real sign-in
        happens at most once a day per device.

   PKCE (code_verifier / code_challenge) is used even though the exchange is
   server-side: the `code` travels through the browser's address bar, and PKCE is
   what stops an intercepted code from being redeemable by anyone else.

   NETWORK RESILIENCE. Preserved wholesale from the previous version, because the
   failure it fixed is unrelated to the flow: a failed refresh is NOT a sign-out.
     a. Any refresh failure while the current token is still valid, or while the
        browser reports offline, leaves the session intact and just retries.
     b. Retries use a backoff schedule that always reschedules itself, so one
        failure can't leave the token to die unattended.
     c. `online` / `offline` events drive recovery immediately instead of waiting
        out a backoff tick.
     d. Exactly ONE condition logs the user out: the Worker answering 401, which
        means the session genuinely no longer exists. Every other error retries. */

// Epoch millis when the current access token expires. 0 means "no valid token".
// The access token itself is deliberately still memory-only — only the session id
// is persisted, and that is useless to anyone without the Worker.
let tokenExpiry = 0;
// Buffer before expiry inside which we proactively refresh. Deliberately generous:
// it's the window in which the backoff retries below get to run before the token
// actually dies, so a several-minute outage never reaches the user as a re-login.
const TOKEN_REFRESH_LEAD_MS = 10 * 60 * 1000;
// Backoff for retrying a failed silent refresh. Climbs to 5 min and stays there —
// an outage of any length eventually recovers on its own without user action.
const AUTH_RETRY_DELAYS_MS = [5000, 15000, 30000, 60000, 120000, 300000];
let authRetryIndex = 0;
// Set once denyAccess() runs. Hard-stops all retry machinery — without it the
// backoff loop would keep re-minting tokens for a user we just locked out.
let authDenied = false;
// True once we've resolved identity for this page load. Gates the one-time
// sign-in side effects so an hourly token refresh doesn't redo them.
let authBootstrapped = false;

// localStorage: the session id. sessionStorage: the in-flight PKCE values, which
// must not outlive the redirect round-trip they belong to.
const SESSION_KEY = 'maple_sid';
const PKCE_VERIFIER_KEY = 'maple_pkce_verifier';
const OAUTH_STATE_KEY = 'maple_oauth_state';

function getSessionId() {
  try { return localStorage.getItem(SESSION_KEY) || ''; } catch (e) { return ''; }
}
function setSessionId(sid) {
  try { localStorage.setItem(SESSION_KEY, sid); } catch (e) {}
}
function clearSessionId() {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
}

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

// ===== PKCE HELPERS =====
// crypto.subtle is https-only, which is fine (GitHub Pages is https) but means
// these will throw on a plain-http local preview — sign in from https or from
// localhost, which browsers treat as a secure context.
function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomUrlSafe(numBytes) {
  const a = new Uint8Array(numBytes);
  crypto.getRandomValues(a);
  return b64url(a);
}
async function sha256Challenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

// Strip the OAuth params off the address bar after a redirect back from Google.
// Leaving `code` in the URL would mean a browser refresh re-POSTs a code that has
// already been redeemed, which fails — and it puts a credential in history.
function cleanOAuthParamsFromUrl() {
  try {
    const url = new URL(location.href);
    ['code', 'state', 'scope', 'authuser', 'prompt', 'error', 'error_description'].forEach(p => url.searchParams.delete(p));
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch (e) {}
}

// ===== BOOT =====
// Called once from initApp(). Three mutually exclusive entry states: back from
// Google with a code, holding a session id, or neither.
function initAuth() {
  bootAuth().catch(function (e) {
    console.error('[auth] boot failed', e);
    setSync('', 'Not signed in');
    showSignInButton();
  });
}

async function bootAuth() {
  const params = new URLSearchParams(location.search);

  if (params.get('error')) {
    // User hit "Cancel" on the consent screen, or Google rejected the request.
    const err = params.get('error');
    console.warn('[auth] returned from Google with error=' + err + ' desc=' + (params.get('error_description') || '-'));
    cleanOAuthParamsFromUrl();
    setSync('', 'Not signed in');
    showSignInButton();
    if (err !== 'access_denied') toast('Sign-in failed: ' + err, true);
    return;
  }

  if (params.get('code')) {
    setSync('syncing', 'Signing in…');
    await completeSignIn(params);
    return;
  }

  if (getSessionId()) {
    // The common path by far: an ordinary page load or refresh inside the 24h
    // window. No Google round-trip, no UI — just trade the session id for a token.
    console.log('[auth] existing session found, restoring silently');
    setSync('syncing', 'Signing in…');
    silentRefresh();
    return;
  }

  console.log('[auth] no session — showing Sign in button');
  if (isOffline()) {
    // No point offering a login button that cannot possibly succeed. Sit on the
    // cached data and let the 'online' handler drive recovery.
    setSync('', 'Offline — cached data');
    return;
  }
  setSync('', 'Not signed in');
  showSignInButton();
}

// ===== STEP 1: leave for Google =====
// Full-page redirect, on a real user gesture. Nothing here can be blocked by
// popup or third-party-cookie policy, which is the whole point.
async function googleSignIn() {
  if (!cfg.clientId) { toast('Client ID not configured', true); return; }
  try {
    const verifier = randomUrlSafe(32);
    const stateToken = randomUrlSafe(16);
    // sessionStorage, not localStorage: these are single-use and scoped to the tab
    // that started the flow, so a stale pair can never be replayed in another tab.
    sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
    sessionStorage.setItem(OAUTH_STATE_KEY, stateToken);

    const challenge = await sha256Challenge(verifier);
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: OAUTH_REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      // access_type=offline is what asks for a refresh token at all; prompt=consent
      // is what makes Google actually return one on EVERY sign-in. Without the
      // latter, Google omits the refresh token for an already-consented user and
      // the new session would have nothing to refresh from.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: stateToken,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    }).toString();

    console.log('[auth] redirecting to Google (redirect_uri=' + OAUTH_REDIRECT_URI + ')');
    location.assign(authUrl);
  } catch (e) {
    console.error('[auth] failed to start sign-in', e);
    toast('Could not start sign-in', true);
  }
}

// ===== STEP 2: back from Google, redeem the code =====
async function completeSignIn(params) {
  const code = params.get('code');
  const returnedState = params.get('state');
  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);

  // Single-use in every sense: clear them before doing anything that can fail, so
  // a retry always starts a clean flow rather than reusing spent values.
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  cleanOAuthParamsFromUrl();

  if (!expectedState || !verifier || returnedState !== expectedState) {
    // Either a forged callback, or a genuine one that landed in a tab which never
    // started the flow (e.g. the link was reopened). Both are unusable.
    console.warn('[auth] state/verifier mismatch — discarding callback');
    setSync('', 'Not signed in');
    showSignInButton();
    toast('Sign-in could not be verified — please try again', true);
    return;
  }

  let resp, data;
  try {
    resp = await fetch(AUTH_WORKER_URL + '/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, code_verifier: verifier, redirect_uri: OAUTH_REDIRECT_URI })
    });
    data = await resp.json().catch(function () { return {}; });
  } catch (e) {
    console.error('[auth] /auth/exchange network failure', e);
    setSync('error', 'Sign-in failed');
    showSignInButton();
    toast('Could not reach the sign-in service', true);
    return;
  }

  if (!resp.ok) {
    console.warn('[auth] /auth/exchange failed status=' + resp.status + ' body=' + JSON.stringify(data));
    if (resp.status === 403) {
      // The Worker's allowlist rejected this account. It already revoked the
      // credentials, so there is nothing to clean up locally.
      await denyAccess(data.email || '(unauthorized account)');
      return;
    }
    setSync('error', 'Sign-in failed');
    showSignInButton();
    toast('Sign-in failed: ' + (data.error || resp.status), true);
    return;
  }

  console.log('[auth] session established for ' + (data.email || '(unknown)') +
    ', valid ' + Math.round((data.session_ttl || 0) / 3600) + 'h');
  setSessionId(data.sid);
  adoptToken(data.access_token, data.expires_in);
}

// ===== STEP 3: the silent path — every load, every hourly expiry =====
function silentRefresh() {
  // Locked-out user — never re-mint. Must be first.
  if (authDenied) { console.log('[auth] silentRefresh skipped — access denied'); return; }

  const sid = getSessionId();
  if (!sid) {
    if (!hasLiveToken()) { setSync('', 'Not signed in'); showSignInButton(); }
    return;
  }

  // Attempting the round-trip with no network just burns a retry slot and logs a
  // scary error. Wait it out; the 'online' listener fires the moment we're back.
  if (isOffline()) {
    console.log('[auth] silentRefresh skipped — browser offline, waiting for reconnect');
    setSync('', hasLiveToken() ? 'Offline — will reconnect' : 'Offline — cached data');
    scheduleAuthRetry('offline');
    return;
  }

  console.log('[auth] silentRefresh: exchanging session id for access token');
  fetch(AUTH_WORKER_URL + '/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid: sid })
  }).then(async function (resp) {
    const data = await resp.json().catch(function () { return {}; });

    // 401 is the one and only genuine logout: the Worker is telling us this
    // session no longer exists (24h expiry, revoked access, or Google killed the
    // refresh token). Anything else is treated as transient and retried.
    if (resp.status === 401) {
      console.log('[auth] session expired — re-authentication required');
      clearSessionId();
      accessToken = null;
      tokenExpiry = 0;
      if (tokenRefreshTimer) { clearTimeout(tokenRefreshTimer); tokenRefreshTimer = null; }
      setSync('', 'Session expired — sign in');
      showSignInButton();
      return;
    }

    if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));

    adoptToken(data.access_token, data.expires_in);
  }).catch(function (e) {
    console.warn('[auth] silentRefresh failed: ' + e.message);
    // Not a sign-out. Report honestly and keep trying — the token we already hold
    // (if any) stays valid and the app keeps working against it.
    if (hasLiveToken()) setSync('connected', 'Connected');
    else if (isOffline()) setSync('', 'Offline — cached data');
    else setSync('', 'Reconnecting…');
    scheduleAuthRetry('token refresh failed (' + e.message + ')');
  });
}

// Everything that happens once a fresh access token is in hand, from either the
// exchange or a refresh. Single place so both paths can't drift apart.
function adoptToken(token, expiresInSec) {
  if (!token) { scheduleAuthRetry('worker returned no access token'); return; }
  accessToken = token;
  const ttl = expiresInSec || 3600;
  tokenExpiry = Date.now() + ttl * 1000;
  authRetryIndex = 0;  // healthy again — next failure starts the backoff from scratch
  console.log('[auth] access token adopted, expires in ' + ttl + 's');

  hideSignInButton();
  setSync('connected', 'Connected');

  // Schedule the next refresh well before expiry, leaving room for the backoff
  // retries to run inside the lead window if the first attempt fails.
  if (tokenRefreshTimer) clearTimeout(tokenRefreshTimer);
  tokenRefreshTimer = setTimeout(silentRefresh, Math.max(60000, ttl * 1000 - TOKEN_REFRESH_LEAD_MS));

  // SECURITY: fetchUserEmail returns false for unauthorized users (and handles
  // denial internally — revokes the session, shows the access-denied screen). We
  // must only call pullAll if it returns true, otherwise we'd leak data.
  fetchUserEmail().then(function (allowed) {
    if (!allowed) return;  // denyAccess() has already shown the block screen
    if (!authBootstrapped) {
      authBootstrapped = true;
      // Land each user on their own view. Deliberately only on the FIRST token of
      // the page load — doing it on every hourly refresh would yank the filter
      // back to "My tasks" underneath someone mid-task.
      if (typeof applyMyTasksDefault === 'function') applyMyTasksDefault();
    }
    pullAll();
  }).catch(function (e) {
    // Should not happen — fetchUserEmail catches its own errors and denies access.
    // But just in case, fail closed.
    console.error('fetchUserEmail unexpectedly threw:', e);
    denyAccess('(verification error)');
  });
}

// ===== KEEPING THE SESSION ALIVE =====
// setTimeout can be throttled when the tab is backgrounded, so the ~50-min refresh
// timer can fire after the token has already expired. Re-check on every
// visibility-restore event and refresh proactively if we're inside the lead window.
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState !== 'visible') return;
  if (authDenied || !getSessionId()) return;
  const remainingMs = tokenExpiry - Date.now();
  if (remainingMs < TOKEN_REFRESH_LEAD_MS) {
    console.log('[auth] visibilitychange: token expiring in ' + Math.round(remainingMs / 1000) + 's, kicking silent refresh');
    silentRefresh();
  }
});

// The backoff timer alone would eventually recover, but waiting up to 5 minutes
// after the wifi is visibly back feels broken. These events make it immediate.
window.addEventListener('online', function () {
  console.log('[auth] browser reports online — attempting recovery');
  if (authDenied) return;
  authRetryIndex = 0;  // connectivity is a fresh start, not a continuation
  if (!getSessionId()) { showSignInButton(); return; }
  if (hasLiveToken()) {
    // Session survived the outage intact. Just resync the data.
    setSync('connected', 'Connected');
    if (typeof pullAll === 'function') pullAll();
  } else {
    if (tokenRefreshTimer) { clearTimeout(tokenRefreshTimer); tokenRefreshTimer = null; }
    silentRefresh();
  }
});

window.addEventListener('offline', function () {
  console.log('[auth] browser reports offline — holding session, pausing sync');
  if (authDenied) return;
  // Explicitly NOT clearing accessToken. The token is still valid; only the network
  // is gone. Cached data stays on screen and writes resume on reconnect.
  setSync('', 'Offline — cached data');
});

// ===== IDENTITY & ACCESS CONTROL =====
// Fetch the signed-in user's email from Google's userinfo endpoint.
// Requires the userinfo.email scope (see SCOPES in config.js).
// SECURITY: If the email is not in USER_EMAILS, this blocks access entirely by
// destroying the session and showing the access-denied screen. The caller must
// check the return value — true = allowed, false = denied (do NOT proceed).
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
    // If the user isn't in USER_EMAILS, deny access. To grant a new user access,
    // add them to USER_EMAILS in config.js (and to ALLOWED_EMAILS on the Worker
    // if you've set that) — no code change needed here.
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

// Deny access for an unauthorized user. Destroys the server-side session (which
// revokes the refresh token at Google), clears local state, and shows the
// access-denied screen.
async function denyAccess(email) {
  const tokenToRevoke = accessToken;
  const sid = getSessionId();
  // Latch the denial BEFORE clearing state. The retry/backoff machinery checks this
  // flag; without it, the reconnect logic would happily mint a fresh token for the
  // user we're locking out.
  authDenied = true;
  accessToken = null;
  tokenExpiry = 0;
  state.currentEmail = '';
  state.currentUser = 'Unknown';
  clearSessionId();
  if (tokenRefreshTimer) { clearTimeout(tokenRefreshTimer); tokenRefreshTimer = null; }

  // Kill the refresh token server-side, then the access token. Best-effort — local
  // state is already cleared and the access-denied screen blocks the UI regardless.
  if (sid) {
    try {
      await fetch(AUTH_WORKER_URL + '/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid: sid })
      });
    } catch (e) { console.warn('Session logout failed (non-fatal):', e); }
  }
  if (tokenToRevoke) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(tokenToRevoke), { method: 'POST' });
    } catch (e) { console.warn('Token revoke failed (non-fatal):', e); }
  }

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

// Explicit sign-out: end the session everywhere, not just in this tab. Without the
// /auth/logout call the refresh token would stay live in KV until its TTL.
async function signOut() {
  const sid = getSessionId();
  clearSessionId();
  accessToken = null;
  tokenExpiry = 0;
  if (tokenRefreshTimer) { clearTimeout(tokenRefreshTimer); tokenRefreshTimer = null; }
  if (sid) {
    try {
      await fetch(AUTH_WORKER_URL + '/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid: sid })
      });
    } catch (e) {}
  }
}

// Called by the "Sign out and try a different account" button on the access-denied
// screen. denyAccess() has already torn down the session; this clears the cached
// data an unauthorized user shouldn't retain and returns to a clean sign-in.
async function accessDeniedReload() {
  await signOut();
  try { localStorage.removeItem('maple_cache'); } catch (e) {}
  location.reload();
}

function setSync(s, text) {
  const el = document.getElementById('syncStatus');
  el.className = 'sync-status ' + s;
  document.getElementById('syncText').textContent = text;
}
