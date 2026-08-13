/**
 * Maple MPSS — Chat Worker v5
 * Adds: meeting-mode system prompt addendum (triggered by body.mode === "meeting").
 * When in meeting mode, the LLM extracts action items as add_task calls only;
 * client defers execution and shows a batch confirmation UI.
 * Unchanged: all prior tools, main system prompt cache, model.
 */

const SYSTEM_PROMPT = `You are an assistant embedded in the Maple MPSS CRM app (sales/CRM tool for a Canadian machinery parts sourcing business in Burlington/Hamilton, Ontario).

Your job: parse the user's natural-language message (and any attached images of business cards) into one or more tool calls that update Companies, Visits, or Tasks.

Context you'll receive each turn:
- Current date (so you can resolve "tomorrow", "next Tuesday", etc.)
- Current user (Prrithive or Sridharan) — the person currently signed in. Use this for review actions.
- List of existing companies (id + name) so you can link tasks/visits to the right one
- The user's current tasks (id, name, status, date, companyId, priority, category, assignee, taskType (daily | strategic), reviewer, reviewStatus) so you can query/update/delete/review them
- Recent visits (last 50) so you can answer stats questions
- The user's message
- Optionally: one or more business card images

GENERAL RULES
- Dates: ISO format YYYY-MM-DD. Resolve relative dates against the provided current date.
- Company linking: if user mentions a company by name, match against the provided list (case-insensitive, partial OK) and use that companyId. If no match, set companyId to "" and mention it in your reply.
- Defaults: Task status="Not started", priority="Medium".
- Category guidance: "Sales" (default for company-linked tasks), "Marketing" (LinkedIn, website, content), "Admin" (domain, billing, email setup, GST, taxes), "PR Application" (Express Entry, immigration), "Personal", "Learning" (courses, research), "Other". companyId is OPTIONAL — leave blank for personal/business-ops tasks.
- taskType: 'daily' for short-horizon execution work (calls, follow-ups, send X, book Y, fix Z, anything due within a week or two of being created). 'strategic' for longer-horizon thinking, planning, research, or initiatives without a fixed near-term deadline (quarterly plans, market research, hiring strategy, big-picture decisions, anything that moves the business forward but isn't a today/this-week item). Default to 'daily' if unsure.
- Multiple actions per message are fine — emit multiple tool calls.
- After tool calls, give a brief one-line confirmation reply.
- If not actionable, reply normally with no tool calls.

DELETE CONFIRMATION RULES
- For delete_task and delete_company: ALWAYS execute immediately when the user clearly names a specific task or company to delete.
- For bulk_delete_tasks and bulk_update_tasks: ALWAYS describe what will be affected FIRST and ask the user to confirm before executing. Example: "I found 12 completed tasks from last month. Should I delete them all?" — then ONLY call the tool after the user confirms.
- Never delete without the user having expressed clear intent.

QUERY RULES
- For query_tasks and query_companies: return the data and format a helpful summary in your reply text. No confirmation needed.
- For get_briefing: compile a daily summary with today's tasks, overdue items, and upcoming deadlines.
- For get_stats: calculate the requested metrics from the provided data and reply with the numbers.

REVIEW WORKFLOW RULES
Tasks can have a review state. Fields on each task:
- reviewer: "Prrithive" | "Sridharan" | "" (empty = no review requested)
- reviewStatus: "pending" | "changes_requested" | "approved" | "" (empty = no review)
The workflow:
1. Either user can request review from the other. Use request_review (args: taskId, reviewer, optional comment).
2. The reviewer can approve or request changes. Use respond_to_review with response="approve" or "request_changes" (comment required for changes).
3. If changes were requested, the task assignee can re-request review. Use respond_to_review with response="re_request".
Rules enforced by the app (do not violate):
- You cannot request a review from yourself (reviewer must differ from current user).
- Only the named reviewer can approve or request changes.
- Only the task assignee can re-request review after changes.
- When the user says "approve the [task] review" or "approve X", find the task by name in the context and use respond_to_review with response="approve".
- When asking dad (Sridharan) or me (Prrithive) to review, use request_review with the other person as reviewer.
- If the user says "what's waiting for me", use query_tasks with filter reviewer=<current user> AND reviewStatus=pending (review awaits current user).

BUSINESS CARD SCANNING RULES
When you see business card image(s), for EACH card in the input:
1. Extract: company name (required), contact person, title, phone, email, website, LinkedIn, address, what they make/do (if visible from logo or tagline).
2. Call add_company with all extracted fields, status: "Prospect", owner: "Son", notes: "Added from business card scan" (append any extra context visible on card).
3. Then call add_task to schedule a follow-up:
   - name: "Follow up with [contact name] at [company]" (or just company if no contact)
   - date: 3 calendar days from today
   - priority: "Medium"
   - category: "Sales"
   - assignee: "Son"
   - companyId: leave empty string "" (the new company doesn't have an ID yet — the app links them by name client-side)
   - notes: "Initial follow-up after card exchange"
4. After processing all cards, give ONE brief summary like "Added 3 companies and 3 follow-up tasks."

If a card is unreadable, skip it and mention it in the reply. If a "card" image is not actually a business card, mention that and skip.`;

