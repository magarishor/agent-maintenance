# 🚀 Claude Code Daily Maintenance Workflow - Complete Setup Guide

This guide walks you through setting up the advanced Claude Code workflow that orchestrates full maintenance for all your websites using MCP tools.

---

## 📋 What This Workflow Does

### For Each Site (One at a Time):
1. ✅ **Health Check** - Verify site health
2. ✅ **Check Updates** - Find available plugin and core updates
3. ✅ **Update Plugins** - Apply all plugin updates with backup
4. ✅ **Monitor Plugin Batch** - Check every 1 minute until complete
5. ✅ **Email Plugin Report** - Send update completion report
6. ✅ **Update WordPress Core** - Update if available
7. ✅ **Monitor Core Batch** - Check every 1 minute until complete
8. ✅ **Final Health Check** - Verify site still works
9. ✅ **Check External Updates** - Look for non-WordPress updates
10. ✅ **Sync to Sheet** - Update Google Sheet with all logs
11. ✅ **Send Final Report** - Email detailed maintenance summary

### After All Sites:
- ✅ Send daily completion email with all sites status

---

## 🔧 Files Created

```
agent-maintenance/
├── .claude/workflows/
│   └── daily-maintenance.js          ← Main Claude Code workflow
├── get_today_sites.py                ← Helper to fetch sites from sheet
├── .env                              ← Configuration (already set up)
└── ...other files
```

---

## 📝 Setup Steps

### Step 1: Verify File Structure ✓

The workflow file should be at:
```
c:\Users\SmartSites-Bidur\Documents\AI-All\agent-maintenance\.claude\workflows\daily-maintenance.js
```

Check that the `.claude/workflows/` directory exists. If not:
```bash
mkdir -p .claude/workflows
```

### Step 2: Verify Python Helper Script ✓

The `get_today_sites.py` should be in your project root directory. This helps the workflow fetch today's sites from Google Sheet.

### Step 3: Test the Helper Script

```bash
python get_today_sites.py
```

Should output JSON with today's sites:
```json
{
  "day": "Sunday",
  "date": "2024-...",
  "total_sites": 16,
  "sites": [
    {
      "url": "https://example.com",
      "site_id": "123",
      ...
    }
  ]
}
```

---

## 🎯 Running the Workflow

### Manual Test Run

```bash
claude run .claude/workflows/daily-maintenance.js
```

Or from Claude.ai directly:
```
Run the daily-maintenance workflow
```

**What you'll see:**
- Workflow loading today's sites
- Processing each site sequentially
- Progress updates for each step
- Email reports being sent
- Final summary

---

## ⏰ Schedule Daily Runs

### Option: Claude Code Scheduler

Schedule the workflow to run daily at 6 AM UTC:

```bash
claude schedule "Daily Maintenance" --cron "0 6 * * *" --workflow daily-maintenance
```

Or at your preferred time:
- **6 AM UTC**: `0 6 * * *`
- **6 AM EST**: `0 11 * * *`
- **6 AM PST**: `0 14 * * *`
- **12 PM UTC**: `0 12 * * *`

To see scheduled workflows:
```bash
claude schedule --list
```

To stop a scheduled workflow:
```bash
claude schedule --delete "Daily Maintenance"
```

---

## 🔑 How the Workflow Works

### 1. Phase 1: Setup
- Calls `get_today_sites.py` to get today's sites from Google Sheet
- Verifies sites were found
- Initializes results tracking

### 2. Phase 2: Maintenance
- **For each site sequentially** (one at a time):
  
  **Step 1:** Initial health-check-tool
  - Verifies site is responding
  - Checks plugin health
  - Checks API health
  
  **Step 2:** check-updates-tool
  - See what plugins need updates
  - Check if WordPress core update available
  
  **Step 3:** update-all-plugins-tool
  - Creates a batch job for plugin updates
  - Gets batch_id for monitoring
  
  **Step 3a:** Batch Monitoring Loop
  - Calls check-batch-status-tool every 1 minute
  - Waits for status: success/failed/cancelled
  - Timeout after 1 hour
  
  **Step 3b:** Send Plugin Report Email
  - Email with plugin update results
  
  **Step 4:** update-core-tool (if updates available)
  - Updates WordPress core
  - Creates batch job
  
  **Step 4a:** Core Batch Monitoring Loop
  - Same as plugin monitoring
  - Every 1 minute until complete
  
  **Step 5:** Final health-check-tool
  - Verify site still works after updates
  
  **Step 6:** check-external-updates-tool
  - Check for non-WordPress updates
  
  **Step 7:** sync-sheets-tool
  - Update Google Sheet with all results
  - Syncs plugin logs, core logs, health status
  
  **Step 8:** Send Final Report Email
  - Comprehensive email with complete maintenance history
  
  Then repeats for next site in list

