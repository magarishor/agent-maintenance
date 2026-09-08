# SmartSites Agentic Daily Maintenance - Developer Guide

Comprehensive guide for developers setting up, understanding, and troubleshooting the AI-powered daily maintenance workflow.

**Last Updated:** 2026-08-05  
**Version:** 1.0  
**Status:** Production Ready

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Workflow Execution Flow](#workflow-execution-flow)
4. [MCP Tools Reference](#mcp-tools-reference)
5. [Logging & Debugging](#logging--debugging)
6. [Setting Up Automated Scheduling](#setting-up-automated-scheduling)
7. [Configuration](#configuration)
8. [Troubleshooting](#troubleshooting)
9. [FAQ](#faq)

---

## Quick Start

### Prerequisites

- Claude Code installed (CLI or VS Code extension)
- Windows 11 with PowerShell or access to Bash
- `.env` file configured with credentials
- Python 3.8+ for helper scripts
- Google Sheets API credentials
- Gmail SMTP configured

### Run Manually (Development/Testing)

```bash
cd C:\Users\SmartSites-Bidur\Documents\AI-All\agent-maintenance

# Test email setup
python test_email.py

# Check today's sites load correctly
python get_today_sites.py

# Run full workflow via Claude Code
claude workflow run .claude/workflows/daily-maintenance.js
```

### Run via Claude Code Interactive

```javascript
// In Claude Code terminal or quick action
await Workflow({ name: 'daily-maintenance' })

// Or with explicit path
await Workflow({
  scriptPath: 'C:\\Users\\SmartSites-Bidur\\Documents\\AI-All\\agent-maintenance\\.claude\\workflows\\daily-maintenance.js'
})
```

### Schedule Automated Runs

See [Setting Up Automated Scheduling](#setting-up-automated-scheduling) below.

---

## Architecture Overview

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────┐
│  Daily Maintenance Workflow (daily-maintenance.js)           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Phase 1: SETUP                                              │
│  ├─ Load today's sites from Google Sheets (get_today_sites.py)
│  └─ Parse & validate site list                              │
│                                                               │
│  Phase 2: MAINTENANCE (Sequential per site)                 │
│  ├─ For each site:                                           │
│  │  ├─ Health check (initial)                               │
│  │  ├─ Check available updates                              │
│  │  ├─ [IF plugins available] Update plugins + monitor      │
│  │  ├─ [IF core available] Update core + monitor            │
│  │  ├─ Health check (final)                                 │
│  │  ├─ Check external/3rd-party updates                     │
│  │  ├─ Sync results to Google Sheets                        │
│  │  ├─ Send individual site report email                    │
│  │  └─ Write JSON log file (site_ID.json)                   │
│  │                                                            │
│  └─ Delay 60 seconds before next site                       │
│                                                               │
│  Phase 3: SUMMARY                                            │
│  └─ Send daily summary email (all sites results)            │
│                                                               │
└─────────────────────────────────────────────────────────────┘
        ↓
   MCP Tools (smartsites-maintenance)
        ↓
   WordPress Sites
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Workflow** | `.claude/workflows/daily-maintenance.js` | Orchestrates entire process, calls agents per step |
| **Sites Loader Agent** | `.claude/agents/sites-loader.md` | Only custom agent; runs `get_today_sites.py` |
| **Inline Agents** | In workflow file | Each step calls inline agent; Claude picks right MCP tool |
| **Python Scripts** | `get_today_sites.py`, `send_email.py` | Helpers for loading sites and sending emails |
| **Logs** | `log/maintenance_logs/` | JSON files per site: `site_SITEID.json` |
| **Config** | `.env` | Secrets: API keys, SMTP, Sheet ID |

### Design Philosophy

- **Dynamic MCP Tool Selection**: Workflow describes goals in plain language; Claude picks appropriate MCP tool
- **Sequential Processing**: Sites processed one at a time (not parallel) to prevent overload
- **Strict Intervals**: 60s between steps, 120s between batch checks (prevents rate-limiting)
- **Conditional Logic**: Plugin/core updates only run if updates available
- **Retry Logic**: External checks & sheet sync retry up to 3 times on failure
- **Comprehensive Logging**: Every step result logged to JSON file + email reports

---

## Workflow Execution Flow

### Timeline per Site

```
1. Health Check (Initial)
   └─ 60s wait
   
2. Check for Updates
   └─ 60s wait
   
3. Update Plugins [IF plugins_available > 0]
   ├─ Run update-all-plugins-tool
   ├─ [IF no backup] Create backup + retry
   └─ 60s wait
   
3a. Monitor Plugin Batch [IF batch_id valid]
    ├─ Wait 120s
    ├─ Check batch status (max 5 checks = ~10 min timeout)
    └─ 60s wait
    
3b. Send Plugin Report Email
    └─ 60s wait

4. Update WordPress Core [IF core_available == true]
   ├─ Run update-core-tool
   └─ 60s wait
   
4a. Monitor Core Batch [IF batch_id valid]
    ├─ Wait 120s
    ├─ Check batch status (max 5 checks = ~10 min timeout)
    └─ 60s wait

5. Final Health Check
   └─ 60s wait

6. Check External Updates [MANDATORY, retry 3x]
   └─ 60s wait

7. Sync to Google Sheets [MANDATORY, retry 3x]
   └─ 60s wait

8. Send Final Site Report Email
   └─ Write site log to JSON
   └─ 60s wait (before next site)
```

### Configuration Constants

```javascript
// In daily-maintenance.js
const AGENT_CALL_INTERVAL = 60_000     // 1 minute between agent calls
const BATCH_CHECK_INTERVAL = 120_000   // 2 minutes between batch checks
const SITE_DELAY = 60_000              // 60 seconds between sites
const MAX_BATCH_CHECKS = 5             // Max 5 checks = ~10 min timeout
const MAX_RETRIES = 3                  // Max retries for external/sheet sync
const REPORT_EMAIL = 'frontend@smartsites.com'
```

### Models Used

| Step | Model | Reason |
|------|-------|--------|
| Load sites | Haiku | Simple Python execution |
| Health checks | Haiku | Simple tool calls |
| Update checks | Haiku | Simple data parsing |
| Plugin updates | **Sonnet** | Complex backup/retry logic |
| Core updates | **Sonnet** | Complex version handling |
| Batch monitoring | Haiku | Sequential status checks |
| Email sending | Haiku | Simple HTML composition |

---

## MCP Tools Reference

### Available smartsites-maintenance Tools

The workflow calls these MCP tools dynamically. Claude selects the right tool based on step description.

#### Health Checks
- **`health-check-tool`** — Check if site is healthy
  - Params: `id` (site_id)
  - Returns: `{status: "healthy"|"warning"|"critical", errors: []}`

#### Updates
- **`check-updates-tool`** — Check available updates
  - Params: `id`
  - Returns: `{plugins_available: number, core_available: boolean, core_version: string, plugin_list: array}`

- **`update-all-plugins-tool`** — Update all plugins
  - Params: `id`, `create_backup`, `run_health_checks`
  - Returns: `{batch_id: string, status: string, plugins_updated: number, message: string}`

- **`update-plugin-tool`** — Update single plugin
  - Params: `id`, `plugin_slug`, `create_backup`
  - Returns: `{batch_id: string, status: string, message: string}`

- **`update-core-tool`** — Update WordPress core
  - Params: `id`, `version`, `create_backup`, `run_health_checks`
  - Returns: `{batch_id: string, status: string, target_version: string, message: string}`

#### Batch Operations
- **`check-batch-status-tool`** — Monitor batch job progress
  - Params: `id`, `batch_id`
  - Returns: `{status: string, batch_id: string, completed_count: number, total_count: number, jobs_summary: {pending, running, completed, failed, cancelled}, jobs: []}`

#### External & Integrations
- **`check-external-updates-tool`** — Check for non-WordPress updates
  - Params: `id`
  - Returns: `{found_external: boolean, updates: array, message: string}`

- **`sync-sheets-tool`** — Sync results to Google Sheets
  - Params: `id`
  - Returns: `{synced: boolean, message: string, row: number, status: string}`

#### Backups
- **`create-backup-tool`** — Create site backup before updates
  - Params: `id`, `backup_type` ("full"|"incremental")
  - Returns: `{success: boolean, backup_id: string, message: string}`

- **`list-backups-tool`** — List available backups
  - Params: `id`
  - Returns: `{backups: [{id, date, type, size}], message: string}`

- **`rollback-tool`** — Rollback to previous backup
  - Params: `id`, `backup_id`
  - Returns: `{success: boolean, message: string}`

#### Utilities
- **`site-info-tool`** — Get site information
  - Params: `id`
  - Returns: `{site_id, url, wp_version, plugins_count, theme, status}`

- **`queue-status-tool`** — Check maintenance queue status
  - Params: None
  - Returns: `{queued_count: number, in_progress: number, completed_today: number, failed: number}`

- **`maintenance-logs-tool`** — Get maintenance history
  - Params: `id`, `days` (optional, default 7)
  - Returns: `{logs: [...]}`

- **`who-am-i-tool`** — Verify MCP server connection
  - Params: None
  - Returns: `{authenticated: boolean, user: string, permissions: []}`

---

## Logging & Debugging

### Log Files Location

```
C:\Users\SmartSites-Bidur\Documents\AI-All\agent-maintenance\log\maintenance_logs\
├── site_SITEID1.json        # Individual site results
├── site_SITEID2.json
├── site_SITEID3.json
└── ...
```

### Site Log File Structure

Each `site_SITEID.json` contains:

```json
{
  "url": "https://example.com",
  "site_id": "12345",
  "row": 3,
  "status": "completed|failed",
  "steps": {
    "initial_health": {
      "status": "healthy|warning|critical",
      "details": {}
    },
    "update_check": {
      "plugins_available": 5,
      "core_available": true,
      "core_version": "6.5.1",
      "details": {}
    },
    "plugin_update_request": {
      "batch_id": "batch_123",
      "status": "queued|processing|completed|failed",
      "details": {}
    },
    "plugin_update_email": {
      "sent": true,
      "status": "completed"
    },
    "core_update_request": {
      "batch_id": "batch_124",
      "target_version": "6.5.1",
      "status": "completed",
      "details": {}
    },
    "final_health": {
      "status": "healthy",
      "details": {}
    },
    "external_updates": {
      "found": false,
      "details": {}
    },
    "sheet_sync": {
      "synced": true,
      "row": 3
    },
    "final_report_email": {
      "sent": true
    }
  },
  "batch_jobs": [
    {
      "type": "plugin_update",
      "batch_id": "batch_123",
      "checks": 3,
      "final_status": "completed",
      "details": {}
    },
    {
      "type": "core_update",
      "batch_id": "batch_124",
      "checks": 2,
      "final_status": "completed",
      "details": {}
    }
  ],
  "step_log": [
    {
      "step_number": 1,
      "step_name": "Health Check (Initial)",
      "status": "success",
      "details": {}
    },
    {
      "step_number": 2,
      "step_name": "Check for Updates",
      "status": "success",
      "details": {}
    }
  ],
  "error": null
}
```

### Accessing Logs in Claude Code

#### View Latest Site Log
```bash
# PowerShell
Get-Content -Path "log\maintenance_logs\site_*.json" | ConvertFrom-Json | Select-Object -First 1

# Check specific site
Get-Content -Path "log\maintenance_logs\site_12345.json" | ConvertFrom-Json
```

#### Check Workflow Transcript
In Claude Code:
1. Run workflow
2. After completion, click "View transcript"
3. Search for specific step label: `health-check-initial`, `update-plugins`, etc.
4. See full agent output for that step

### Debugging Checklist

**When something fails, check in this order:**

1. **Google Sheets Connection**
   ```bash
   python get_today_sites.py
   # Should show list of sites for today
   ```

2. **Email Setup**
   ```bash
   python test_email.py
   # Should send test email to REPORT_EMAIL
   ```

3. **MCP Tool Access**
   - Check if `smartsites-maintenance` MCP server is connected
   - In Claude Code, run: `rtk who-am-i` to verify authentication

4. **Workflow Execution**
   - Run workflow in Claude Code
   - Click "View transcript" when complete
   - Look for specific step failures
   - Check agent output for error messages

5. **Site Logs**
   - Check `log/maintenance_logs/site_SITEID.json` for that site
   - Look at `error` field for failure reason
   - Check `step_log` array to see which step failed

6. **Batch Jobs**
   - If batch monitoring is timing out, check batch job is actually running
   - Verify `check-batch-status-tool` returns valid JSON
   - Check `MAX_BATCH_CHECKS` (5 checks = ~10 minutes max wait)

### Debug Mode (Manual Execution)

Run single site manually for testing:

```javascript
// In Claude Code
const siteData = {
  url: "https://test.example.com",
  site_id: "12345",
  row: 1,
  test_pass: "yes"
};

// Test health check
const health = await agent(
  `Call smartsites-maintenance:health-check-tool with id="${siteData.site_id}". Return {status, errors}.`,
  { label: 'test-health' }
);

console.log(JSON.stringify(health, null, 2));
```

---

## Setting Up Automated Scheduling

### Option 1: Windows Task Scheduler (Local)

#### Step 1: Verify Claude Code CLI

```powershell
# Check if claude command is available
claude --version

# If not found, add to PATH or use full path
```

#### Step 2: Create Task Scheduler Job

1. Open Task Scheduler (Windows key → search "Task Scheduler")
2. Right-click "Task Scheduler Library" → Create Task
3. **General tab:**
   - Name: `SmartSites Daily Maintenance`
   - Description: `AI-powered daily WordPress maintenance`
   - Check: "Run whether user is logged in or not"
   - Check: "Run with highest privileges"

4. **Triggers tab:**
   - Click "New..."
   - Trigger: "On a schedule"
   - Recurrence: "Daily"
   - Time: `2:00 AM` (adjust to your preference)
   - Repeat task every: `1 day`

5. **Actions tab:**
   - Program/script: `claude`
   - Arguments: `workflow run .claude/workflows/daily-maintenance.js`
   - Start in: `C:\Users\SmartSites-Bidur\Documents\AI-All\agent-maintenance`

6. **Conditions tab:**
   - Uncheck: "Stop if the computer switches to battery power" (if desired)

7. **Settings tab:**
   - Check: "Allow task to be run on demand"
   - Check: "Run task as soon as possible after a scheduled start is missed"

8. Click OK → Enter your Windows password

#### Step 3: Test the Task

1. In Task Scheduler, find your task
2. Right-click → Run
3. Check if it executes (may take 1-2 minutes to start)
4. Check email for maintenance report

#### Step 4: Verify Task Runs

```powershell
# Get task details
Get-ScheduledTask -TaskName "SmartSites Daily Maintenance"

# View task history
Get-ScheduledTaskInfo -TaskName "SmartSites Daily Maintenance"
```

---

### Option 2: Claude Code Scheduled Agents (Cloud)

#### Use Claude Code /schedule Command

In Claude Code interactive session:

```
/schedule
```

Then:
1. Choose "Create new scheduled routine"
2. Select workflow: `.claude/workflows/daily-maintenance.js`
3. Set cron pattern: `0 2 * * *` (2 AM daily)
4. Verify and create

Advantages:
- Runs in cloud (no local dependency)
- Survives machine reboots
- Integrated with Claude Code
- Easy to monitor and modify

---

### Option 3: External Cron Service (Cloud)

Use a free cron service like **cron-job.org** or **easycron.com**:

1. Set up webhook to trigger Claude Code workflow
2. Point to remote API endpoint
3. Configure schedule

Not recommended for this project (local scheduling is simpler).

---

## Configuration

### Environment Variables (.env)

```bash
# Google Sheets
GOOGLE_SHEET_ID=1ToMticvQWHAkQ8FU5c7uO2GLlvpjmG4ZAKMyQOdAB8A

# Gmail SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=ssfeddev32@gmail.com
SMTP_PASSWORD=xxxx xxxx xxxx xxxx  # App password (16 chars)

# Reporting
REPORT_EMAIL=frontend@smartsites.com

# Service Account (Google Sheets API)
SERVICE_ACCOUNT_JSON_PATH=./maintenance-backups-1e58c79f6033.json

# Optional: Maintenance queue settings
BATCH_CHECK_INTERVAL=120          # Seconds between batch status checks
MAX_BATCH_WAIT=600                # Max seconds to wait for batch
```

### Workflow Constants

Edit `.claude/workflows/daily-maintenance.js`:

```javascript
const AGENT_CALL_INTERVAL = 60_000   // Time between agent calls (ms)
const BATCH_CHECK_INTERVAL = 120_000 // Time between batch checks (ms)
const SITE_DELAY = 60_000            // Delay between sites (ms)
const MAX_BATCH_CHECKS = 5           // Max batch status checks before timeout
const MAX_RETRIES = 3                // Max retries for external/sheet sync
const REPORT_EMAIL = 'frontend@smartsites.com'
```

### Google Sheets Structure

The Google Sheet must have:
- **Tabs named after days:** Sunday, Monday, Tuesday, etc.
- **Columns A-I:** URL, Site ID, GLog Sheet, Full API Key, Readonly API Key, API Base URL, Test Pass, Notes, Dev Name
- **Data rows:** One row per site

Example tab "Friday":
| A (URL) | B (Site ID) | C (GLog) | D (API Key) | ... | I (Dev) |
|---------|-------------|---------|-------------|-----|---------|
| https://site1.com | 123 | ... | ... | ... | John |
| https://site2.com | 456 | ... | ... | ... | Jane |

---

## Troubleshooting

### Problem: "No sites found for today"

**Possible Causes:**
1. Google Sheet not shared with service account
2. Tab name doesn't match day name (must be exact: "Monday", not "monday")
3. Tab is empty (no URLs in column A)

**Solution:**
1. Verify `.env` has correct `GOOGLE_SHEET_ID`
2. Run `python get_today_sites.py` to test
3. Check Google Sheet directly:
   - Open sheet in browser
   - Verify tab exists for today's day
   - Verify column A has URLs

### Problem: Email reports not sent

**Possible Causes:**
1. `send_email.py` not being called (just HTML composed)
2. Invalid SMTP credentials
3. Gmail app password expired

**Solution:**
1. Check `.env` has valid credentials:
   ```bash
   SMTP_USER=ssfeddev32@gmail.com
   SMTP_PASSWORD=xxxx xxxx xxxx xxxx  # Must be app password, not regular password
   ```
2. Test email setup:
   ```bash
   python test_email.py
   ```
3. Regenerate app password:
   - Go to https://myaccount.google.com/apppasswords
   - Select "Mail" and "Windows (or other device)"
   - Copy 16-character password
   - Update `.env`

### Problem: Plugin/core updates not running

**Possible Causes:**
1. Update check step returned 0 plugins or false for core
2. Agent didn't call MCP tool (tried search instead)
3. MCP tool not available

**Solution:**
1. Check update-check step in transcript:
   ```
   plugins_available: 0 → Skip plugin update (correct)
   core_available: false → Skip core update (correct)
   ```
2. If should be > 0, check agent called correct tool:
   - Look for "MUST CALL: update-all-plugins-tool" in transcript
   - Verify agent actually invoked tool (not just described it)

3. Verify MCP tool is accessible:
   ```bash
   # In Claude Code
   rtk mcp list
   # Should show smartsites-maintenance server
   ```

### Problem: Batch monitoring timeout

**Symptoms:**
- Batch job queued but status checks keep running
- Workflow waits 10+ minutes

**Possible Causes:**
1. Batch job stuck (not actually running)
2. Check interval too long (waiting 120s between checks)
3. Max checks (5) reached before batch completes

**Solution:**
1. Reduce `MAX_BATCH_CHECKS` to fail faster:
   ```javascript
   const MAX_BATCH_CHECKS = 3  // ~6 min timeout instead of 10
   ```

2. Check if batch job actually exists:
   - Look at batch_id in transcript
   - Verify in maintenance system that batch is processing
   - Check if batch got stuck at "pending"

3. Manually cancel stuck batch:
   - Contact maintenance system admin
   - Or use `rollback-tool` to revert changes

### Problem: Sheet sync failing

**Symptoms:**
- Sync step fails even after 3 retries
- Email says "Sheet sync FAILED after 3 retries"

**Possible Causes:**
1. Google Sheets API rate limit exceeded
2. Sheet formula errors in update cells
3. Row data doesn't match sheet structure

**Solution:**
1. Check Google Sheets directly:
   - Open the sheet
   - Verify columns match expected structure
   - Look for formula errors (red triangles)

2. Increase retry interval in workflow:
   ```javascript
   // Add wait time between retries
   await new Promise(r => setTimeout(r, 30_000)) // 30s wait
   ```

3. Contact Google Sheets API quota:
   - Check https://console.cloud.google.com/apis/api/sheets.googleapis.com/quotas
   - Verify service account isn't hitting limits

### Problem: Workflow crashes mid-execution

**Symptoms:**
- Only 2-3 sites completed
- Workflow stops without error message

**Possible Causes:**
1. Agent call timed out (> 2 minutes)
2. MCP server disconnected
3. Rate limiting from service

**Solution:**
1. Check agent transcript for timeout errors
2. Try running with longer agent timeout:
   ```javascript
   const AGENT_CALL_INTERVAL = 90_000  // Increase to 90 seconds
   ```

3. Restart MCP server connection in Claude Code:
   - Close and reopen Claude Code
   - Reconnect MCP server
   - Run workflow again

### Problem: "Authentication failed" for MCP tools

**Symptoms:**
- Agent says "smartsites-maintenance tool not found"
- MCP authentication error in transcript

**Solution:**
1. Verify MCP server authentication:
   ```bash
   # In Claude Code
   /mcp smartsites-maintenance
   # Follow authentication flow
   ```

2. Check credentials:
   - Verify `.env` has valid API keys
   - Check service account file exists
   - Regenerate service account if needed

3. In VS Code: Open MCP Communicator
   - Check server status
   - Re-authenticate if needed

---

## FAQ

### Q: How long does a full maintenance run take?

**A:** For 10 sites:
- Setup: 1-2 minutes (load sites)
- Per site: 30-45 minutes (includes 120s batch waits, 60s agent intervals)
- Total: ~4-7 hours for 10 sites

Breakdown per site:
- Health checks: 2 × 1-2 minutes
- Update checks: 1 minute
- Plugin updates: 10-15 minutes (including batch monitoring)
- Core updates: 5-10 minutes (including batch monitoring)
- External checks: 1-2 minutes
- Sheet sync: 1 minute
- Emails: 1 minute
- Waiting between steps: 6 × 1 minute

### Q: Can I run multiple sites in parallel?

**A:** Not currently. The workflow processes sites sequentially to:
1. Prevent rate-limiting
2. Avoid overwhelming the maintenance system
3. Keep logs clean and organized

Future enhancement: Add parallel processing with configurable concurrency.

### Q: What if a site fails? Does it stop the whole workflow?

**A:** No. Each site has try-catch error handling. If one site fails:
1. Error is logged to that site's JSON file
2. `failed` counter increments
3. Workflow continues to next site

The daily summary email shows which sites failed.

### Q: Can I monitor progress in real-time?

**A:** Yes:
1. Run workflow in Claude Code (interactive)
2. Watch the progress tree expand as steps execute
3. Click on any agent to see its transcript
4. Check log files in real-time: `log/maintenance_logs/`

### Q: What happens if the workflow is interrupted?

**A:** Currently, the workflow restarts from beginning. Future enhancement: Add checkpoint/resume capability.

If interrupted:
- Partial site logs saved to `log/maintenance_logs/`
- Emails may have been sent for completed sites
- Run workflow again to complete remaining sites

### Q: How do I add a new site?

**A:** 
1. Open Google Sheet
2. Find tab for day of week
3. Add new row with: URL, Site ID, GLog Sheet, API Key, etc.
4. Save sheet
5. Workflow automatically picks it up on next run

### Q: How do I disable a site from maintenance?

**A:**
1. Delete the row from Google Sheet tab
2. Or move it to a "Disabled" tab
3. Site will be skipped on next run

### Q: Can I customize email templates?

**A:** Currently, emails are generated by agents with hardcoded format. To customize:
1. Edit step prompts in `.claude/workflows/daily-maintenance.js`
2. Modify email body in agent call
3. Update `send_email.py` to use custom template files

### Q: How do I see detailed logs for a failed batch job?

**A:** 
1. Check `site_SITEID.json` in `log/maintenance_logs/`
2. Look at `batch_jobs` array
3. Find batch with `final_status: "failed"`
4. Check `details` field for error details

Or access batch logs directly:
- Connect to maintenance system
- Query batch logs by batch_id
- Look for error messages in job logs

### Q: What's the difference between "pending" and "processing" batch status?

**A:**
- **pending**: Job queued, not started yet
- **processing**: Job currently running
- **completed**: Job finished successfully
- **failed**: Job encountered error

Workflow waits for all jobs to leave "pending" and "processing" states.

### Q: Can I manually trigger a batch job?

**A:** Yes, run:
```javascript
const result = await agent(
  `Call smartsites-maintenance:update-all-plugins-tool with id="SITEID". Return {batch_id, status, message}.`,
  { label: 'manual-plugin-update' }
);
```

Then monitor with:
```javascript
const status = await agent(
  `Call smartsites-maintenance:check-batch-status-tool with id="SITEID", batch_id="${result.batch_id}". Return status.`,
  { label: 'check-manual-batch' }
);
```

### Q: What if I need to stop a running workflow?

**A:** In Claude Code:
1. Click "Stop" button on workflow progress
2. Or press Ctrl+C in terminal
3. Partial results saved to logs

Current site may complete before stopping due to in-flight agent calls.

### Q: How do I backup before running maintenance?

**A:** Workflow already handles backups:
- Plugin update step: `create_backup=true`
- Core update step: `create_backup=true`
- If no backup exists, auto-creates one before update

View backups:
```javascript
const backups = await agent(
  `Call smartsites-maintenance:list-backups-tool with id="SITEID". Return {backups}.`,
  { label: 'list-backups' }
);
```

### Q: How do I rollback if something goes wrong?

**A:**
```javascript
const rollback = await agent(
  `Call smartsites-maintenance:rollback-tool with id="SITEID", backup_id="BACKUPID". Return {success, message}.`,
  { label: 'rollback' }
);
```

Find backup_id from:
1. List backups (see above)
2. Check site logs: `site_SITEID.json` → `batch_jobs` → `details`

---

## Advanced Topics

### Extending the Workflow

To add custom steps:

1. **Add new agent call:**
```javascript
const result = await agent(
  `Your task description...`,
  {
    label: 'unique-step-name',
    phase: 'Maintenance',
    schema: { /* optional: validate response */ }
  }
)
```

2. **Add to site result:**
```javascript
siteResult.steps.custom_step = {
  status: result?.status,
  details: result
}
```

3. **Log the step:**
```javascript
siteResult.step_log.push({
  step_number: 9,  // Or next available
  step_name: 'Custom Step',
  status: result ? 'success' : 'failed',
  details: result
})
```

### Custom Agents

Create `.claude/agents/custom-agent.md`:
```markdown
---
name: custom-agent
description: Description of what this agent does
type: general-purpose
---

Your agent instructions here.
```

Then use in workflow:
```javascript
const result = await agent(prompt, {
  label: 'custom-label',
  agentType: 'custom-agent'  // References .claude/agents/custom-agent.md
})
```

### Performance Optimization

- **Reduce agent intervals:** Lower `AGENT_CALL_INTERVAL` for faster execution (minimum 30 seconds recommended)
- **Parallel sites:** Future enhancement, not currently supported
- **Async operations:** Some MCP tools may support async batching
- **Cache MCP responses:** Workflow framework auto-caches identical calls

---

## Support & Resources

- **Workflow Source:** `.claude/workflows/daily-maintenance.js`
- **Agent Definitions:** `.claude/agents/*.md`
- **Configuration:** `.env` and workflow constants
- **Logs:** `log/maintenance_logs/*.json`
- **Email Helper:** `send_email.py`
- **Sites Loader:** `get_today_sites.py`

For issues:
1. Check troubleshooting section above
2. Review workflow transcript in Claude Code
3. Check individual site logs in `log/maintenance_logs/`
4. Verify `.env` and Google Sheets setup

---

**Document Version:** 1.0  
**Created:** 2026-08-05  
**Last Modified:** 2026-08-05 
**Status:** Production Ready

For questions or improvements, update this document and commit to the repository.
