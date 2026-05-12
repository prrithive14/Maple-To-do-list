# Maple MPSS

Google Sheets-backed CRM and task management web app for a family machinery parts sourcing business based in Burlington/Hamilton, Ontario.

**Primary users:** Prrithive (`prrithive@gmail.com`) and Sridharan (`sridharanbalaiyan@gmail.com`). Sujatha occasionally involved.

**This README is the source of truth.** Paste it at the start of new chats so Claude has full context — memory drifts, this file doesn't.

---

## Critical IDs & endpoints

| Thing | Value |
|---|---|
| Live app | https://prrithive14.github.io/Maple-To-do-list/ (custom domain: `crm.maplempss.com`) |
| Repo | github.com/prrithive14/Maple-To-do-list |
| GitHub username | `prrithive14` (not an email) |
| Cloudflare Worker | https://maple-chat.prrithive.workers.dev |
| Google Sheet ID | `1sCWFN8QYJkB8VNd1WcdKZ5vRyps5qn3iI4AYZ-GfnA0` |
| OAuth Client ID | `43641250256-l4ki5l2lfvadbsmju4juh0fln91aib09` |
| Drive root folder ID | `13fDkDLwTuHLtFS7TcpVATuWDQxmlDbmM` |

**Sheet tabs:** `Companies`, `Visits`, `Tasks`, `Deleted`, `VisitPrep`, `Documents`, `DailyLog`

**Worker:** Uses Claude Sonnet via Anthropic API with prompt caching enabled. Two-block system array — main prompt stays cache-friendly, meeting-mode addendum appended only when `mode === "meeting"`.

---

## Architecture / file map

Modular codebase. Each feature isolated in its own file so changes stay surgical.

```
index.html              Single page shell — header, tabs, modals, all views in one DOM
css/styles.css          All styles (light + dark themes, all components)
js/
  config.js             Hardcoded config — IDs, scopes, column schemas, USER_EMAILS map
  state.js              Global state, cache, utilities (esc, formatDate, IDs, identity)
  auth.js               Google OAuth, token mgmt, allowlist enforcement, deny screen
  sheets.js             Sheets API helpers (read, write, append, upsert, delete row, ensure tabs)
  drive.js              Drive folder mgmt, file upload, file list, per-task/company/VP folders
  app.js                Tab switching, refreshAll, populateFilters, theme toggle, keyboard
  tasks.js              Task CRUD, kanban, calendar view, overdue mgmt, review workflow
  companies.js          Company CRUD, list/grid, sort, pagination, cascade delete
  visits.js             Visit CRUD per company
  archive.js            Auto-archive, manual archive, restore, deleted/archive view
  visitprep.js          Visit Prep checklists, priority scoring, search, PDF export
  dashboard.js          Dashboard tab — pipeline, stats, user plate
  chat.js               Chat agent UI, tool execution, meeting mode, batch confirmation
  library.js            Training document Library (Documents sheet, dynamic categories)
  dailyLog.js           Daily Log CRUD, detail modal, quick-add parser (per-user time blocks)
  dailyLogCalendar.js   Day/Week/Month calendar renderer + efficiency badge for Daily Log
worker.js               Cloudflare Worker (deployed separately, calls Anthropic API)
```

---

## Schemas

Column lists must stay in sync between `config.js` and the Sheet headers — order matters.

### Tasks
`id, name, status, priority, date, duration, assignee, category, companyId, notes, links, createdAt, updatedAt, reviewer, reviewStatus, reviewHistory`

- `status`: `Not started` | `In progress` | `Done` | `Blocked`
- `priority`: `Urgent` | `High` | `Medium` | `Low` | (empty)
- `assignee`: `Prrithive` | `Sridharan` | `Both` | (empty)
- `reviewStatus`: `""` | `pending` | `changes_requested` | `approved`

### Companies
`id, name, industry, size, makes, address, contact, phone, email, website, linkedin, status, value, owner, lastInteraction, notes, createdAt, updatedAt`

- `status`: `Prospect` | `Visited` | `Quoted` | `Won` | `Lost`

### Visits
`id, companyId, date, type, outcome, notes, nextStep, loggedBy, createdAt`

### Deleted (mirrors Tasks + archive fields)
`id, name, status, priority, date, duration, assignee, category, companyId, notes, links, createdAt, updatedAt, reviewer, reviewStatus, reviewHistory, archivedAt, archiveReason`

- `archiveReason`: `completed` (auto, 2-day rule) | `manual` | `deleted`

### DailyLog
`id, date, startTime, endTime, title, done, comment, createdAt, createdBy, updatedAt, updatedBy`