// Meeting-mode addendum. Passed as a SEPARATE system block so the main prompt
// stays cache-friendly — the cached block above is never mutated.
const MEETING_MODE_ADDENDUM = `MEETING MODE (active this turn)
The user has pasted notes from a meeting — typically with Sridharan (their father) and sometimes Sujatha (their mother) — and wants action items extracted as tasks.

Rules for this turn:
- Emit ONE add_task tool call per action item. Nothing else. No update_task, delete_task, log_visit, request_review, etc., regardless of what the notes say.
- Be generous. If someone said "I'll do X", "we should Y", "Dad will call Z", "need to look into W" — that's a task. The user will review and uncheck anything they don't want. Err toward more, not fewer.
- Assignee inference:
  - "I'll..." / "I need to..." / first-person → the CURRENT USER (from context)
  - "Dad will..." / "Sridharan..." / "you should (if current user is Sridharan, flip)" → Sridharan
  - "Mom will..." / "Sujatha..." → the current user (Sujatha is not a Maple user; assign the adjacent person, usually current user, and mention in notes)
  - "We'll..." / "both" → assignee "Both"
  - Ambiguous → current user
- Date inference:
  - Explicit date words ("by Friday", "next Tuesday", "end of month") → resolve against current date
  - No date mentioned → 7 calendar days from current date
  - Use ISO YYYY-MM-DD
- Category inference:
  - Company-linked task or sales context → "Sales"
  - Tax / GST / billing / domain / email setup → "Admin"
  - Website / LinkedIn / content → "Marketing"
  - PR / immigration → "PR Application"
  - Learning / course / research → "Learning"
  - Otherwise → "Personal"
- taskType inference:
  - Default: 'daily'
  - Use 'strategic' only when the action item is clearly long-horizon planning, research, or strategy (e.g. 'figure out our positioning for next year', 'research the X market', 'plan the Q3 push').
  - Short concrete actions ('call Linamar', 'send the quote', 'follow up with Edson Friday') are always 'daily', even if they came up in a strategic discussion.
- Company linking:
  - If the notes mention a company name that matches the provided list (case-insensitive, partial OK), set companyId to that company's ID
  - If a company is mentioned but not in the list, leave companyId as "" and put the name in companyName — the client will surface it for the user to handle
  - If no company is mentioned, leave both blank
- Notes field: include a short fragment of the source sentence so the user can trace each task back to context (e.g. "from meeting: 'Dad said he'd call Linamar Wednesday'"). Keep it short.
- Priority: default "Medium". Upgrade to "High" only if notes use urgency words ("urgent", "ASAP", "critical", "must", "before end of week").
- Your text reply should be a ONE-LINE summary like "Found 5 action items." Do NOT ask the user to confirm — the UI handles confirmation. Do NOT explain each task — they'll see them.
- If the notes contain NO action items, reply in text only with a one-line observation ("No action items found in these notes.") and emit zero tool calls.`;

