# Maple MPSS

Google Sheets-backed CRM and task management web app for a family machinery parts sourcing business based in Burlington/Hamilton, Ontario.

**Primary users:** Prrithive (`prrithive@gmail.com`) and Sridharan (`sridharanbalaiyan@gmail.com`). Sujatha occasionally involved.

**This README is the source of truth.** Paste it at the start of new chats so Claude has full context — memory drifts, this file doesn't.

---

## ⚠️ DEPLOY — Once-a-day sign-in (built Aug 12, 2026)

Sign-in moved from Google's **implicit token flow** to the **authorization-code flow with a refresh token**, brokered by the Cloudflare Worker. This is why: the implicit flow issues no refresh token, its access tokens die after an hour, and the only way to recover a session after a page refresh was a silent re-auth through a hidden Google iframe — which Chrome and Safari break by blocking third-party cookies. That's what produced the "Sign in with Google" button several times a day. Retry logic could never fix it; nothing was allowed to outlive the page.

Now: the browser stores only a random **session id**; the Worker holds the client secret and the refresh token in KV. Page loads trade the session id for a fresh access token with no Google UI at all. A real sign-in happens **at most once per 24 hours per device**.

**Deploy in this order — steps 1 and 2 must land BEFORE step 3, or sign-in breaks for everyone.**

### 1. Google Cloud Console — add the redirect URI
APIs & Services → Credentials → the OAuth 2.0 Client ID → **Authorised redirect URIs** → Add:

```
https://crm.maplempss.com/
https://prrithive14.github.io/Maple-To-do-list/
```

Google matches these **byte for byte** — the trailing slash is significant. The front-end sends `location.origin + location.pathname` (with `index.html` stripped), so whichever domain you actually open must be in this list. Save; changes can take a few minutes to propagate.

While you're here, copy the **Client secret** from the same client — step 2 needs it.

### 2. Cloudflare Worker — KV namespace + secrets
In the `maple-chat` Worker's **Settings → Variables and Secrets**:

| Name | Kind | Value |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Variable | the full client id (same one in `js/config.js`) |
| `GOOGLE_CLIENT_SECRET` | **Secret** | the client secret from step 1 |
| `ALLOWED_EMAILS` | Variable | `prrithive@gmail.com,sridharanbalaiyan@gmail.com,prrithive1@gmail.com,satyaveeravenkataramana17@gmail.com` |
| `ALLOWED_ORIGIN` | Variable | `https://crm.maplempss.com,https://prrithive14.github.io` — comma-separated; **include every domain you open the app from** or CORS blocks sign-in there |
| `SESSION_TTL_SECONDS` | Variable | *optional* — omit for the 24h default |

Then **Storage & Databases → KV → Create namespace** named `maple-auth-sessions`, and bind it to the Worker under **Settings → Bindings** with the variable name **`AUTH_SESSIONS`** (that exact name — the code looks it up by it).

### 3. Redeploy the worker, then push the frontend
Paste `worker.js` into the Cloudflare editor and **Deploy** — it now routes `/auth/*` to the new broker and leaves the chat endpoint untouched. Then commit and push the frontend. Cache-busting is already bumped to `?v=20260812a`.