- `date`: `YYYY-MM-DD`
- `startTime`/`endTime`: `HH:mm` (24h); `endTime` must be after `startTime`
- `done`: stored as `"TRUE"` | `"FALSE"` (sheets returns strings; `logDoneBool` normalises)
- `createdBy`/`updatedBy`: **lowercased raw OAuth email** (not role name) — used to scope every view to the signed-in user. Daily Log is personal; nobody sees anyone else's entries.

### VisitPrep
`id, companyId, checks, notes, leadRating, visitDate, updatedAt`

---

## Current state (shipped)

Everything in this list is live in production.

### Tasks
- Kanban + calendar views with drag-to-reschedule
- **Default landing view:** Personal scope + "My tasks" filter (= signed-in user OR `Both` OR unassigned)
- Assignee filter: ⭐ My tasks | All assignees | Prrithive | Sridharan | Both | Unassigned
- Scope toggle: 👤 Personal | 🏢 Company (no "All" option)
- **Priority-colored left border on cards:** Urgent=red, High=orange, Medium=yellow, Low=grey
- Per-task Drive folder named by `taskId` (stable across renames)
- File whitelists on `update_task` field changes via chat tool
- Keyboard shortcut `N` opens new task modal

### Companies
- Sort dropdown (priority/tasks/visit/alpha, default priority)
- 15-per-page pagination, search
- Active tasks filter, "Next Visit" column (Pipeline hidden from list, kept in schema/modal/dashboard)
- Cascade delete: archives tasks, hard-deletes visits + visit prep
- Per-company Drive folder for file uploads

### Review workflow (Tasks only)
- Fields: `reviewer`, `reviewStatus`, `reviewHistory`
- Functions in `tasks.js`: `doRequestReview`, `doApprove`, `doRequestChanges`, `doReRequest`, `doCancel`, `doReopen`
- Rules: only the reviewer can act; only the assignee can re-request; no self-review; approve does NOT auto-complete
- Blue dot on Tasks tab when there's a pending review for the current user
- Filter dropdown: awaiting_me / awaiting_other / changes_requested / approved / no_review

### Visit Prep
- Priority scoring (visit date dominates, lead rating ±50 tiebreaker)
- Reason labels, 15-per-page pagination, `/` shortcut focuses search (searches notes too)
- Per-company 3-part checklist: Research, Preparation, Debrief
- Per-item notes + file uploads (Drive: `Visit Prep/<companyName>/<itemName>/`)
- Visit date with countdown, lead rating, PDF export

### Archive
- **Auto-archive Done tasks after 2 days** (was 7 — changed to keep kanban clean)
- Manual archive (single task)
- Restore from archive (Restore button → returns task to active, status flips Done→Not started)
- Cascade-deleted company tasks land here too

### Library
- Training document storage (Version B: dynamic categories)
- `Documents` sheet tab + Drive folder at `Library/<category>/`
- Two-pane UI: seeded category sidebar + card grid
- Upload modal with drag-and-drop, edit, delete
- Categories: free-text with datalist autocomplete, seeded via `LIBRARY_SEED_CATEGORIES` in `config.js`
- Known v1 limitation: renaming category in metadata does NOT physically move the file in Drive

### Daily Log
- Google-Calendar-style time grid (6am → midnight) with Week (default) / Day / Month toggles
- Each block: title, start/end time, done checkbox in top-right, click body to open detail modal (edit/delete)
- Quick-add bar parses `"Gym 6-8pm"`, `"Call Dad 14:30-15:00"`, `"Lunch 12-1pm"`, `"Read 9am-10:30am"`; unparseable input opens the modal pre-filled
- Click an empty slot in the column → modal pre-filled with that date & 15-min-snapped start
- Efficiency badge at the top of the view: `"X/Y ticked · Z%"`, scoped to the currently visible range
- Done entries render dimmed + strikethrough; overlapping blocks split side-by-side
- **Per-user filter:** every view filters on `createdBy === lowercased OAuth email`; chat tool `query_log` does the same. No UI toggle — always personal.

### Chat agent
- 19 tools (15 core + 3 Learning + 4 Daily Log): add/update/delete task and company, bulk ops, query, briefing, stats, log visit, bulk import, request_review, respond_to_review, learning CRUD, daily-log CRUD
- **Meeting mode:** pasted notes parsed into proposed task batch; user reviews/edits before tasks are created
- Two-block system array keeps main prompt cache-friendly
- Client defers all `add_task` tool calls in meeting mode
- `update_task`/`update_company`/`update_log_entry` have field whitelists
- Daily-Log tools (`add_log_entry`, `tick_log_entry`, `update_log_entry`, `query_log`) ignore any `createdBy` in the tool args and always use the signed-in user's email server-side. `tick_log_entry`/`update_log_entry` reject IDs owned by another user.
- `get_stats` uses midnight-today as cutoff
- Cascade delete for companies works in both UI and chat tool