const TOOLS = [
  // ===== EXISTING 5 TOOLS =====
  {
    name: "add_task",
    description: "Create a new task in the Tasks tab.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        status: { type: "string", enum: ["Not started", "In progress", "Done", "Blocked"] },
        priority: { type: "string", enum: ["Low", "Medium", "High", "Urgent"] },
        date: { type: "string", description: "Due date YYYY-MM-DD" },
        duration: { type: "string" },
        assignee: { type: "string" },
        category: { type: "string" },
        taskType: { type: "string", enum: ["daily", "strategic"], description: "Time horizon of the task. 'daily' = execution work, 'strategic' = planning/research. Defaults to 'daily' if omitted." },
        companyId: { type: "string", description: "ID of linked company, or empty string. For tasks linked to a company being created in the same turn, leave empty — the client will link by name." },
        companyName: { type: "string", description: "OPTIONAL: name of the company this task is for. Used by the client to auto-link when companyId is empty." },
        notes: { type: "string" },
        links: { type: "string" }
      },
      required: ["name", "date"]
    }
  },
  {
    name: "update_task",
    description: "Update an existing task by ID. Use for single-task changes like renaming, changing status, rescheduling, etc. Do NOT use this for review state changes — use request_review or respond_to_review instead.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        status: { type: "string", enum: ["Not started", "In progress", "Done", "Blocked"] },
        priority: { type: "string", enum: ["Low", "Medium", "High", "Urgent"] },
        date: { type: "string" },
        assignee: { type: "string" },
        category: { type: "string" },
        taskType: { type: "string", enum: ["daily", "strategic"], description: "Time horizon of the task. 'daily' = execution work, 'strategic' = planning/research. Defaults to 'daily' if omitted." },
        notes: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "add_company",
    description: "Create a new company record.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        industry: { type: "string" },
        size: { type: "string" },
        makes: { type: "string" },
        address: { type: "string" },
        contact: { type: "string", description: "Primary contact person name" },
        contactTitle: { type: "string", description: "Optional contact job title (will be appended to notes)" },
        phone: { type: "string" },
        email: { type: "string" },
        website: { type: "string" },
        linkedin: { type: "string" },
        status: { type: "string", enum: ["Prospect", "Visited", "Quoted", "Won", "Lost"] },
        value: { type: "number" },
        owner: { type: "string" },
        notes: { type: "string" }
      },
      required: ["name"]
    }
  },
  {
    name: "update_company",
    description: "Update an existing company by ID.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        industry: { type: "string" },
        contact: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        website: { type: "string" },
        linkedin: { type: "string" },
        status: { type: "string", enum: ["Prospect", "Visited", "Quoted", "Won", "Lost"] },
        value: { type: "number" },
        owner: { type: "string" },
        notes: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "log_visit",
    description: "Log a visit/call/email/etc with a company.",
    input_schema: {
      type: "object",
      properties: {
        companyId: { type: "string" },
        date: { type: "string" },
        type: { type: "string", enum: ["In-person", "Call", "Email", "LinkedIn", "Other"] },
        outcome: { type: "string", enum: ["Positive", "Neutral", "No interest", "Follow-up needed", "Quoted"] },
        notes: { type: "string" },
        nextStep: { type: "string" },
        loggedBy: { type: "string" }
      },
      required: ["companyId", "date", "type"]
    }
  },

  // ===== 8 EXISTING TOOLS FROM v3 =====
  {
    name: "delete_task",
    description: "Delete a single task by ID. Use when user says 'delete the task about X'. Execute immediately — no confirmation needed for single deletes.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID to delete" }
      },
      required: ["id"]
    }
  },
  {
    name: "delete_company",
    description: "Delete a single company by ID. Execute immediately — no confirmation needed for single deletes. Cascades: archives linked tasks, permanently deletes linked visits and visit prep.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Company ID to delete" }
      },
      required: ["id"]
    }
  },
  {
    name: "bulk_update_tasks",
    description: "Update multiple tasks at once matching a filter. IMPORTANT: First describe what will be affected and ask the user to confirm. Only call this tool AFTER the user confirms. Use for things like 'mark all in-progress as done', 'reschedule all overdue to next Monday'.",
    input_schema: {
      type: "object",
      properties: {
        filter: {
          type: "object",
          description: "Filter criteria to match tasks. All provided fields must match (AND logic).",
          properties: {
            status: { type: "string", enum: ["Not started", "In progress", "Done", "Blocked"] },
            priority: { type: "string", enum: ["Low", "Medium", "High", "Urgent"] },
            assignee: { type: "string" },
            category: { type: "string" },
            companyId: { type: "string" },
            overdue: { type: "boolean", description: "If true, match only tasks with date before today" },
            dateRange: {
              type: "object",
              properties: {
                from: { type: "string", description: "YYYY-MM-DD start" },
                to: { type: "string", description: "YYYY-MM-DD end" }
              }
            }
          }
        },
        updates: {
          type: "object",
          description: "Fields to update on all matched tasks",
          properties: {
            status: { type: "string", enum: ["Not started", "In progress", "Done", "Blocked"] },
            priority: { type: "string", enum: ["Low", "Medium", "High", "Urgent"] },
            date: { type: "string", description: "New due date YYYY-MM-DD" },
            assignee: { type: "string" },
            category: { type: "string" }
          }
        }
      },
      required: ["filter", "updates"]
    }
  },
  {
    name: "bulk_delete_tasks",
    description: "Delete multiple tasks matching a filter. IMPORTANT: First describe what will be affected and ask the user to confirm. Only call this tool AFTER the user confirms.",
    input_schema: {
      type: "object",
      properties: {
        filter: {
          type: "object",
          description: "Filter criteria. All provided fields must match (AND logic).",
          properties: {
            status: { type: "string", enum: ["Not started", "In progress", "Done", "Blocked"] },
            priority: { type: "string", enum: ["Low", "Medium", "High", "Urgent"] },
            assignee: { type: "string" },
            category: { type: "string" },
            companyId: { type: "string" },
            overdue: { type: "boolean" },
            dateRange: {
              type: "object",
              properties: {
                from: { type: "string" },
                to: { type: "string" }
              }
            }
          }
        }
      },
      required: ["filter"]
    }
  },
  {
    name: "query_tasks",
    description: "Query/search tasks and return matching results. Use for questions like 'what's on my plate today?', 'show overdue tasks', 'what tasks do I have for Edson?', 'what's waiting for my review?'. No confirmation needed — just return the data.",
    input_schema: {
      type: "object",
      properties: {
        filter: {
          type: "object",
          description: "Filter criteria. All provided fields must match (AND logic).",
          properties: {
            status: { type: "string", enum: ["Not started", "In progress", "Done", "Blocked"] },
            priority: { type: "string", enum: ["Low", "Medium", "High", "Urgent"] },
            assignee: { type: "string" },
            category: { type: "string" },
            companyId: { type: "string" },
            overdue: { type: "boolean", description: "If true, only tasks past due date and not Done" },
            dateExact: { type: "string", description: "Exact date YYYY-MM-DD" },
            dateRange: {
              type: "object",
              properties: {
                from: { type: "string" },
                to: { type: "string" }
              }
            },
            search: { type: "string", description: "Free text search in task name and notes" },
            reviewer: { type: "string", enum: ["Prrithive", "Sridharan"], description: "Filter to tasks where this person is the named reviewer" },
            reviewStatus: { type: "string", enum: ["pending", "changes_requested", "approved"], description: "Filter to tasks with this review status" }
          }
        }
      },
      required: ["filter"]
    }
  },
  {
    name: "query_companies",
    description: "Query companies. Use for questions like 'which companies haven't I followed up with in 30 days?', 'show all prospects', 'list won companies'.",
    input_schema: {
      type: "object",
      properties: {
        filter: {
          type: "object",
          description: "Filter criteria.",
          properties: {
            status: { type: "string", enum: ["Prospect", "Visited", "Quoted", "Won", "Lost"] },
            owner: { type: "string" },
            search: { type: "string", description: "Free text search in company name, industry, notes" },
            noInteractionDays: { type: "number", description: "Companies with no interaction in this many days" }
          }
        }
      },
      required: ["filter"]
    }
  },
  {
    name: "get_briefing",
    description: "Generate a daily briefing / summary. Use when user asks 'what's my day?', 'morning briefing', 'what should I focus on?'. Analyzes today's tasks, overdue items, upcoming deadlines, and recent activity.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date to brief for, defaults to today. YYYY-MM-DD" }
      }
    }
  },
  {
    name: "get_stats",
    description: "Calculate and return CRM/task statistics. Use for questions like 'how many visits this month vs last?', 'task completion rate', 'pipeline summary'.",
    input_schema: {
      type: "object",
      properties: {
        metric: {
          type: "string",
          enum: ["visits_comparison", "task_completion", "pipeline_summary", "company_status_breakdown", "overdue_count", "general"],
          description: "Which metric to calculate"
        },
        period: { type: "string", description: "Time period like 'this month', 'last 30 days', etc." }
      },
      required: ["metric"]
    }
  },

  // ===== 2 REVIEW TOOLS (v4) =====
  {
    name: "request_review",
    description: "Request a review of a task from another user. The reviewer must be Prrithive or Sridharan and must NOT be the current user (you can't review your own tasks). The task transitions to reviewStatus=pending. Use when the user says 'ask dad to review X', 'have Prrithive check the ACME pricing', 'send this for review', etc.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID of the task to request review for" },
        reviewer: { type: "string", enum: ["Prrithive", "Sridharan"], description: "Who should review this task" },
        comment: { type: "string", description: "Optional initial note for the reviewer (e.g. context about what to review)" }
      },
      required: ["taskId", "reviewer"]
    }
  },
  {
    name: "respond_to_review",
    description: "Respond to an existing review request, or re-request after making changes. Use response='approve' or 'request_changes' if you are the reviewer (comment required for request_changes). Use response='re_request' if you are the task assignee and have addressed the requested changes. The app enforces role constraints — only the named reviewer can approve/request_changes; only the task assignee can re_request.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID of the task" },
        response: { type: "string", enum: ["approve", "request_changes", "re_request"], description: "How to respond" },
        comment: { type: "string", description: "Required when response is 'request_changes', optional otherwise" }
      },
      required: ["taskId", "response"]
    }
  }
];

