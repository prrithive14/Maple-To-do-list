/* config.js — Hardcoded configuration */
const APP_CONFIG = {
  clientId: '43641250256-l4ti5l2lfvadbsmju4juh0fln91aib09.apps.googleusercontent.com',
  sheetId: '1sCWFN8QYJkB8VNd1WcdKZ5vRyps5qn3iI4AYZ-GfnA0',
  calendarId: 'primary'
};
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email';
const SHEET_TABS = { companies: 'Companies', visits: 'Visits', tasks: 'Tasks', deleted: 'Deleted', visitprep: 'VisitPrep' };
// Tasks sheet now includes review fields (columns N, O, P). Existing tasks with empty values = "no review".
const TASK_COLS = ['id','name','status','priority','date','duration','assignee','category','companyId','notes','links','createdAt','updatedAt','reviewer','reviewStatus','reviewHistory'];
// Deleted sheet mirrors Tasks + archive fields + same review fields so archived tasks keep their review history
const DELETED_COLS = ['id','name','status','priority','date','duration','assignee','category','companyId','notes','links','createdAt','updatedAt','reviewer','reviewStatus','reviewHistory','archivedAt','archiveReason'];
const COMPANY_COLS = ['id','name','industry','size','makes','address','contact','phone','email','website','linkedin','status','value','owner','lastInteraction','notes','createdAt','updatedAt'];
const VISIT_COLS = ['id','companyId','date','type','outcome','notes','nextStep','loggedBy','createdAt'];
const VISITPREP_COLS = ['id','companyId','checks','notes','leadRating','visitDate','updatedAt'];
const CHAT_WORKER_URL = "https://maple-chat.prrithive.workers.dev";
const MAPLE_ROOT_FOLDER_ID = '13fDkDLwTuHLtFS7TcpVATuWDQxmlDbmM';

// User identity — maps OAuth email to role name. Used across the app for review workflow.
// Any email not in this map is treated as "Unknown" and gets read-only access to reviews.
const USER_EMAILS = {
  'prrithive@gmail.com': 'Prrithive',
  'sridharanbalaiyan@gmail.com': 'Sridharan'
};
