# ⚡ Claude Code Workflow - Quick Start

## 🎯 What You Have

A fully configured Claude Code workflow that:
- ✅ Reads today's sites from Google Sheet
- ✅ Processes each site ONE AT A TIME
- ✅ Monitors batch jobs every 1 minute
- ✅ Sends email reports at each stage
- ✅ Syncs everything to Google Sheet
- ✅ Schedules automatically via Claude Code

---

## 🚀 Quick Setup (5 minutes)

### 1. Test the Helper Script

```bash
python get_today_sites.py
```

Should show today's sites in JSON format. ✅

### 2. Test the Workflow (Manual)

```bash
claude run .claude/workflows/daily-maintenance.js
```

Watch it process sites. Should take a few hours depending on updates.

### 3. Schedule It

```bash
claude schedule "Daily Maintenance" --cron "0 6 * * *" --workflow daily-maintenance
```

*Changes time:*
- 6 AM EST: `0 11 * * *`
- 6 AM PST: `0 14 * * *`
- 12 PM: `0 12 * * *`

### Done! ✅

The workflow will now run automatically every day at your scheduled time.

---

## 📋 What Happens Each Run

For each site:

```
1️⃣ Health Check
   ↓
2️⃣ Check Updates
   ↓
3️⃣ Update Plugins (batch job)
   ├─ Monitor every 1 minute until complete
   ├─ Send email report
   ↓
4️⃣ Update WordPress Core (if available, batch job)
   ├─ Monitor every 1 minute until complete
   ↓
5️⃣ Final Health Check
   ↓
6️⃣ Check External Updates
   ↓
7️⃣ Sync to Google Sheet
   ↓
8️⃣ Send Final Email Report
   ↓
Next site...

After all sites → Send Daily Summary Email
```

---

## 📧 Emails Sent

**Per Site:**
1. 📧 Plugin update report (after plugin batch completes)
2. 📧 Final maintenance report (after everything completes)

**Daily:**
3. 📧 Daily summary (after all sites complete)

All emails go to: `REPORT_EMAIL` in `.env` (currently: `frontend@smartsites.com`)

---

## ⏱️ Timing

**Per site (roughly):**
- No updates: 30 seconds
- Plugin updates only: 10-15 minutes
- Plugin + Core updates: 15-25 minutes

**Example with 16 sites:**
- If 50% have updates: ~2-3 hours total

**Batch monitoring:**
- Checks every 1 minute
- Waits up to 1 hour per batch
- Moves to next step once complete

---

## 🔍 Monitor the Workflow

### See Logs

```bash
claude logs daily-maintenance
```

### List Scheduled Workflows

```bash
claude schedule --list
```

### Manual Test Before Scheduling

```bash
claude run .claude/workflows/daily-maintenance.js
```

---

## 🐛 Troubleshooting

| Issue | Fix |
|-------|-----|
| Sites not loading | Run: `python get_today_sites.py` |
| Emails not sending | Run: `python verify_setup.py` |
| Workflow not found | Check `.claude/workflows/daily-maintenance.js` exists |
| Schedule not working | Re-run: `claude schedule "Daily Maintenance" --cron "0 6 * * *" --workflow daily-maintenance` |

---

## 📁 Files

```
.claude/workflows/
└── daily-maintenance.js     ← The main workflow

get_today_sites.py           ← Helper to fetch sites from sheet

.env                         ← Configuration (already set up)

CLAUDE_CODE_WORKFLOW_SETUP.md     ← Full documentation
WORKFLOW_QUICK_START.md           ← This file
```

---

## ✅ You're Ready!

```bash
# 1. Test it
claude run .claude/workflows/daily-maintenance.js

# 2. Schedule it
claude schedule "Daily Maintenance" --cron "0 6 * * *" --workflow daily-maintenance

# 3. Enjoy!
```

That's it! The workflow will now run automatically every day.

---

**Questions?** See `CLAUDE_CODE_WORKFLOW_SETUP.md` for detailed documentation.