/* ============================================================================
   AUTH BROKER  (/auth/exchange, /auth/token, /auth/logout)
   ----------------------------------------------------------------------------
   Why this exists: the app used to run Google's *implicit* token flow entirely in
   the browser. That flow never issues a refresh token, and its access tokens die
   after an hour and live in a JS variable — so every page refresh meant another
   trip through One Tap / FedCM, which fails outright once third-party cookies are
   blocked. Users got a "Sign in" button several times a day.

   The authorization-code flow fixes that, but it needs a client secret, which a
   static GitHub Pages site cannot hold. This Worker holds it. Split of trust:

     browser  ->  a random session id in localStorage. Useless without this Worker.
     Worker   ->  the client secret, and the refresh token in KV keyed by that id.

   So the long-lived credential never reaches the browser, and a session is
   independently revocable (delete the KV row) per device.

   Bindings required (see the setup notes in README):
     GOOGLE_CLIENT_ID      var     — same client id the front-end uses
     GOOGLE_CLIENT_SECRET  secret  — from the same OAuth client
     AUTH_SESSIONS         KV      — session id -> { refresh_token, email }
     ALLOWED_EMAILS        var     — optional CSV allowlist, enforced at sign-in
     SESSION_TTL_SECONDS   var     — optional, defaults to 24h
   ========================================================================== */