### Auth & token refresh
- **Strict silent refresh on every load.** `auth.js#silentRefresh` calls `tokenClient.requestAccessToken({ prompt: 'none' })`. If the user's Google session is active and consent was previously granted, a new token is issued with zero UI. If not, GIS reports `immediate_failed` and the Sign in button is revealed.
- **Sign in button hidden by default.** Shown only after a confirmed silent-refresh failure or a 5-second fallback timer (covers a stalled GIS load). No more flash-of-sign-in-button on every page load.
- **Refresh ahead of expiry.** On every successful token, a `setTimeout` fires ~5 minutes before expiry (`expires_in − 5min`, min 60s) to silent-refresh.
- **Visibility-restore guard.** `setTimeout` is throttled in backgrounded tabs, so the timer alone can miss the refresh window. A `visibilitychange` listener checks the token expiry whenever the tab becomes visible and triggers a silent refresh if we're inside the 5-minute lead window.
- **Nothing is persisted.** `accessToken` and `tokenExpiry` live in module memory only — never `localStorage`, never `sessionStorage`. A page close = no token on disk. Re-acquisition on next load comes from Google's own session cookies.

### Identity & security
- `USER_EMAILS` map in `config.js` is the single allowlist. Add a row → user has access. Remove a row → access revoked on next sign-in.
- `fetchUserEmail()` in `auth.js` calls Google's userinfo endpoint with `userinfo.email` scope
- **Allowlist enforcement (shipped):** unrecognized email → token revoked at Google's end → "Access denied" screen shown → app data never loaded
- **Settings button hidden by default** — only revealed for authorized users. Strangers never see Client ID, Sheet ID, or Reset button.
- `state.currentUser` = role name (`Prrithive`/`Sridharan`/`Unknown`); `state.currentEmail` = raw email (lowercased)
- Anyone unrecognized falls into `Unknown` and is blocked entirely

### Theme
- Dark mode (default) + light mode
- GitHub-style soft charcoal: `--bg #0d1117`, `--bg-card #161b22`, `--bg-sunken #1c2129`, `--ink #e6edf3`, `--line #30363d`
- Maple orange accent stays in both themes
- Toggle in header (🌙/☀️)
- Persists per-device via `localStorage['maple_theme']` — purely local, not synced across users

### Drive integration
- Single shared root folder (`MAPLE_ROOT_FOLDER_ID`) with `drive` scope (upgraded from `drive.file`)
- Subfolders: `<CompanyName>/`, `Task Files/<taskId>/`, `Visit Prep/<companyName>/<itemName>/`, `Library/<category>/`
- Old folders named by taskName remain as-is (not surfaced by UI but safe to leave)

### Calendar
- Drag-and-drop reschedule on both kanban + calendar cards (`dragend` handlers in both)
- One-way sync to Google Calendar on task save (two-way is backlog)

---

## Security model

The app is publicly reachable, but data is not. Three layers of defense:

