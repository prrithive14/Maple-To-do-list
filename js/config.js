/* config.js — Hardcoded configuration */
const APP_CONFIG = {
  clientId: '43641250256-l4ti5l2lfvadbsmju4juh0fln91aib09.apps.googleusercontent.com',
  sheetId: '1sCWFN8QYJkB8VNd1WcdKZ5vRyps5qn3iI4AYZ-GfnA0',
  calendarId: 'primary'
};
// `openid` is required, not cosmetic: without it Google's token endpoint returns no
// id_token, and the Worker reads the signed-in email from that id_token to enforce
// its allowlist at session-creation time.
const SCOPES = 'openid https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email';
const SHEET_TABS = { companies: 'Companies', visits: 'Visits', tasks: 'Tasks', deleted: 'Deleted', visitprep: 'VisitPrep', documents: 'Documents', dailylog: 'DailyLog' };
// Tasks sheet now includes review fields (columns N, O, P) + taskType (column Q).
// taskType is APPENDED last so existing column positions never shift. Existing tasks
// with empty values = "no review"; empty taskType is normalised to 'daily' on read.
// completedAt is APPENDED after taskType for the same reason — never shift existing columns.
// It records when a task actually entered 'Done', which updatedAt cannot: updatedAt moves on
// every edit, so a completed task that got edited would restart its kanban countdown and
// pop back onto the board. Blank on legacy rows; readers fall back to updatedAt.
const TASK_COLS = ['id','name','status','priority','date','duration','assignee','category','companyId','notes','links','createdAt','updatedAt','reviewer','reviewStatus','reviewHistory','taskType','completedAt'];
// Deleted sheet mirrors Tasks + archive fields + same review fields so archived tasks keep their review history.
// taskType is the LAST column (S) so it survives archive/restore without shifting archivedAt/archiveReason.
const DELETED_COLS = ['id','name','status','priority','date','duration','assignee','category','companyId','notes','links','createdAt','updatedAt','reviewer','reviewStatus','reviewHistory','archivedAt','archiveReason','taskType','completedAt'];
// Task time-horizon split. 'daily' = short-horizon execution work; 'strategic' = longer-horizon planning/research.
const TASK_TYPES = ['daily','strategic'];
const COMPANY_COLS = ['id','name','industry','size','makes','address','contact','phone','email','website','linkedin','status','value','owner','lastInteraction','notes','createdAt','updatedAt'];
const VISIT_COLS = ['id','companyId','date','type','outcome','notes','nextStep','loggedBy','createdAt'];
const VISITPREP_COLS = ['id','companyId','checks','notes','leadRating','visitDate','updatedAt'];
// Documents sheet — Learning tab. Each row is either a file (driveFileId/driveLink populated) OR a URL (url populated). type='file'|'url'.
const DOCUMENT_COLS = ['id','title','type','category','description','url','driveFileId','driveLink','mimeType','uploadedBy','uploadedAt','updatedAt'];
// DailyLog sheet — per-user time blocks (Google-Calendar-style log). createdBy/updatedBy store raw lowercased OAuth email so per-user filtering survives role renames.
// done is "TRUE"/"FALSE" string (sheets returns strings; toggleLogDone normalises).
const DAILYLOG_COLS = ['id','date','startTime','endTime','title','done','comment','createdAt','createdBy','updatedAt','updatedBy'];
// Seed categories shown in the Learning sidebar even when no documents exist yet. Free-text — users can add new ones via the upload modal.
const LEARNING_SEED_CATEGORIES = ['Cold Call', 'Industry', 'Product', 'App Usage'];
// Common categories shown at the top of the task category dropdown for fast picking.
// The category field is still free-text — type anything new and it'll be saved as-is.
// Categories that exist on tasks but aren't in this list (e.g., "PR Application") will
// still appear in the dropdown after the common ones, so existing tasks aren't affected.
const COMMON_TASK_CATEGORIES = ['Admin', 'Personal', 'Sales', 'Learning', 'Marketing', 'Other'];
const CHAT_WORKER_URL = "https://maple-chat.prrithive.workers.dev";

// ===== AUTH =====
// Same Worker as the chat one — sign-in lives under /auth/*. It holds the OAuth
// client secret and the refresh token so the browser never has to; see the header
// comment in worker.js for the trust split.
const AUTH_WORKER_URL = "https://maple-chat.prrithive.workers.dev";
// Where Google sends the user back after consent. This string must appear
// VERBATIM in the OAuth client's "Authorised redirect URIs" list in Google Cloud
// Console — Google compares it byte for byte, so the trailing slash matters.
// Derived from the current page rather than hardcoded so a preview deploy doesn't
// silently send the production URI; `index.html` is stripped so /index.html and /
// both resolve to the one registered value.
const OAUTH_REDIRECT_URI = location.origin + location.pathname.replace(/index\.html$/, '');
const MAPLE_ROOT_FOLDER_ID = '13fDkDLwTuHLtFS7TcpVATuWDQxmlDbmM';

// User identity — maps OAuth email to role name. Used across the app for review workflow.
// Any email not in this map is treated as "Unknown" and gets read-only access to reviews.
const USER_EMAILS = {
  'prrithive@gmail.com': 'Prrithive',
  'sridharanbalaiyan@gmail.com': 'Sridharan',
  'prrithive1@gmail.com': 'Prrithive',
  'satyaveeravenkataramana17@gmail.com': 'Satya',
};

// Restricted roles get a locked-down view: they only ever see their OWN tasks and
// cannot delete companies (they CAN still delete/archive their own tasks). Enforced
// via the isRestrictedUser()/canDeleteCompanies() helpers in state.js, and applied in
// getFilteredTasks (task board + calendar), openCompanyModal/deleteCompany, and the
// chat AI context. To lock down another user, add their role name here.
const RESTRICTED_ROLES = ['Satya'];