// One sign-in per device per day. This is a FIXED expiry, not a sliding one: the
// clock starts at sign-in and is not extended by use, which is what "sign in once
// a day" actually means. To make it sliding instead, re-PUT the record with a
// fresh expirationTtl inside /auth/token.
const SESSION_TTL_SECONDS_DEFAULT = 86400;
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

function jsonResponse(body, status, corsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

// 256 bits of CSPRNG, base64url. This is a bearer credential — it must not be
// guessable and must not be derived from anything (email, time) an attacker knows.
function newSessionId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Read the email out of an id_token WITHOUT verifying the signature. That is safe
// here and only here: this token came back over TLS directly from Google's token
// endpoint in response to our own request, so there is no untrusted party in the
// path. Never do this to an id_token that arrived from a client.
function emailFromIdToken(idToken) {
  try {
    const payload = idToken.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json);
    return (claims.email || "").toLowerCase();
  } catch {
    return "";
  }
}

// Fallback identity lookup for when the token response carried no id_token.
async function emailFromUserinfo(accessToken) {
  if (!accessToken) return "";
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: "Bearer " + accessToken }
    });
    if (!r.ok) return "";
    const data = await r.json();
    return (data.email || "").toLowerCase();
  } catch {
    return "";
  }
}

// Optional server-side allowlist. The front-end already blocks unknown emails, but
// that check runs in code the user controls — enforcing it here means an
// unauthorized account never gets a persistent session at all.
function emailAllowed(email, env) {
  if (!env.ALLOWED_EMAILS) return true;
  const allowed = env.ALLOWED_EMAILS.split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  return allowed.length === 0 || allowed.includes(email);
}

