/* config.js — Hardcoded configuration */
const APP_CONFIG = {
  clientId: '43641250256-l4ti5l2lfvadbsmju4juh0fln91aib09.apps.googleusercontent.com',
  sheetId: '1sCWFN8QYJkB8VNd1WcdKZ5vRyps5qn3iI4AYZ-GfnA0',
  calendarId: 'primary'
};
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email';
const SHEET_TABS = { companies: 'Companies', visits: 'Visits', tasks: 'Tasks', deleted: 'Deleted', visitprep: 'VisitPrep', documents: 'Documents', dailylog: 'DailyLog' };
// Tasks sheet now includes review fields (columns N, O, P). Existing tasks with empty values = "no review".
const TASK_COLS = ['id','name','status','priority','date','duration','assignee','category','companyId','notes','links','createdAt','updatedAt','reviewer','reviewStatus','reviewHistory'];
// Deleted sheet mirrors Tasks + archive fields + same review fields so archived tasks keep their review history
const DELETED_COLS = ['id','name','status','priority','date','duration','assignee','category','companyId','notes','links','createdAt','updatedAt','reviewer','reviewStatus','reviewHistory','archivedAt','archiveReason'];
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
const MAPLE_ROOT_FOLDER_ID = '13fDkDLwTuHLtFS7TcpVATuWDQxmlDbmM';

// User identity — maps OAuth email to role name. Used across the app for review workflow.
// Any email not in this map is treated as "Unknown" and gets read-only access to reviews.
const USER_EMAILS = {
  'prrithive@gmail.com': 'Prrithive',
  'sridharanbalaiyan@gmail.com': 'Sridharan'
};
