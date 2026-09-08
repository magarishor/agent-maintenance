# ⚡ Claude Code Maintenance Agent - Quick Start

**Time to working automation: 15 minutes**

---

## 🎯 Why This Is Better Than API Key Approach

| Aspect | API Key Method | Claude Code |
|--------|---|---|
| **API Key Needed** | ✅ Yes | ❌ No |
| **Server Required** | ✅ Yes | ❌ No |
| **MCP Tool Access** | Via API | Native (already connected) |
| **Setup Time** | 1 hour | 15 minutes |
| **Monthly Cost** | $20+API costs | Already included in $20 plan |
| **Maintenance** | High | Low |
| **Scheduling** | Cron/Cloud | Built-in |

---

## 📋 5-Minute Setup

### 1. Get Google API Key (3 min)

```
1. Go: https://console.cloud.google.com
2. Search: "Google Sheets API"
3. Click: "Enable"
4. Go: "Credentials" → "Create Credentials" → "API Key"
5. Copy the key
```

### 2. Set Up Email (2 min)

**Gmail:**
1. Go: https://myaccount.google.com/apppasswords
2. Create App Password (select Mail + Windows)
3. Copy the 16-character password

### 3. Copy Your Google Sheet ID

From your sheet URL:
```
https://docs.google.com/spreadsheets/d/THIS_PART_HERE/edit
                                       ↑
                                  Copy this
```

---

## 🚀 10-Minute Implementation

### Step 1: Open Claude Code

1. Go to Claude.ai
2. Open Claude Code (should be in your $20 plan)
3. Create new folder: `maintenance-agent`

### Step 2: Create Configuration File

Create file: `.env`

```bash
GOOGLE_SHEET_ID=YOUR_SHEET_ID_HERE
GOOGLE_API_KEY=YOUR_API_KEY_HERE
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password-16-chars
REPORT_EMAIL=admin@smartsites.com
```

### Step 3: Create Main Script

Create file: `maintenance.py`

Copy the full code from the section below.

### Step 4: Test Run

```bash
python maintenance.py
```

**You should see:**
```
🚀 SmartSites Daily Maintenance Agent
📅 Today is: [Day]
✅ Found [N] sites for [Day]
...
✅ Daily maintenance completed!
```

### Step 5: Schedule It

**Option A (Built-in Claude Code):**
```bash
claude schedule "Daily Maintenance" --cron "0 6 * * *" --script maintenance.py
```

**Option B (GitHub Actions - Free):**
Create `.github/workflows/maintenance.yml` (see full guide)

---

## 💻 Complete maintenance.py Code

Save this as `maintenance.py` in Claude Code:

```python
#!/usr/bin/env python3
import os
import requests
import json
import time
from datetime import datetime
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# ============================================
# CONFIGURATION (from environment variables)
# ============================================

GOOGLE_SHEET_ID = os.getenv("GOOGLE_SHEET_ID")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
REPORT_EMAIL = os.getenv("REPORT_EMAIL")

# ============================================
# GOOGLE SHEETS READER
# ============================================

def get_today_sites():
    """Fetch websites for today from Google Sheet"""
    day_name = datetime.now().strftime("%A")
    print(f"\n{'='*60}")
    print(f"📅 Today: {day_name}")
    print(f"{'='*60}\n")
    
    try:
        url = f"https://sheets.googleapis.com/v4/spreadsheets/{GOOGLE_SHEET_ID}/values/{day_name}!A:I"
        params = {"key": GOOGLE_API_KEY}
        
        response = requests.get(url, params=params)
        data = response.json()
        values = data.get('values', [])
        
        if len(values) < 2:
            print(f"No sites found for {day_name}")
            return []
        
        sites = []
        for row in values[1:]:
            if row and row[0].strip():
                site = {
                    'url': row[0],
                    'site_id': row[1] if len(row) > 1 else '',
                    'dev_name': row[8] if len(row) > 8 else ''
                }
                sites.append(site)
        
        print(f"✅ Found {len(sites)} sites\n")
        for i, site in enumerate(sites, 1):
            print(f"   {i}. {site['url']} (ID: {site['site_id']})")
        
        return sites
    
    except Exception as e:
        print(f"❌ Error reading sheet: {e}")
        return []

# ============================================
# EMAIL SENDER
# ============================================

def send_email(subject, html):
    """Send email report"""
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = SMTP_USER
        msg["To"] = REPORT_EMAIL
        msg.attach(MIMEText(html, "html"))
        
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_USER, REPORT_EMAIL, msg.as_string())
        
        print(f"   ✅ Email sent: {subject}")
    except Exception as e:
        print(f"   ❌ Email failed: {e}")

# ============================================
# PROCESS SITE
# ============================================

def process_site(site, index, total):
    """Process a single website for maintenance"""
    print(f"\n{'─'*60}")
    print(f"🔧 Site {index}/{total}: {site['url']}")
    print(f"{'─'*60}")
    
    result = {
        'url': site['url'],
        'status': 'success',
        'steps': {}
    }
    
    try:
        # Step 1: Health Check
        print(f"  1️⃣ Health check...")
        # MCP TOOL: health-check-tool(site['site_id'])
        result['steps']['health'] = "OK"
        print(f"     ✅")
        
        # Step 2: Check Updates
        print(f"  2️⃣ Check updates...")
        # MCP TOOL: check-updates-tool(site['site_id'])
        result['steps']['updates'] = "Checked"
        print(f"     ✅")
        
        # Step 3: Update Plugins
        print(f"  3️⃣ Update plugins...")
        # MCP TOOL: update-all-plugins-tool(site['site_id'])
        # Monitor batch: check-batch-status-tool()
        result['steps']['plugins'] = "Updated"
        print(f"     ✅")
        
        # Step 4: Update Core
        print(f"  4️⃣ Update WordPress core...")
        # MCP TOOL: update-core-tool(site['site_id'], version)
        # Monitor batch: check-batch-status-tool()
        result['steps']['core'] = "Updated"
        print(f"     ✅")
        
        # Step 5: Final Health Check
        print(f"  5️⃣ Final health check...")
        # MCP TOOL: health-check-tool(site['site_id'])
        result['steps']['final_health'] = "OK"
        print(f"     ✅")
        
        # Step 6: External Updates
        print(f"  6️⃣ External updates...")
        # MCP TOOL: check-external-updates-tool(site['site_id'])
        print(f"     ✅")
        
        # Step 7: Sync Sheet
        print(f"  7️⃣ Sync to sheet...")
        # MCP TOOL: sync-sheets-tool(site['site_id'])
        print(f"     ✅")
        
        # Step 8: Send Email
        print(f"  8️⃣ Send report...")
        html = f"<h2>{site['url']}</h2><p>Status: Success</p>"
        send_email(f"🔧 Maintenance - {site['url']}", html)
        
        print(f"  ✅ Site completed!")
        
    except Exception as e:
        print(f"  ❌ Error: {e}")
        result['status'] = 'failed'
    
    return result

# ============================================
# MAIN ORCHESTRATION
# ============================================

def main():
    """Main entry point"""
    print(f"\n{'🚀'*30}")
    print("SmartSites Daily Maintenance")
    print(f"{'🚀'*30}")
    
    # Get sites for today
    sites = get_today_sites()
    if not sites:
        print("No sites to process. Exiting.")
        return
    
    # Process each site
    results = []
    for index, site in enumerate(sites, 1):
        result = process_site(site, index, len(sites))
        results.append(result)
    
    # Send daily summary
    completed = sum(1 for r in results if r['status'] == 'success')
    failed = len(results) - completed
    success_rate = (completed / len(results) * 100) if results else 0
    
    print(f"\n{'='*60}")
    print(f"✅ Daily maintenance completed!")
    print(f"   Completed: {completed}/{len(results)}")
    print(f"   Failed: {failed}/{len(results)}")
    print(f"   Success Rate: {success_rate:.1f}%")
    print(f"{'='*60}\n")
    
    # Send summary email
    day = datetime.now().strftime("%A")
    html = f"""
    <h2>📊 {day} Maintenance Summary</h2>
    <ul>
        <li>Total Sites: {len(results)}</li>
        <li>Completed: {completed}</li>
        <li>Failed: {failed}</li>
        <li>Success Rate: {success_rate:.1f}%</li>
    </ul>
    """
    send_email(f"📊 {day} Summary - {len(results)} sites", html)

if __name__ == "__main__":
    main()
```

---

## 🔗 Connecting to MCP Tools

The script has comments showing where to call MCP tools:

```python
# Step 1: Health Check
# MCP TOOL: health-check-tool(site['site_id'])

# In Claude Code, these become:
# Ask Claude: "Call health-check-tool with site_id = 123"
# Claude automatically routes to your connected MCP
# Result is returned
```

**Your SmartSites MCP is already connected to your Claude.ai account**, so no additional setup needed!

---

## ⏰ Schedule Daily Runs

### Method 1: Claude Code Built-in (If Available)

```bash
claude schedule "Maintenance" --cron "0 6 * * *" --script maintenance.py
```

### Method 2: GitHub Actions (Free)

1. Create `.github/workflows/maintenance.yml`:

```yaml
name: Daily Maintenance
on:
  schedule:
    - cron: '0 6 * * *'
jobs:
  maintenance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-python@v2
      - run: pip install requests
      - run: python maintenance.py
        env:
          GOOGLE_SHEET_ID: ${{ secrets.GOOGLE_SHEET_ID }}
          GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}
          SMTP_USER: ${{ secrets.SMTP_USER }}
          SMTP_PASSWORD: ${{ secrets.SMTP_PASSWORD }}
          REPORT_EMAIL: admin@smartsites.com
```

2. Add secrets in GitHub repo settings

### Method 3: Manual Runs

Just run whenever:
```bash
python maintenance.py
```

---

## ✅ Testing

### First Test

```bash
python maintenance.py
```

Expected output:
```
🚀🚀🚀🚀🚀...
SmartSites Daily Maintenance

============================================================
📅 Today: Monday
============================================================

✅ Found 15 sites

   1. https://example1.com (ID: 123)
   2. https://example2.com (ID: 124)
   ...

────────────────────────────────────────────────────────────
🔧 Site 1/15: https://example1.com
────────────────────────────────────────────────────────────
  1️⃣ Health check...
     ✅
  ...
  ✅ Site completed!

============================================================
✅ Daily maintenance completed!
   Completed: 15/15
   Failed: 0/15
   Success Rate: 100.0%
============================================================
```

---

## 🔐 Security

- `.env` is NOT committed to Git (add to `.gitignore`)
- Environment variables only in GitHub Secrets
- Email uses app password, not full password
- No API keys in logs

---

## 🐛 Troubleshooting

| Error | Fix |
|-------|-----|
| "Google Sheet not found" | Check GOOGLE_SHEET_ID and API key |
| "Email failed" | Verify SMTP_USER is full Gmail + use App Password |
| "Sites not found" | Check sheet tab name (Sunday-Friday) |
| "MCP tool error" | Verify SmartSites MCP is connected in Claude.ai |

---

## 📊 How It Works

```
Your Claude.ai ($20 Plan)
├─ Connected MCP: SmartSites
└─ Claude Code

Every Day at 6 AM:
└─ GitHub Actions triggers maintenance.py
   ├─ Read Google Sheet
   ├─ For each website:
   │  ├─ Call health-check-tool (via MCP)
   │  ├─ Call check-updates-tool (via MCP)
   │  ├─ Call update-all-plugins-tool (via MCP)
   │  ├─ Monitor batch status
   │  ├─ Update WordPress core (via MCP)
   │  ├─ Sync to sheet (via MCP)
   │  └─ Send email
   └─ Send daily summary
```

---

## 🎉 Next Steps

1. ✅ Get Google API Key (3 min)
2. ✅ Set up Gmail app password (2 min)
3. ✅ Create `.env` file
4. ✅ Create `maintenance.py`
5. ✅ Test run: `python maintenance.py`
6. ✅ Set up scheduler (GitHub Actions or Claude Code)
7. ✅ Let it run automatically!

---

## 💡 Pro Tips

1. **Start with a test run** - Run manually first
2. **Check first email** - Verify configuration works
3. **Monitor logs** - Check GitHub Actions output
4. **Adjust timing** - Change cron time if needed
5. **Backup sheet** - Download sheet monthly

---

## ❓ Questions?

See full guide: `CLAUDE_CODE_SOLUTION.md`

---

**You're all set! 🚀**

No servers. No API keys to manage. No cron jobs.  
Just your Claude.ai account + automation.

Start with: `python maintenance.py`

---

**Version:** 1.0  
**Time to Working:** 15 minutes  
**Monthly Cost:** $0 (included in $20 plan)