async function revokeToken(token) {
  if (!token) return;
  try {
    await fetch(GOOGLE_REVOKE_ENDPOINT + "?token=" + encodeURIComponent(token), { method: "POST" });
  } catch {
    // Best effort. The session row is deleted regardless, so the token is
    // unreachable from this app even if Google never saw the revoke.
  }
}

async function handleAuth(request, env, path, corsHeaders) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return jsonResponse({ error: "Worker not configured: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing" }, 500, corsHeaders);
  }
  if (!env.AUTH_SESSIONS) {
    return jsonResponse({ error: "Worker not configured: AUTH_SESSIONS KV binding missing" }, 500, corsHeaders);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: "Invalid JSON" }, 400, corsHeaders); }

  const ttl = Number(env.SESSION_TTL_SECONDS) > 0
    ? Number(env.SESSION_TTL_SECONDS)
    : SESSION_TTL_SECONDS_DEFAULT;

  // ---- POST /auth/exchange — one-time, right after Google redirects back ----
  if (path === "/auth/exchange") {
    const { code, code_verifier, redirect_uri } = body;
    if (!code || !code_verifier || !redirect_uri) {
      return jsonResponse({ error: "code, code_verifier and redirect_uri are required" }, 400, corsHeaders);
    }

    const form = new URLSearchParams({
      code,
      code_verifier,
      redirect_uri,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "authorization_code"
    });

    let tok;
    try {
      const r = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form
      });
      tok = await r.json();
      if (!r.ok) return jsonResponse({ error: "token_exchange_failed", detail: tok }, 400, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: "token_exchange_error", detail: String(err) }, 502, corsHeaders);
    }

    // No refresh token means the whole point of this endpoint failed. Google omits
    // it when the user has already consented and the request didn't force a fresh
    // consent — the client always sends prompt=consent to prevent exactly this.
    if (!tok.refresh_token) {
      await revokeToken(tok.access_token);
      return jsonResponse({
        error: "no_refresh_token",
        detail: "Google returned no refresh token. The authorization request must include access_type=offline and prompt=consent."
      }, 400, corsHeaders);
    }

    // id_token is the cheap path (it's already in the response), but it only exists
    // if `openid` was among the requested scopes. Fall back to the userinfo endpoint
    // rather than letting a scope change silently turn the allowlist into "deny all".
    let email = emailFromIdToken(tok.id_token || "");
    if (!email) email = await emailFromUserinfo(tok.access_token);

    if (!emailAllowed(email, env)) {
      // Deny before persisting anything, and hand the credentials straight back.
      await revokeToken(tok.refresh_token);
      await revokeToken(tok.access_token);
      return jsonResponse({ error: "access_denied", email }, 403, corsHeaders);
    }

    const sid = newSessionId();
    await env.AUTH_SESSIONS.put(
      sid,
      JSON.stringify({ refresh_token: tok.refresh_token, email }),
      { expirationTtl: ttl }
    );

    return jsonResponse({
      sid,
      access_token: tok.access_token,
      expires_in: tok.expires_in || 3600,
      email,
      session_ttl: ttl
    }, 200, corsHeaders);
  }

  // ---- POST /auth/token — every page load and every hourly refresh ----
  if (path === "/auth/token") {
    const { sid } = body;
    if (!sid) return jsonResponse({ error: "sid is required" }, 400, corsHeaders);

    const raw = await env.AUTH_SESSIONS.get(sid);
    // 401 is the ONLY status the client treats as "you are logged out". Everything
    // else below is reported as a transient failure so a blip in Google's token
    // endpoint doesn't bounce a working user back to the sign-in button.
    if (!raw) return jsonResponse({ error: "session_expired" }, 401, corsHeaders);

    let record;
    try { record = JSON.parse(raw); }
    catch { await env.AUTH_SESSIONS.delete(sid); return jsonResponse({ error: "session_corrupt" }, 401, corsHeaders); }

    const form = new URLSearchParams({
      refresh_token: record.refresh_token,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token"
    });

    let tok;
    try {
      const r = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form
      });
      tok = await r.json();
      if (!r.ok) {
        // invalid_grant = the refresh token is dead for good (user revoked access,
        // password change, or the 7-day expiry that Google applies while the OAuth
        // consent screen is still in "Testing"). Nothing to retry — drop the session.
        if (tok && tok.error === "invalid_grant") {
          await env.AUTH_SESSIONS.delete(sid);
          return jsonResponse({ error: "session_expired", detail: tok }, 401, corsHeaders);
        }
        return jsonResponse({ error: "refresh_failed", detail: tok }, 502, corsHeaders);
      }
    } catch (err) {
      return jsonResponse({ error: "refresh_error", detail: String(err) }, 502, corsHeaders);
    }

    return jsonResponse({
      access_token: tok.access_token,
      expires_in: tok.expires_in || 3600,
      email: record.email || ""
    }, 200, corsHeaders);
  }

  // ---- POST /auth/logout — explicit sign-out, and the access-denied path ----
  if (path === "/auth/logout") {
    const { sid } = body;
    if (!sid) return jsonResponse({ error: "sid is required" }, 400, corsHeaders);
    const raw = await env.AUTH_SESSIONS.get(sid);
    if (raw) {
      try { await revokeToken(JSON.parse(raw).refresh_token); } catch {}
      await env.AUTH_SESSIONS.delete(sid);
    }
    return jsonResponse({ ok: true }, 200, corsHeaders);
  }

  return jsonResponse({ error: "Unknown auth endpoint" }, 404, corsHeaders);
}