### 3. Phase 3: Summary
- Sends daily summary email
- Reports all sites status
- Shows success rate

---

## 📧 Email Configuration

The workflow sends emails at these points:

1. **Plugin Update Report** (after plugin batch completes)
   - Sent to: `REPORT_EMAIL` (from .env)
   - Contains: Plugin update status and results

2. **Final Site Report** (after all steps for site complete)
   - Sent to: `REPORT_EMAIL`
   - Contains: Complete maintenance history for that site

3. **Daily Summary** (after all sites processed)
   - Sent to: `REPORT_EMAIL`
   - Contains: Summary of all sites and success rate

**Email Recipient:**
The workflow uses `REPORT_EMAIL` from your `.env` file (currently: `frontend@smartsites.com`)

To change:
```bash
# Edit .env
REPORT_EMAIL=your-email@example.com
```

---

## 🐛 Monitoring Batch Jobs

The workflow monitors batch jobs every **1 minute** for up to **1 hour**.

This means:
- Plugin updates: Checked every 60 seconds until complete
- WordPress core updates: Checked every 60 seconds until complete
- Site won't move to next step until batch completes

**Possible batch statuses:**
- `pending` - Job queued, not started
- `processing` - Currently running
- `success` - Completed successfully
- `failed` - Failed (site may need manual intervention)
- `cancelled` - Cancelled by user or system
- `timeout` - Took longer than 1 hour (workflow will timeout)

---

## 🔍 Troubleshooting

### Workflow fails at "Load Sites"

**Problem:** Can't fetch sites from Google Sheet

**Solutions:**
1. Run `python get_today_sites.py` manually to test
2. Check `.env` has valid `GOOGLE_SHEET_ID` and `GOOGLE_API_KEY`
3. Verify Google Sheet is shared with service account
4. Run `python verify_setup.py` to diagnose

### Workflow times out waiting for batch

**Problem:** Batch job taking too long (over 1 hour)

**Possible causes:**
- Large number of plugin updates
- Server performance issues
- Network connectivity problems

**Solutions:**
1. Check server logs for errors
2. Run fewer updates at once (update manually if needed)
3. Increase `MAX_BATCH_WAIT` in workflow (advanced)

### Emails not sending

**Problem:** Workflow runs but emails not received

**Solutions:**
1. Check `REPORT_EMAIL` in `.env` is correct
2. Verify Gmail password is an App Password (not regular password)
3. Run `python verify_setup.py` to test email
4. Check spam folder for emails

### MCP tools not found

**Problem:** Workflow says tools not available

**Solutions:**
1. Verify SmartSites MCP is connected to Claude.ai
2. In Claude Code, type: "What MCP tools are available?"
3. Confirm you have the 18 tools listed in available tools

---

## 📊 Example Output

When the workflow runs, you'll see:

```
📅 Loading today's maintenance sites from Google Sheet...
✅ Found 16 sites for Sunday

🔧 [1/16] Processing: https://example1.com
  1️⃣ Running health check...
  ✅ Health: healthy
  2️⃣ Checking for available updates...
  ✅ Found 3 plugin updates, Core: Yes
  3️⃣ Updating all plugins (3)...
  📦 Plugin batch job created: batch_abc123
  ⏳ Monitoring plugin batch status...
  ⏱️  Waiting 1 minute before batch check #1...
  📊 Batch #1: processing (30%)
  ⏱️  Waiting 1 minute before batch check #2...
  📊 Batch #2: success (100%)
  ✅ Plugin batch SUCCESS
  📧 Sending plugin update report email...
  ✅ Plugin report email sent
  4️⃣ Updating WordPress core to 6.4.2...
  📦 Core batch job created: batch_def456
  ⏳ Monitoring core update batch status...
  ⏱️  Waiting 1 minute before batch check #1...
  📊 Core batch #1: processing (50%)
  ⏱️  Waiting 1 minute before batch check #2...
  📊 Core batch #2: success (100%)
  ✅ Core batch SUCCESS
  5️⃣ Running final health check...
  ✅ Final Health: healthy
  6️⃣ Checking for external updates...
  ✅ External updates checked
  7️⃣ Syncing results to Google Sheet...
  ✅ Sheet synchronized
  8️⃣ Sending final site maintenance report...
  ✅ Final report email sent
✅ [1/16] https://example1.com - COMPLETED

[... continues for sites 2-16 ...]

📊 Daily maintenance completed for Sunday
   Total Sites: 16
   Completed: 16
   Failed: 0
   Success Rate: 100.0%
✅ Daily summary email sent
```

