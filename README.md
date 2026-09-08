# 🚀 SmartSites Maintenance Agent Setup

This guide walks through setting up the automated maintenance agent using Claude Code and your Google Sheet.

## ✅ What's Already Done

- ✅ Service account JSON file available: `maintenance-backups-1e58c79f6033.json`
- ✅ Environment configuration file created: `.env`
- ✅ Main maintenance script created: `maintenance.py`
- ✅ Setup verification script created: `verify_setup.py`

## 📋 Remaining Setup Steps

### Step 1: Share Your Google Sheet (Critical!)

Your service account email:
```
ss-maintenance-backup-test@maintenance-backups.iam.gserviceaccount.com
```

**To share your sheet:**
1. Open your Google Sheet: https://docs.google.com/spreadsheets/d/1ToMticvQWHAkQ8FU5c7uO2GLlvpjmG4ZAKMyQOdAB8A/edit
2. Click **Share** button (top right)
3. Paste the email above
4. Select **Editor** permissions
5. Uncheck "Notify people" (it's a service account, doesn't have inbox)
6. Click **Share**

### Step 2: Update Gmail App Password

The `.env` file has been set up with your Gmail. If you need to update the app password:

1. Go to: https://myaccount.google.com/apppasswords
2. Select: Mail + Windows (or just Mail)
3. Copy the 16-character password
4. Edit `.env` and update `SMTP_PASSWORD=`

**Important:** This must be an App Password, not your regular Gmail password.

### Step 3: Configure Additional Settings (Optional)

Edit `.env` to adjust if needed:
- `REPORT_EMAIL`: Where to send maintenance reports
- `BATCH_CHECK_INTERVAL`: How often to check batch status (seconds)
- `MAX_BATCH_WAIT`: Maximum time to wait for batch operations (seconds)

### Step 4: Verify Setup

Run the verification script:

```bash
python verify_setup.py
```

You should see:
```
✅ Service Account
✅ Environment
✅ Google Sheet Access
✅ Email
```

### Step 5: Test the Script

Before scheduling, test it manually:

```bash
python maintenance.py
```

Expected output:
```
🚀🚀🚀🚀🚀...
SmartSites Daily Maintenance Agent

============================================================
📅 Today is: Friday
============================================================

🔍 Fetching sites from 'Friday' tab...
✅ Found 5 sites for Friday

   1. https://example1.com
   2. https://example2.com
   ...

────────────────────────────────────────────────────────────
🔧 Processing 1/5: https://example1.com
   ID: 123 | Dev: John
────────────────────────────────────────────────────────────
  1️⃣ Health check...
     ✅
  ...
```

## 🎯 What Each Step Does

The maintenance agent performs these steps for each website:

1. **Health Check** - Verify site is responding
2. **Check Updates** - See what updates are available
3. **Update Plugins** - Apply all plugin updates
4. **Update WordPress Core** - Update WP to latest stable version
5. **Final Health Check** - Verify site still works
6. **Check External Updates** - Look for non-WP updates
7. **Sync to Sheet** - Update Google Sheet with status
8. **Send Email Report** - Report individual site results

Then sends a daily summary email with all results.

## 🔧 Configuration Files

### `.env` File
Contains all sensitive configuration. **Never commit this to Git.**

```
GOOGLE_SHEET_ID=...              # Your maintenance spreadsheet ID
SERVICE_ACCOUNT_JSON_PATH=...    # Path to service account JSON
SMTP_USER=...                    # Your Gmail address
SMTP_PASSWORD=...                # Gmail app password
REPORT_EMAIL=...                 # Where to send reports
```

### `.gitignore` File
Protects sensitive files from being committed:
- `.env` files
- `maintenance-backups-*.json`
- `__pycache__/`
- And more

## 📊 Your Google Sheet Structure

Your maintenance sheet should have these tabs:
- Sunday
- Monday
- Tuesday
- Wednesday
- Thursday
- Friday

Each tab should have these columns (A-I):
- **A**: URL (e.g., `https://example.com`)
- **B**: Site ID (from your MCP system)
- **C**: GLog Sheet (optional)
- **D**: Full API Key (optional)
- **E**: Readonly API Key (optional)
- **F**: API Base URL (optional)
- **G**: Test Pass (optional)
- **H**: Notes (optional)
- **I**: Dev Name (the person responsible)