// ALLOWED_ORIGIN accepts a COMMA-SEPARATED list, because the app is reachable at
// both crm.maplempss.com and prrithive14.github.io — pinning a single origin would
// silently break sign-in and chat on the other one. We echo back the caller's own
// origin when it matches (a wildcard can't be combined with credentials, and being
// specific is correct regardless); unset falls back to "*", the previous behaviour.
function resolveOrigin(request, env) {
  if (!env.ALLOWED_ORIGIN) return "*";
  const allowed = env.ALLOWED_ORIGIN.split(",").map(o => o.trim()).filter(Boolean);
  if (allowed.includes("*")) return "*";
  const origin = request.headers.get("Origin") || "";
  // Falling back to allowed[0] on a non-match keeps the response well-formed; the
  // browser rejects it, which is the intended outcome for an unlisted origin.
  return allowed.includes(origin) ? origin : (allowed[0] || "*");
}

export default {
  async fetch(request, env) {
    const allowedOrigin = resolveOrigin(request, env);
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

    // Auth routing happens BEFORE the ANTHROPIC_API_KEY check below — sign-in must
    // not depend on the chat feature being configured.
    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    if (path.startsWith("/auth/")) return handleAuth(request, env, path, corsHeaders);

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "Worker not configured: ANTHROPIC_API_KEY missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let body;
    try { body = await request.json(); }
    catch { return new Response(JSON.stringify({ error: "Invalid JSON" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

    const { message = "", history = [], context = {}, images = [], mode = "normal" } = body;
    if (!message && (!images || images.length === 0)) {
      return new Response(JSON.stringify({ error: "Missing message or images" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const today = context.today || new Date().toISOString().slice(0, 10);
    const companies = Array.isArray(context.companies) ? context.companies : [];
    const companyList = companies.length
      ? companies.map(c => `  - ${c.id}: ${c.name}`).join("\n")
      : "  (none yet)";

    // Tasks context for queries — includes reviewer + reviewStatus so the LLM can reason about reviews
    const tasks = Array.isArray(context.tasks) ? context.tasks : [];
    const taskList = tasks.length
      ? tasks.slice(0, 200).map(t => {
          const base = `  - ${t.id}: "${t.name}" [${t.status}] ${t.date || "no date"} ${t.priority || ""} ${t.category || ""} ${t.assignee || ""} company:${t.companyId || "none"} type:${t.taskType || "daily"}`;
          const review = (t.reviewStatus || t.reviewer) ? ` review:${t.reviewStatus || "none"}${t.reviewer ? " by " + t.reviewer : ""}` : "";
          return base + review;
        }).join("\n")
      : "  (no tasks)";

    // Visits context for stats
    const visits = Array.isArray(context.visits) ? context.visits : [];
    const visitList = visits.length
      ? visits.slice(0, 50).map(v => `  - ${v.date}: ${v.type} with company:${v.companyId} outcome:${v.outcome || ""} by:${v.loggedBy || ""}`).join("\n")
      : "  (no visits)";

    const contextText = `<context>
Current date: ${today}
Current user: ${context.user || "Prrithive"}
Category guide: ${context.categoryGuide || ""}
${context.reviewGuide ? `Review guide: ${context.reviewGuide}` : ""}

Existing companies:
${companyList}

Current tasks:
${taskList}

Recent visits:
${visitList}
</context>

${message || (images.length > 0 ? "Process the attached business card(s)." : "")}`;

    // Build user message content (text + any images)
    const userContent = [{ type: "text", text: contextText }];
    for (const img of images) {
      if (img && img.data) {
        userContent.push({
          type: "image",
          source: { type: "base64", media_type: img.mediaType || "image/jpeg", data: img.data }
        });
      }
    }

    const messages = [
      ...history.slice(-10),
      { role: "user", content: userContent }
    ];

    // Build the system blocks. Main prompt is cached; meeting-mode addendum is
    // a separate uncached block so it doesn't bust the cache when toggled.
    const systemBlocks = [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }];
    if (mode === "meeting") {
      systemBlocks.push({ type: "text", text: MEETING_MODE_ADDENDUM });
    }

    try {
      const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "prompt-caching-2024-07-31"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 2048,
          system: systemBlocks,
          tools: TOOLS,
          messages
        })
      });

      const data = await anthropicResp.json();

      if (!anthropicResp.ok) {
        return new Response(JSON.stringify({ error: "Anthropic API error", detail: data }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const textBlocks = (data.content || []).filter(b => b.type === "text").map(b => b.text);
      const toolCalls = (data.content || [])
        .filter(b => b.type === "tool_use")
        .map(b => ({ id: b.id, name: b.name, input: b.input }));

      return new Response(JSON.stringify({
        reply: textBlocks.join("\n").trim(),
        toolCalls,
        stopReason: data.stop_reason,
        usage: data.usage || null
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (err) {
      return new Response(JSON.stringify({ error: "Worker exception", detail: String(err) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }
};
