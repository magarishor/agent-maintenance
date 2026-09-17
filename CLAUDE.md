# SmartSites Daily Maintenance Workflow

## Overview

Project automates daily WordPress maintenance for scheduled sites using Claude AI agents coordinated via workflow. Each day's maintenance sites load from Google Sheets and process in **staggered parallel batches** (5 sites concurrently per batch, each site's start offset to avoid simultaneous shared-resource calls — see [Concurrency & Rate Limiting](#concurrency--rate-limiting)). Claude dynamically selects right `smartsites-maintenance` MCP tool for each step — no rigid per-tool agent definitions.

**Model:** Haiku 4.5 (default), Sonnet for plugin/core update steps  
**Source of Truth:** `.claude/workflows/daily-maintenance.js`  
**Agent Definitions:** `.claude/agents/*.md` (only `sites-loader` remains — agent that depends on local Python script)

---

## Architecture

### 1. Workflow File
**Location:** `.claude/workflows/daily-maintenance.js`

Workflow calls inline agents per step, describing task in plain language and letting Claude pick appropriate `smartsites-maintenance` MCP tool. Only sites-loader step uses dedicated custom agent (must run `python get_today_sites.py`).

#### Phase 1: Setup
- **sites-loader agent** — Runs `python get_today_sites.py` to fetch today's sites from Google Sheets

#### Phase 2: Maintenance (staggered parallel batches, 5 sites/batch)
- Initial health check
- Check for available updates (gates next two steps)
- Queue plugin updates, if `plugins_available > 0` (model: sonnet)
- Monitor plugin batch job until complete
- Send plugin update email
- Queue core update, if `core_available == true` (model: sonnet)
- Monitor core batch job until complete
- Final health check
- Check external/third-party dependencies
- Sync results to Google Sheets
- Send final site report email

#### Phase 3: Summary
- Send daily summary email

### 2. Agent Definitions
**Location:** `.claude/agents/*.md`

Only one custom agent remains:

| Agent | Purpose | Why it's a custom agent |
|-------|---------|--------------------------|
| sites-loader | Fetch today's sites from Google Sheets | Needs `Bash` to run `python get_today_sites.py` — not something MCP tool can do |

All other steps (health checks, update checks, plugin/core updates, batch monitoring, external checks, sheet sync, emails) are plain inline `agent()` calls in workflow. Each prompt describes goal and tells Claude to use smartsites-maintenance MCP tools — Claude decides which specific tool to call and how, not workflow hardcoding tool name into dedicated agent file.

**Available smartsites-maintenance MCP tools** (Claude picks right one per step):
`health-check-tool`, `check-updates-tool`, `update-all-plugins-tool`, `update-plugin-tool`, `update-core-tool`, `check-batch-status-tool`, `check-external-updates-tool`, `sync-sheets-tool`, `create-backup-tool`, `list-backups-tool`, `rollback-tool`, `site-info-tool`, `queue-status-tool`, `maintenance-logs-tool`, `who-am-i-tool`, and others.

---

## Email Sending

**Critical:** Report-composer MUST actually send emails, not just compose them.

### How Emails Are Sent

1. **Compose** professional HTML email
2. **Call** `send_email.py` using Bash:
   ```bash
   python send_email.py --to "recipient@email.com" --subject "Subject" --body "HTML_CONTENT"
   ```
3. **Parse** JSON response
4. **Return** `{sent: true/false, message: "..."}`

### send_email.py Details

**Location:** `send_email.py`  
**Uses:** Gmail SMTP with credentials from `.env`  
**Config Keys:**
- `SMTP_HOST` — smtp.gmail.com
- `SMTP_PORT` — 587
- `SMTP_USER` — ssfeddev32@gmail.com
- `SMTP_PASSWORD` — App password (from .env)
- `REPORT_EMAIL` — frontend@smartsites.com

---

## Timing & Context

### Agent Call Intervals
- **Between steps:** 1 minute (60 seconds) — STRICT interval between each agent call, per site
- **Batch monitoring:** 2 minutes (120 seconds) between status checks — STRICT, per site
- **Between batches:** 30 seconds (`BATCH_DELAY`) after all 5 sites in a batch finish, before starting the next batch

### Concurrency & Rate Limiting

Sites run in parallel batches of `PARALLEL_BATCH_SIZE = 5` via `Promise.all`. Because every site follows the *identical* fixed sequence of fixed-length waits, running them naively in parallel makes them stay in lock-step — all 5 would call the same shared-resource tool (e.g. `check-batch-status-tool`, `sync-sheets-tool`) at the same instant, tripping rate limits that a single manual site run never hits (`check-batch-status-tool` is limited to 1 call/15s per `batch_id`; Google Sheets API write quotas are per-minute per project). **This was the root cause of "works one-by-one, fails in bulk."**

Two mitigations in `daily-maintenance.js`:
1. **`SITE_STAGGER_OFFSET` (20s)** — each site within a batch starts `idx * 20s` after the previous one, so their identical wait sequences drift apart instead of firing in lock-step.
2. **`withSharedResourceLimit(resourceKey, fn)`** — a cross-site rate limiter (chained-promise queue, no `Date.now()`/`new Date()` — unsafe for workflow resume) that serializes calls to a named shared resource across ALL concurrently-running sites, enforcing a minimum cooldown gap via `SHARED_RESOURCE_GAP`:
   - `'batch-status'` → 20s gap (above the confirmed 15s/`batch_id` limit)
   - `'sheet-sync'` → 15s gap
   Wired around every `check-batch-status-tool` and `sync-sheets-tool` call so concurrent sites can't fan out against the same endpoint simultaneously, even if staggering alone isn't enough.

If bulk runs still fail after this, increase `SITE_STAGGER_OFFSET` and/or the relevant `SHARED_RESOURCE_GAP` entry, or add a new resource key around another shared call (e.g. Chat notifications) using the same `withSharedResourceLimit` helper.

### Context Passing
- Each agent receives previous step results and health status
- Agents use prior step outcomes to inform decisions
- Enables sequential intelligence within a site: each step knows what happened before it (sites themselves are independent of each other, aside from sharing the rate limiter above)

## Conditional Logic

### Plugin Updates
- **Called if:** `updateCheck?.plugins_available > 0`
- **Step:** inline agent call, model sonnet, uses `update-all-plugins-tool`
- **Skip if:** 0 plugins available (logs "No plugin updates available, skipping...")

### Core Updates
- **Called if:** `updateCheck?.core_available === true`
- **Step:** inline agent call, model sonnet, uses `update-core-tool`
- **Skip if:** No core updates available

### Batch Monitoring
- **Loop:** While status pending/processing
- **Interval:** 2 minutes (120 seconds) between checks — STRICT
- **Max checks:** 5 checks (~10 minutes timeout)
- **Terminal states:** success, failed, cancelled

---

## File Structure

```
.
├── .claude/
│   ├── agents/
│   │   └── sites-loader.md         # Only custom agent — runs get_today_sites.py
│   └── workflows/
│       └── daily-maintenance.js    # MAIN WORKFLOW (source of truth)
├── .env                            # Secrets (Google Sheets API, SMTP, etc.)
├── .gitignore                      # Ignore .env and cache files
├── get_today_sites.py              # Fetch sites from Google Sheets for today
├── send_email.py                   # Send emails via SMTP
├── test_email.py                   # Test email functionality
├── CLAUDE.md                       # This file
└── README.md                       # User-facing documentation
```

---

## How to Run

### Manual Test
```bash
cd C:\Users\SmartSites-Bidur\Documents\AI-All\agent-maintenance
python test_email.py              # Verify email setup
python get_today_sites.py          # Check today's sites
```

### Via Workflow
In Claude Code, reference workflow by name:
```javascript
await Workflow({ name: 'daily-maintenance' })
```

Or specify path:
```javascript
await Workflow({
  scriptPath: 'C:\\Users\\SmartSites-Bidur\\Documents\\AI-All\\agent-maintenance\\.claude\\workflows\\daily-maintenance.js'
})
```

---

## Troubleshooting

### Plugin/Core Updates Not Applied
- Check update-check step response: `plugins_available` and `core_available`
- If 0/false, they're correctly skipped
- If > 0/true, check agent transcript for that step to confirm it called MCP tool rather than searching/describing
- If agent claims tool doesn't exist, it likely tried search instead of calling directly — rephrase step's prompt to be direct

### Emails Not Sent
- Verify `send_email.py` is called (not just HTML composed)
- Check `.env` has valid SMTP credentials
- Run `python test_email.py` to test email setup
- Look for Python errors in agent transcript

### Sites Not Loaded
- Check `.env` has `GOOGLE_SHEET_ID` and `GOOGLE_API_KEY`
- Verify Google Sheet has tab for today's day (Sunday, Monday, etc.)
- Run `python get_today_sites.py` to test

### Batch Jobs Not Monitored
- Ensure batch-status step runs after each update step
- Check max iteration count (MAX_BATCH_CHECKS = 5) — times out at ~10 minutes
- Verify `check-batch-status-tool` is accessible
- If batch stuck, check interval is 2 minutes (120 seconds) between each check

### Works One-by-One But Fails/Times Out in Bulk
- This is almost always the concurrent-fan-out issue described in [Concurrency & Rate Limiting](#concurrency--rate-limiting) — multiple sites in a batch hitting the same rate-limited endpoint (`check-batch-status-tool`, `sync-sheets-tool`) at the same instant
- Check that `withSharedResourceLimit(...)` still wraps every `check-batch-status-tool` and `sync-sheets-tool` call in `daily-maintenance.js` — if a new shared-resource call was added without wrapping it, it can reintroduce this failure mode
- If it still happens, increase `SITE_STAGGER_OFFSET` and/or the relevant `SHARED_RESOURCE_GAP` value, or lower `PARALLEL_BATCH_SIZE`
- Sheet sync failing specifically in bulk (but not solo) usually means Google Sheets API per-minute write quota was burst past — widen the `'sheet-sync'` gap

---

## Key Rules

### ✅ DO

- **Let Claude pick MCP tool** — Describe goal in prompt; don't hardcode rigid per-tool agent
- **Send emails** — email step must call send_email.py, not just compose HTML
- **Conditional logic** — Queue updates only if they exist
- **Monitor batches** — Loop until batch completes or timeout
- **Return structured data** — Steps return JSON-parseable objects (schema-validated)

### ❌ DON'T

- Compose without sending (email step must call send_email.py, not just compose HTML)
- Skip MCP tool calls (must use actual tools, not mock them)
- Update unconditionally (check if updates exist first)
- Hardcode credentials (use .env file)
- Add back rigid per-tool custom agents for MCP-only steps — only `sites-loader` needs one (Python/Bash access)
- Modify workflow cache (edit `.claude/workflows/daily-maintenance.js` in original project)

---

## Future Enhancements

1. **Adaptive rate limiting** — Tune `SITE_STAGGER_OFFSET`/`SHARED_RESOURCE_GAP` dynamically based on observed rate-limit errors instead of fixed constants
2. **Retry logic** — Retry failed updates with exponential backoff
3. **Rollback** — Rollback updates if health check fails after
4. **Custom alerts** — Send alerts on critical failures
5. **Dashboard** — Web UI to view maintenance history
6. **Scheduling** — Automated daily execution at specific time

---

## Contact

For issues or improvements, update documentation and reference:
- Workflow: `.claude/workflows/daily-maintenance.js`
- Agents: `.claude/agents/*.md`
- Tests: `test_email.py`, `get_today_sites.py`