1. **Sheet/Drive sharing (Google's enforcement)** — your Sheet and Drive folder must be shared *only* with `prrithive@gmail.com` and `sridharanbalaiyan@gmail.com`. Anyone else who signs in gets `403 Forbidden` from the Sheets/Drive APIs regardless of what the app does. **Verify periodically** that neither resource is set to "Anyone with the link".

2. **App-level allowlist (`USER_EMAILS` in `config.js`)** — even if Sheet sharing accidentally widens, the app refuses to load data for users not in `USER_EMAILS` and revokes their OAuth token at Google's end so it can't be replayed.

3. **OAuth Consent Screen (Google Cloud Console)** — if set to `Testing` mode, only listed test users can complete OAuth at all. If `Published`, anyone can sign in (but layers 1 and 2 still block them). Check publishing status periodically.

The OAuth Client ID is **safe to be public** — it's bound to authorized JavaScript origins. Someone copying it onto another domain gets rejected by Google.

### Manual checks (do quarterly)
- Sheet → Share → confirm only the two emails listed (no "Anyone with link")
- Drive folder → Share → same check (Editor access for Sridharan to enable uploads)
- Google Cloud Console → OAuth consent screen → confirm publishing status & test users

### To grant a new user access
1. Add their email to `USER_EMAILS` in `config.js`:
   ```js
   const USER_EMAILS = {
     'prrithive@gmail.com': 'Prrithive',
     'sridharanbalaiyan@gmail.com': 'Sridharan',
     'newperson@gmail.com': 'NewPerson'   // ← add line
   };
   ```
2. Share the Google Sheet with that email
3. Share the Drive folder with that email
4. (If OAuth consent screen is in Testing mode) add as a test user in Google Cloud Console

No code changes anywhere else needed.

---

## Production / test environment split

**Status:** planned, not yet implemented.

Pattern A — two separate GitHub repos with separate `config.js`, separate test Sheet, Drive folder, and Cloudflare Worker (`maple-chat-test`). Visual distinction via diagonal-striped orange banner + `TEST` badge in header (CSS already in `styles.css`, gated by `IS_TEST_ENV` flag in `config.js`).

---

## Backlog / on the horizon

- Two-way Google Calendar sync (currently one-way)
- PWA support
- Custom domain (basic done — `crm.maplempss.com` — could expand)
- Production / test environment split (planned, see above)
- Review workflow extended beyond Tasks (deferred — Tasks-only first)
- Per-category dashboard breakdown
- `parseCSV` robustness improvements
- `refreshAll()` performance at scale
- Mask OAuth Client ID / Sheet ID in Settings dialog (Risk 3 follow-up — currently Settings is hidden but contents are visible to authorized users)

**Daily Log v1 — deferred to backlog:**
- Recurring templates (e.g., "Gym every Mon/Wed/Fri 6-7am")
- Drag-to-resize blocks (currently edit times via modal)
- Two-way calendar sync (Daily Log is local-only; Tasks already has one-way)
- Mobile-specific layout (current responsive rules degrade for narrow screens but aren't tuned for phone use)
- Shared/team view — Daily Log is intentionally per-user

**Explicitly deferred:**
- Zoho Mail integration

---

## Key learnings & principles

### Working rules (hard requirements)
- **Always propose a plan and wait for explicit approval before building.** Building without approval has happened once and was flagged. Never again.
- **Prefer targeted, small fixes over large rewrites.** Read files before editing.
- **Modular architecture.** Each feature in its own file. Future changes stay small and safer.
- **README is the source of truth.** Paste at start of new chats. Update it after major sessions.

### Hard-won technical lessons
- **`encodeURIComponent` was encoding the colon in Sheets range strings** (e.g., `A2:O`). All such calls were removed from `sheets.js`. Don't add them back.
- **Appending CSS carelessly can overwrite the entire file.** Always verify file operation mode (append vs. overwrite) before running.
- **Header ranges in `ensureDeletedSheet`/`ensureVisitPrepSheet`/`ensureDailyLogSheet` must be dynamic** based on `*_COLS.length` — hardcoding column letters caused the April 19 VisitPrep bug. `ensureDailyLogSheet` follows the same pattern.
- **Daily Log entries are per-user.** Every renderer and the `query_log` chat tool filter on `createdBy === state.currentEmail` (lowercased). `tick_log_entry` and `update_log_entry` additionally reject IDs whose `createdBy` doesn't match — defence in depth so a model hallucinating someone else's ID can't mutate it.
- **Deleted sheet auto-create:** ran into a duplicate-sheet bug previously, fully fixed when `id` column was added and ranges made dynamic.
- **Drive scope must be `drive`, not `drive.file`** — the latter only sees app-created files and broke shared folder operations.
- **Identity check uses `userinfo.email` scope.** `USER_EMAILS` keys must be lowercased (the lookup lowercases the OAuth email before matching).

### Design conventions
- Use the actual design tokens: `--accent`, `--bg-card`, `--bg-sunken`, `--line`, `--ink`, `--ink-soft`, `--ink-mute`. Don't hardcode colors except where unavoidable (and even then, override them in dark mode).
- All themes work via CSS variable rebinding — `[data-theme="dark"]` swaps tokens, components don't change.
- Status pills and category pills use translucent tinted backgrounds in dark mode for readability.

### Meeting-mode training (chat agent)
- Use synthetic test cases
- Cancel-before-Create pattern (verify proposal looks right before letting it write to Sheets)
- Separate test sheet for safety
- Corrections log workflow
- Prompt tuning patterns documented in a separate Word doc

---

## Approach when working with Claude

- Paste this README at the start of new chats
- State the goal, let Claude propose a plan, approve before building
- For UI work: paste the current `styles.css` and `index.html` so edits are surgical
- For logic work: paste the relevant JS file(s) — file map above tells you which
- Confirm tests are valid (esp. for review workflow, archive, allowlist) before deploying
- After significant sessions: update this README

---

*Last updated: April 26, 2026 — added: dark mode, allowlist enforcement, Settings hiding, "My tasks" default, priority borders, 2-day archive cutoff, security model section.*

*May 11, 2026 — added Daily Log: per-user calendar-style time-block tracker with Day/Week/Month views, quick-add parser, efficiency badge, and 4 chat-agent tools. New `DailyLog` sheet tab. Worker schemas for the 4 new tools must be deployed to `worker.js` separately — see session notes.*