The script reads the current day's tab and processes all sites listed there.

## 🚀 Scheduling Runs

### Option 1: Claude Code Built-in (If Available)

```bash
claude schedule "Daily Maintenance" --cron "0 6 * * *" --script maintenance.py
```

This schedules it to run daily at 6 AM (adjust time as needed).

### Option 2: GitHub Actions (Free, Always Available)

Create `.github/workflows/maintenance.yml`:

```yaml
name: Daily Maintenance
on:
  schedule:
    - cron: '0 6 * * *'  # 6 AM UTC daily
    
jobs:
  maintenance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.9'
      
      - name: Install dependencies
        run: pip install requests python-dotenv
      
      - name: Run maintenance
        run: python maintenance.py
        env:
          GOOGLE_SHEET_ID: ${{ secrets.GOOGLE_SHEET_ID }}
          SERVICE_ACCOUNT_JSON_PATH: ${{ secrets.SERVICE_ACCOUNT_JSON_PATH }}
          SMTP_USER: ${{ secrets.SMTP_USER }}
          SMTP_PASSWORD: ${{ secrets.SMTP_PASSWORD }}
          REPORT_EMAIL: ${{ secrets.REPORT_EMAIL }}
```

Then add GitHub Secrets in your repo settings with the values from `.env`.

### Option 3: Manual Runs

Just run it whenever you want:

```bash
python maintenance.py
```

## 🔐 Security Notes

⚠️ **Important Security Points:**

1. **Never commit `.env`** - It contains your Gmail password and API keys
2. **Use App Passwords** - Not your regular Gmail password
3. **Service Account is Read-Only** - It can only read from the sheet (you control permissions)
4. **GitHub Secrets** - If using GitHub Actions, store sensitive values in repo secrets
5. **Rotate Keys Regularly** - Consider regenerating app passwords monthly

## 🐛 Troubleshooting

### "Google Sheet not found"
- Check `GOOGLE_SHEET_ID` in `.env` is correct
- Make sure you've shared the sheet with the service account email
- Try opening the sheet in a browser to verify you can access it

### "Email failed: SMTPAuthenticationError"
- Make sure you're using an **App Password**, not your regular Gmail password
- Generate one at: https://myaccount.google.com/apppasswords
- Select "Mail + Windows" when generating

### "Sheet shared but still getting 403"
- Google Sheets API might not be enabled in your project
- Go to: https://console.cloud.google.com/apis/api/sheets.googleapis.com
- Click **Enable**

### "No sites found for Monday"
- Check the sheet tab name (must match day name exactly: "Monday", not "monday")
- Make sure column A has URLs
- Verify the tab isn't empty

### "Service account file not found"
- Make sure `maintenance-backups-1e58c79f6033.json` is in the project root
- Check `.env` has correct path: `./maintenance-backups-1e58c79f6033.json`

## ✅ Testing Checklist

Before scheduling automated runs:

- [ ] Shared Google Sheet with service account email
- [ ] Updated Gmail app password in `.env`
- [ ] Run `python verify_setup.py` and all checks pass
- [ ] Run `python maintenance.py` manually and it completes
- [ ] Check your email for the test report
- [ ] Verify the daily summary email format looks good
- [ ] `.gitignore` is set up (don't commit `.env` or JSON files)

## 📚 Additional Resources

- **Google Sheets API**: https://developers.google.com/sheets/api
- **Gmail App Passwords**: https://myaccount.google.com/apppasswords
- **Python SMTP**: https://docs.python.org/3/library/smtplib.html
- **Claude Code Guide**: Check `CLAUDE_CODE_QUICK_START.md`

## 🎉 Next Steps

1. **Share your Google Sheet** (see Step 1 above)
2. **Verify setup**: `python verify_setup.py`
3. **Test script**: `python maintenance.py`
4. **Schedule runs** (GitHub Actions or Claude Code)
5. **Monitor results** via email reports

---

**Questions?** Check the troubleshooting section or review the solution guide in `CLAUDE_CODE_SOLUTION.md`.

**Version:** 1.0  
**Last Updated:** 2024  
**Status:** Ready to deploy