### 4. Sanity check
Open the app, sign in (you'll get the Google consent screen once), then **hard-refresh several times**. Expect no sign-in button at all, and this in the console:

```
[auth] existing session found, restoring silently
[auth] access token adopted, expires in 3599s
```

`localStorage['maple_sid']` should hold an opaque random string — and nothing that looks like a Google token. Close the laptop overnight, reopen: one sign-in, then silent again.

### Known caveat — the 7-day refresh token expiry
**If the OAuth consent screen is still in "Testing" publishing status, Google force-expires refresh tokens after 7 days**, regardless of the 24h session TTL. The app handles it correctly (the Worker sees `invalid_grant`, drops the session, and the user signs in again), but to get the full behaviour move the consent screen to **Production** under APIs & Services → OAuth consent screen. Unverified + Production means an "Google hasn't verified this app" interstitial on the once-a-day consent, and a 100-user cap — both fine here.

---

## ⚠️ DEPLOY — Daily/Strategic + Excel export (built May 19, 2026)

The Daily vs Strategic `taskType` split and the Excel export are **code-complete**. The Sheet schema migration is **automatic** — no manual Sheet editing. **Deploy in this order:**

### 1. Schema migration — automatic, nothing to do
`ensureTaskTypeColumn()` in `sheets.js` runs once per session on the first sync after sign-in (= app boot), for both the Tasks and Deleted tabs:
- If the `taskType` header is missing, it appends it as the last column and backfills every existing data row with `daily` (one batched write — never per-row).
- If the header already exists, it fills only any stray blank cells with `daily`.
- It's idempotent and wrapped in try/catch — a migration failure logs to the console and never blocks the app (the `rowToObj` blank→`daily` normaliser is the safety net).

After deploying, open the browser console on first load. Expect, once each:
- `Schema check: Tasks taskType column added` *(first run)* — then `... column OK` on later boots.
- `Schema check: Deleted taskType column added` *(first run)* — then `... column OK` on later boots.

A run that finds stray blanks instead logs `... already present, N blanks filled`.

### 2. Push the frontend to GitHub Pages
Commit and push all changed files. The `<script>`/`<link>` tags in `index.html` carry `?v=20260519` cache-busting — **bump that string** on any future frontend change so browsers don't serve stale JS/CSS.

### 3. Redeploy the worker
Paste `worker.js` into the Cloudflare Worker editor for `maple-chat` and click **Deploy**. No env-var or binding changes needed.

### 4. Sanity check
In the chat agent: "add a task to think about Q4 strategy" → should classify **strategic**; "call Edson tomorrow" → should classify **daily**. Confirm the Daily/Strategic/All tabs filter both the kanban and calendar, and that 📤 Export produces a two-sheet `.xlsx`.

---

## Critical IDs & endpoints

| Thing | Value |
|---|---|
| Live app | https://prrithive14.github.io/Maple-To-do-list/ (custom domain: `crm.maplempss.com`) |
| Repo | github.com/prrithive14/Maple-To-do-list |
| GitHub username | `prrithive14` (not an email) |
| Cloudflare Worker | https://maple-chat.prrithive.workers.dev |
| Google Sheet ID | `1sCWFN8QYJkB8VNd1WcdKZ5vRyps5qn3iI4AYZ-GfnA0` |
| OAuth Client ID | `43641250256-l4ti5l2lfvadbsmju4juh0fln91aib09` (full value in `js/config.js` — authoritative) |
| Drive root folder ID | `13fDkDLwTuHLtFS7TcpVATuWDQxmlDbmM` |

**Sheet tabs:** `Companies`, `Visits`, `Tasks`, `Deleted`, `VisitPrep`, `Documents`, `DailyLog`

**Worker:** Uses Claude Sonnet via Anthropic API with prompt caching enabled. Two-block system array — main prompt stays cache-friendly, meeting-mode addendum appended only when `mode === "meeting"`. `worker.js` is committed to the repo as a reference copy but is **not** auto-deployed — paste it into the Cloudflare dashboard to ship changes.

**Hosting:** Static site on GitHub Pages. No build step — edit files, commit, push. Frontend cache-busting (if needed) is done by bumping `?v=` query strings on `<script>`/`<link>` tags in `index.html`.

---

## Architecture / file map

Modular codebase. Each feature isolated in its own file so changes stay surgical. (Actual files present in `js/` are listed below — note `auth.js`/`sheets.js` exist even though some are not separately called out.)

```
index.html              Single page shell — header, tabs, modals, all views in one DOM
css/styles.css          All styles (light + dark themes, all components)
CNAME                   Custom domain mapping for GitHub Pages
js/
  config.js             Hardcoded config — IDs, scopes, column schemas, USER_EMAILS map
  state.js              Global state, cache, utilities (esc, formatDate, IDs, identity helpers)
  auth.js               Google OAuth, token mgmt, silent refresh, allowlist enforcement, deny screen
  sheets.js             Sheets API helpers (read, write, append, upsert, delete row, ensure tabs, taskType migration)
  drive.js              Drive folder mgmt, file upload, file list, per-task/company/VP folders
  app.js                Tab switching, refreshAll, populateFilters, theme toggle, keyboard
  tasks.js              Task CRUD, kanban, calendar view, overdue mgmt, review workflow
  companies.js          Company CRUD, list/grid, sort, pagination, cascade delete
  visits.js             Visit CRUD per company
  archive.js            Manual archive, restore, deleted/archive view
  visitprep.js          Visit Prep checklists, priority scoring, search, PDF export
  dashboard.js          Dashboard tab — pipeline, stats, "Your plate" panel
  chat.js               Chat agent UI, tool execution, meeting mode, batch confirmation
  learning.js           Training document Library (Documents sheet, dynamic categories)
  dailyLog.js           Daily Log CRUD, detail modal, quick-add parser (per-user time blocks)
  dailyLogCalendar.js   Day/Week/Month calendar renderer + efficiency badge for Daily Log
  export.js             Excel (.xlsx) export of the task list via SheetJS — two-sheet workbook
worker.js               Cloudflare Worker — committed here as a reference copy; deployed separately (paste into Cloudflare)
```

---

## Schemas

Column lists must stay in sync between `js/config.js` and the Sheet header rows — **order matters**. The constant names below are the exact identifiers in `config.js`.

### Tasks — `TASK_COLS`
`id, name, status, priority, date, duration, assignee, category, companyId, notes, links, createdAt, updatedAt, reviewer, reviewStatus, reviewHistory, taskType`

- `status`: `Not started` | `In progress` | `Done` | `Blocked`
- `priority`: `Urgent` | `High` | `Medium` | `Low` | (empty)
- `assignee`: `Prrithive` | `Sridharan` | `Both` | (empty)
- `reviewStatus`: `""` | `pending` | `changes_requested` | `approved`
- `taskType`: `daily` | `strategic` — **never blank**; blank cells are normalised to `daily` on read. Last column (Q).

### Companies — `COMPANY_COLS`
`id, name, industry, size, makes, address, contact, phone, email, website, linkedin, status, value, owner, lastInteraction, notes, createdAt, updatedAt`

- `status`: `Prospect` | `Visited` | `Quoted` | `Won` | `Lost`

### Visits — `VISIT_COLS`
`id, companyId, date, type, outcome, notes, nextStep, loggedBy, createdAt`

### Deleted — `DELETED_COLS` (mirrors Tasks + archive fields)
`id, name, status, priority, date, duration, assignee, category, companyId, notes, links, createdAt, updatedAt, reviewer, reviewStatus, reviewHistory, archivedAt, archiveReason, taskType`

- `archiveReason`: `completed` (auto, 2-day rule) | `manual` | `deleted`
- `taskType`: `daily` | `strategic` — last column (S), so it survives archive/restore.

### Documents — `DOCUMENT_COLS` (Learning/Library tab)
`id, title, type, category, description, url, driveFileId, driveLink, mimeType, uploadedBy, uploadedAt, updatedAt`

- `type`: `file` (driveFileId/driveLink populated) | `url` (url populated)

### DailyLog — `DAILYLOG_COLS`
`id, date, startTime, endTime, title, done, comment, createdAt, createdBy, updatedAt, updatedBy`

- `date`: `YYYY-MM-DD`
- `startTime`/`endTime`: `HH:mm` (24h); `endTime` must be after `startTime`
- `done`: stored as `"TRUE"` | `"FALSE"` string (sheets returns strings)
- `createdBy`/`updatedBy`: **lowercased raw OAuth email** — scopes every view to the signed-in user. Daily Log is personal; nobody sees anyone else's entries.

### VisitPrep — `VISITPREP_COLS`
`id, companyId, checks, notes, leadRating, visitDate, updatedAt`

### Other config constants
- `TASK_TYPES` — `['daily','strategic']`, the allowed `taskType` values.
- `LEARNING_SEED_CATEGORIES` — categories pre-seeded in the Learning sidebar.
- `COMMON_TASK_CATEGORIES` — quick-pick categories at the top of the task category dropdown (field stays free-text).
- `USER_EMAILS` — OAuth-email → role map; the single allowlist (currently `prrithive@gmail.com`, `sridharanbalaiyan@gmail.com`, plus `prrithive1@gmail.com` → Prrithive).

---

## Current state (shipped — all live in production)

### Tasks
- Kanban + calendar views with drag-to-reschedule
- **Daily / Strategic / All tab switcher** — filters both kanban and calendar by `taskType`; default Daily, persisted in `localStorage['maple_taskType']`. One shared switcher in the Tasks toolbar (there is no separate list view)
- **Excel export** — 📤 Export button (top-right of the Tasks toolbar; hidden when there are no tasks) → two-sheet `.xlsx` ("Daily" / "Strategic"), filename `maple-tasks-YYYY-MM-DD.xlsx`, via SheetJS. Exports the full active task list regardless of the selected tab
- Default landing view: Personal scope + "My tasks" filter (signed-in user OR `Both` OR unassigned)
- Assignee filter: ⭐ My tasks | All assignees | Prrithive | Sridharan | Both | Unassigned
- Scope toggle: 👤 Personal | 🏢 Company (no "All" option)
- Priority-colored left border on cards: Urgent=red, High=orange, Medium=yellow, Low=grey
- Per-task Drive folder named by `taskId` (stable across renames)
- Field whitelists on `update_task` chat-tool changes (`taskType` is whitelisted — the agent can move tasks between buckets)
- Keyboard shortcut `N` opens new task modal

### Companies
- Sort dropdown (priority/tasks/visit/alpha, default priority), 15-per-page pagination, search
- Active tasks filter, "Next Visit" column
- Cascade delete: archives tasks, hard-deletes visits + visit prep
- Per-company Drive folder for uploads

### Review workflow (Tasks only)
- Fields: `reviewer`, `reviewStatus`, `reviewHistory`
- Functions in `tasks.js`: `doRequestReview`, `doApprove`, `doRequestChanges`, `doReRequest`, `doCancel`, `doReopen`
- Rules: only the reviewer can act; only the assignee can re-request; no self-review; approve does NOT auto-complete
- Blue dot on Tasks tab when a review is pending for the current user
- Filter: awaiting_me / awaiting_other / changes_requested / approved / no_review

### Visit Prep
- Priority scoring (visit date dominates, lead rating ±50 tiebreaker)
- 15-per-page pagination, `/` focuses search; per-company 3-part checklist (Research / Preparation / Debrief)
- Per-item notes + file uploads (`Visit Prep/<companyName>/<itemName>/`), countdown, lead rating, PDF export

### Archive
- Manual archive only — tasks are never auto-archived. A Done task stays on the kanban
  for one day (`DONE_KANBAN_DAYS` in tasks.js), then drops off the board but stays in the
  Tasks sheet and remains visible in the calendar view (on its date, or in the Unscheduled
  panel if it has none)
- The countdown runs from `completedAt` (stamped by `stampCompletion()` in sheets.js when a
  task enters Done), NOT `updatedAt` — otherwise editing a finished task would restart its
  day and bounce it back onto the board. Blank on pre-migration rows; those fall back to
  `updatedAt`
- Restore from the Archive tab — status is preserved (it used to flip Done→Not started,
  which destroyed the record of completion; Settings → "Fix task statuses" repairs tasks
  affected by the old behaviour)
- "Restore all archived" bulk-restores everything except deliberate deletions
  (`deleted` / `company_deleted`), preserving each task's original status
- Cascade-deleted company tasks land here too

### Library (Learning)
- `Documents` sheet tab + Drive folder at `Library/<category>/`
- Two-pane UI, upload modal with drag-and-drop, free-text categories with datalist autocomplete
- Known v1 limitation: renaming a category in metadata does not physically move the Drive file

### Daily Log
- Google-Calendar-style time grid (6am→midnight), Week (default) / Day / Month toggles
- Quick-add bar parses `"Gym 6-8pm"`, `"Call Dad 14:30-15:00"`, etc.; unparseable input opens the modal pre-filled
- Efficiency badge `"X/Y ticked · Z%"` scoped to visible range
- Per-user: every view + the `query_log` chat tool filter on `createdBy === lowercased OAuth email`

### Chat agent
- 19 tools (15 core + 3 Learning + 4 Daily Log): add/update/delete task & company, bulk ops, query, briefing, stats, log visit, bulk import, request_review, respond_to_review, learning CRUD, daily-log CRUD
- Meeting mode: pasted notes parsed into a proposed task batch; user reviews/edits before creation; client defers all `add_task` calls in this mode
- Two-block system array keeps the main prompt cache-friendly
- `update_task` / `update_company` / `update_log_entry` have field whitelists
- Daily-Log tools ignore any `createdBy` in args and use the signed-in email server-side

### Auth & identity
- **Authorization-code flow with PKCE**, brokered by the Worker. Sign-in is a full-page redirect to Google — no iframe, no popup, so third-party-cookie policy can't break it. Google Identity Services is no longer loaded at all.
- **Session lives 24h per device.** Worker `/auth/exchange` trades the one-time code for an access + refresh token, keeps the refresh token in KV, returns a random session id. `/auth/token` trades that id for a fresh access token on every page load and ~50 min into each hour. `/auth/logout` revokes and deletes.
- **The browser never holds a long-lived credential.** `localStorage['maple_sid']` is an opaque random id, useless without the Worker; `accessToken`/`tokenExpiry` are still memory-only.
- **Only HTTP 401 from the Worker logs a user out.** Every other failure (offline, Google blip, Worker 502) keeps the session and retries on a backoff that always reschedules itself — this is the fix for "a dropped connection bounced me to the login screen".
- `openid` is in `SCOPES` because the Worker reads the email from the returned `id_token` (falls back to the userinfo endpoint if absent).
- Two allowlists, both enforced: `ALLOWED_EMAILS` on the Worker blocks session creation server-side; `USER_EMAILS` in `config.js` blocks the UI. Unrecognized email → session destroyed, refresh token revoked → "Access denied" screen.
- `state.currentUser` = role name; `state.currentEmail` = raw lowercased email

### Theme
- Dark mode (default) + light mode via CSS-variable rebinding (`[data-theme="dark"]`)
- Persists per-device via `localStorage['maple_theme']`
- Design tokens: `--accent`, `--bg-card`, `--bg-sunken`, `--line`, `--ink`, `--ink-soft`, `--ink-mute` — use these, don't hardcode colors

### Drive
- Single shared root folder with `drive` scope (not `drive.file` — the latter only sees app-created files)
- Subfolders: `<CompanyName>/`, `Task Files/<taskId>/`, `Visit Prep/<companyName>/<itemName>/`, `Library/<category>/`

---

## Security model

The app is publicly reachable, but data is not. Three layers:

1. **Sheet/Drive sharing** — shared *only* with the two primary emails. Anyone else gets `403` from the Google APIs. Verify periodically that neither resource is "Anyone with the link".
2. **Worker allowlist** (`ALLOWED_EMAILS`) — an unlisted account never gets a session at all; the Worker revokes its tokens at Google before returning. This runs on the server, so unlike layer 3 it can't be edited away in DevTools.
3. **App-level allowlist** (`USER_EMAILS`) — app refuses to load data for unlisted users and destroys their session.
4. **OAuth consent screen** — Testing mode limits sign-in to listed test users; Published lets anyone sign in (layers 1–3 still block them).

The OAuth Client ID is safe to be public. **The client secret is not** — it lives only as a Cloudflare Worker secret and must never appear in this repo or in `config.js`.

**Tradeoff accepted when persistent sessions shipped:** `localStorage['maple_sid']` is a bearer credential, so an XSS on the app would let an attacker mint access tokens until the session expires (≤24h). It's the reason the refresh token is kept server-side rather than in the browser — the blast radius is one device-day, not permanent Drive/Sheets access. Revoke a single device by deleting its key from the `maple-auth-sessions` KV namespace.

**Quarterly checks:** Sheet share list, Drive folder share list, OAuth consent screen publishing status, stale KV sessions.

**To grant a new user:** add their email to `USER_EMAILS` in `config.js` **and** to `ALLOWED_EMAILS` on the Worker, share the Sheet, share the Drive folder, (if consent screen in Testing mode) add as a test user. No other code changes.

---

## Working rules (hard requirements)

- **Always propose a plan and wait for explicit approval before building.** Building without approval has happened once and was flagged.
- **Prefer targeted, small fixes over large rewrites.** Read files before editing.
- **Deliver complete replacement files**, not diffs — the user applies them by hand.
- **Modular architecture** — keep each feature in its own file.
- **Update this README after major sessions.**

### Hard-won technical lessons
- `encodeURIComponent` was encoding the colon in Sheets range strings (`A2:O`) — all such calls removed from `sheets.js`. Don't add them back.
- Appending CSS carelessly can overwrite the whole file — always confirm append vs. overwrite.
- Header ranges in `ensureDeletedSheet` / `ensureVisitPrepSheet` / `ensureDailyLogSheet` must be **dynamic** from `*_COLS.length` — hardcoded column letters caused the April 19 VisitPrep bug.
- Daily Log entries are per-user — every renderer and `query_log` filter on `createdBy`; `tick_log_entry` / `update_log_entry` reject IDs owned by another user.
- Drive scope must be `drive`, not `drive.file`.
- `USER_EMAILS` keys must be lowercased — the lookup lowercases the OAuth email before matching.
- Every sheet-backed entity needs a stable `id` — never break existing IDs.
- `taskType` is never blank. `config.js` appends it as the **last** column of `TASK_COLS`/`DELETED_COLS` (appending avoids shifting existing column positions). `ensureTaskTypeColumn()` in `sheets.js` migrates the Sheet itself on boot (adds the header, backfills `daily`); `rowToObj` (fresh sheet reads) and `normalizeTaskTypes` (localStorage cache reads) coerce blank → `daily` as a safety net for reads that race the migration. Every task-creation path — modal, chat `add_task`, meeting-mode batch — defaults to `daily`. It's in `chat.js` `TASK_UPDATE_FIELDS` so the agent can reclassify tasks.
- Cache-busting: `index.html` script/link tags use a `?v=YYYYMMDD` query string. Bump it whenever you change a JS or CSS file, or GitHub Pages will serve stale assets.

---

## Known issues (found, deliberately not fixed)

### Settings changes don't survive a reload — `loadConfig()` is dead code
`loadConfig()` (`state.js:128`) reads `localStorage['maple_cfg']` back into `cfg`, but **nothing ever calls it** — `initApp()` doesn't, and neither does anything else. So:

- `saveSettings()` / `saveSetup()` mutate `cfg` in memory and persist to `maple_cfg` via `saveConfig()`, and the UI toasts *"Settings saved — sign in again to apply"* — but on the next reload `cfg` is re-initialised from `{ ...APP_CONFIG }` (`state.js:33`) and the saved value is silently discarded. The Settings modal effectively does nothing across reloads.
- **Do not "fix" this by simply calling `loadConfig()` at boot.** It assigns the parsed object wholesale rather than merging over `APP_CONFIG`, so a stale or partial `maple_cfg` (one saved with a blank field, or from before a key existed) would set `cfg.clientId` to `undefined` — which now hard-fails sign-in at `auth.js:202` with "Client ID not configured". Any real fix has to merge onto `APP_CONFIG` and validate, not replace.

Not currently user-visible, because `APP_CONFIG` in `config.js` is authoritative and correct. Logged Aug 12, 2026 while working on the auth deploy; left alone deliberately to keep that change isolated.

**Also note:** `cfg` is declared exactly once, at `state.js:33`. `config.js` must NOT declare it too — both files load as classic `<script>` tags sharing one global lexical scope, so a second top-level declaration is a `SyntaxError: Identifier 'cfg' has already been declared`, `state.js` never executes, and the whole app white-screens. It must also stay `let`, not `const`: `loadConfig()` and `saveSetup()` both reassign it.

---

## Backlog / on the horizon

- "Your Plate" dashboard panel: deliberately left untouched by the Daily/Strategic work — revisit once the split has been used for a while (may want a daily-vs-strategic breakdown there)
- Two-way Google Calendar sync (currently one-way)
- PWA support
- Production / test environment split (planned — two repos, separate Sheet/Drive/Worker, `IS_TEST_ENV` flag)
- Review workflow beyond Tasks
- Per-category dashboard breakdown; `parseCSV` robustness; `refreshAll()` performance at scale
- "Your plate" dashboard panel: leave as-is until the Daily/Strategic split has been used for a while
- Explicitly deferred: Zoho Mail integration

---

## Approach when working with Claude

- Paste this README at the start of new chats
- State the goal, let Claude propose a plan, approve before building
- For UI work: paste the current `styles.css` / `index.html`; for logic: paste the relevant JS file(s)
- `worker.js` is in the repo, but changes only go live when pasted into the Cloudflare dashboard and deployed
- Confirm tests are valid (review workflow, archive, allowlist) before deploying
- After significant sessions: update this README

---

*Last updated: May 19, 2026 — shipped the Daily/Strategic `taskType` split (tab switcher on kanban + calendar, modal selector, chat-agent support), the two-sheet Excel export (`js/export.js`), and automatic `taskType` schema migration (`ensureTaskTypeColumn()` in `sheets.js`); committed `worker.js` to the repo. See the DEPLOY section at the top. Also created `README.md` as the canonical doc (superseded the stray `README (2).md`).*

*Prior history: Apr 26 2026 — dark mode, allowlist enforcement, Settings hiding, "My tasks" default, priority borders, 2-day archive cutoff, security model. May 11 2026 — Daily Log (per-user calendar-style time-block tracker, quick-add parser, efficiency badge, 4 chat-agent tools, new `DailyLog` sheet tab).*
