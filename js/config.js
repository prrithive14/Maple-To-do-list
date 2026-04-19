/* config.js — Hardcoded configuration */
const APP_CONFIG = {
  clientId: '43641250256-l4ti5l2lfvadbsmju4juh0fln91aib09.apps.googleusercontent.com',
  sheetId: '1sCWFN8QYJkB8VNd1WcdKZ5vRyps5qn3iI4AYZ-GfnA0',
  calendarId: 'primary'
};

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.file';

const SHEET_TABS = { companies: 'Companies', visits: 'Visits', tasks: 'Tasks', archive: 'Archive' };

const TASK_COLS = ['id','name','status','priority','date','duration','assignee','category','companyId','notes','links','createdAt','updatedAt'];
const ARCHIVE_COLS = ['id','name','status','priority','date','duration','assignee','category','companyId','notes','links','createdAt','updatedAt','archivedAt','archiveReason'];
const COMPANY_COLS = ['id','name','industry','size','makes','address','contact','phone','email','website','linkedin','status','value','owner','lastInteraction','notes','createdAt','updatedAt'];
const VISIT_COLS = ['id','companyId','date','type','outcome','notes','nextStep','loggedBy','createdAt'];

const CHAT_WORKER_URL = "https://maple-chat.prrithive.workers.dev";
const MAPLE_ROOT_FOLDER_ID = '13fDkDLwTuHLtFS7TcpVATuWDQxmlDbmM';