---

## 🎯 Performance Notes

**Processing Time:**
- Per site (no updates): ~30 seconds
- Per site (with plugin updates): ~10-15 minutes (depends on batch time)
- Per site (with core update): ~15-25 minutes (depends on batch time)
- 16 sites (sequential): ~3-5 hours total

**Example:**
- 16 sites × ~10 min average = ~160 minutes (~2.5 hours)

The workflow processes **one site at a time** to ensure each completes before moving to the next.

---

## 🔐 Security & Best Practices

1. **Never commit `.env`** - Contains passwords and API keys ✓ (Already in .gitignore)
2. **Use App Passwords** - Not your regular Gmail password ✓
3. **Rotate credentials regularly** - Change app passwords monthly
4. **Monitor batch jobs** - Check logs if batches fail
5. **Backup before updates** - Workflow does this automatically

---

## 📚 Reference

### MCP Tools Used:
- `health-check-tool` - Initial and final health checks
- `check-updates-tool` - Find available updates
- `update-all-plugins-tool` - Update plugins with backup
- `update-core-tool` - Update WordPress core
- `check-batch-status-tool` - Monitor batch jobs
- `check-external-updates-tool` - Check non-WordPress updates
- `sync-sheets-tool` - Sync results to Google Sheet

### Environment Variables:
```env
GOOGLE_SHEET_ID=...           # Your maintenance sheet
GOOGLE_API_KEY=...            # Google API key
SMTP_USER=...                 # Gmail address
SMTP_PASSWORD=...             # Gmail app password
REPORT_EMAIL=...              # Where to send reports
```

---

## ✅ Testing Checklist

Before scheduling automated runs:

- [ ] Created `.claude/workflows/daily-maintenance.js`
- [ ] `get_today_sites.py` works: `python get_today_sites.py`
- [ ] Can run workflow manually: `claude run .claude/workflows/daily-maintenance.js`
- [ ] All MCP tools available in Claude Code
- [ ] `.env` configured with all settings
- [ ] Test workflow completes successfully
- [ ] Received all expected emails
- [ ] Google Sheet updated with results

---

## 🚀 Launch Commands

```bash
# Test run
claude run .claude/workflows/daily-maintenance.js

# Schedule daily at 6 AM UTC
claude schedule "Daily Maintenance" --cron "0 6 * * *" --workflow daily-maintenance

# List scheduled workflows
claude schedule --list

# Delete scheduled workflow
claude schedule --delete "Daily Maintenance"
```

---

## 💡 Advanced Tips

### Change Monitoring Interval

Edit `.claude/workflows/daily-maintenance.js`:
```javascript
const BATCH_CHECK_INTERVAL = 60_000  // 1 minute (change to 120_000 for 2 minutes)
const MAX_BATCH_WAIT = 3600_000      // 1 hour (change to 7200_000 for 2 hours)
```

### Skip Sites Without Updates

The workflow automatically skips plugin/core updates if none available.

### Partial Failure Handling

If one site fails:
- Workflow logs the error
- Continues to next site
- Final summary shows which sites failed

---

## 📞 Support

**If something breaks:**

1. Run `python verify_setup.py` to check configuration
2. Check workflow logs: `claude logs daily-maintenance`
3. Run workflow manually to see exact error: `claude run .claude/workflows/daily-maintenance.js`
4. Check email settings: `python maintenance.py` (manual test)

---

**You're ready to deploy! 🎉**

The workflow is fully configured and ready to schedule. Once you run the first test successfully, schedule it with Claude Code and enjoy automated maintenance!

---

**Version:** 1.0  
**Last Updated:** 2024  
**Status:** Production Ready
