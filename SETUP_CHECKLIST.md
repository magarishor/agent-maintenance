# ✅ Setup Checklist - Quick Reference

## 🎯 What You Need to Do RIGHT NOW

### Step 1: Share Your Google Sheet ⚡ (5 minutes)

Copy this email:
```
ss-maintenance-backup-test@maintenance-backups.iam.gserviceaccount.com
```

Then:
1. Go to: https://docs.google.com/spreadsheets/d/1ToMticvQWHAkQ8FU5c7uO2GLlvpjmG4ZAKMyQOdAB8A/edit
2. Click **Share** (top right)
3. Paste the email above
4. Choose **Editor** permissions
5. Click **Share** (don't notify - it's a bot)

✅ **Done! Your sheet is now accessible to the maintenance agent**

---

### Step 2: Verify Your Gmail App Password ⚡ (2 minutes)

The `.env` file already has your email and password configured. But verify it's correct:

1. Go to: https://myaccount.google.com/apppasswords
2. Under "Select the app and device you want an app password for":
   - Select **Mail**
   - Select **Windows** (or your device)
3. Google will show you a 16-character password
4. **Copy it and verify it matches** `SMTP_PASSWORD=` in `.env`

If it doesn't match, update `.env` with the correct password.

✅ **Done! Email configuration is verified**

---

## 🧪 Test Before Automating

### Run Verification

```bash
python verify_setup.py
```

Should see:
```
✅ Service Account
✅ Environment
✅ Google Sheet Access
✅ Email
```

### Run the Script

```bash
python maintenance.py
```

You should see sites being processed and get an email report.

✅ **Done! Script works**

---

## 🚀 Schedule It (Choose One)

### Option A: GitHub Actions (Recommended - Free)

Create `.github/workflows/maintenance.yml` with the content from `README.md` section "Scheduling Runs → Option 2"

Then add GitHub Secrets with your environment values.

### Option B: Claude Code Built-in

```bash
claude schedule "Daily Maintenance" --cron "0 6 * * *" --script maintenance.py
```

(Runs daily at 6 AM)

✅ **Done! Automation is running**

---

## 📋 File Structure

After setup, your folder should look like:

```
agent-maintenance/
├── .env                              ← Configuration (NEVER commit)
├── .gitignore                        ← Protects secrets
├── maintenance-backups-*.json        ← Service account (NEVER commit)
├── maintenance.py                    ← Main script
├── verify_setup.py                   ← Verification tool
├── README.md                         ← Full guide
├── SETUP_CHECKLIST.md               ← This file
├── CLAUDE_CODE_QUICK_START.md       ← Quick start guide
├── CLAUDE_CODE_SOLUTION.md          ← Detailed solution
└── .github/workflows/
    └── maintenance.yml              ← GitHub Actions (optional)
```

---

## 🚨 Important Notes

### Don't Commit These Files!
```
❌ .env                         (has your passwords!)
❌ maintenance-backups-*.json   (has service account private key!)
```

These are in `.gitignore` already, but double-check.

### The Sheet Must Be Shared
Without sharing, the script gets 403 Forbidden. Make sure you've completed Step 1.

### Use App Passwords Only
Don't use your regular Gmail password. Must be an App Password from:
https://myaccount.google.com/apppasswords

---

## 🎉 You're All Set!

Once you've completed Steps 1 & 2 and run verification, the automated maintenance will:

- 📅 Run on your schedule (daily at 6 AM or whenever you set it)
- 📖 Read your Google Sheet for today's sites
- 🔧 Perform maintenance on each site
- 📧 Send you detailed reports
- 💾 Update your sheet with results

---

## ❓ Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| "403 Forbidden" | Sheet not shared with service account email |
| "Auth failed" | Gmail app password incorrect or not shared |
| "No sites found" | Check sheet tab name matches day (e.g., "Monday") |
| "File not found" | Service account JSON missing or path wrong |

See `README.md` for detailed troubleshooting.

---

**Status:** Ready to deploy! 🚀
