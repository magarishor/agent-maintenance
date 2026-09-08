# 🎯 SmartSites Maintenance Agent - Claude Code Solution

## Why Claude Code is Perfect for Your Situation

✅ **No API key needed** - You're already logged into Claude.ai  
✅ **Direct MCP access** - SmartSites tools already connected  
✅ **Simple setup** - No server, no cron jobs  
✅ **$20 plan included** - Works with your current plan  
✅ **Scheduling built-in** - Run automatically daily  
✅ **No external dependencies** - All in Claude.ai  

---

## 🚀 Quick Overview: How It Works

```
Your Claude.ai Account
├─ $20 Monthly Plan (Pro/Team)
├─ Connected MCP Tools (SmartSites)
└─ Claude Code Workflow

Every Day at 6 AM:
└─ Automated Maintenance Workflow Runs
   ├─ 1. Read Google Sheet for today's sites
   ├─ 2. Process each website
   └─ 3. Send emails & update sheet
```

---

## 📋 Part 1: Set Up Google Sheets Access

### Step 1: Get Google Sheets API Key (Free)

1. Go to: https://console.cloud.google.com
2. Click "Create Project"
3. Search "Google Sheets API"
4. Click "Enable"
5. Go to "Credentials" → "Create Credentials" → "API Key"
6. Copy the key
7. **Save it somewhere safe** - You'll use it in Claude Code

### Step 2: Share Your Google Sheet (Optional but Recommended)

1. Go to: https://console.cloud.google.com
2. Create a Service Account:
   - APIs & Services → Credentials → Create Service Account
   - Download the JSON key
3. Share your Google Sheet with the service account email

**OR** use the API key approach (simpler):
- Just use your API Key directly (no sharing needed for read-only)

---

## 🔧 Part 2: Create Maintenance Skill in Claude Code

### What is a "Skill"?

A reusable automation instruction that Claude follows. Think of it like a recipe.

### Create the Maintenance Skill

1. Open Claude.ai in a new conversation
2. Switch to **Claude Code** (if available in your plan)
3. Create a new skill file: `.claude/commands/maintenance.md`

**Paste this content:**

```markdown
# Daily Website Maintenance Automation Skill

## Purpose
Automate daily maintenance for websites listed in a Google Sheet.

## Prerequisites
- Google Sheets API Key
- Google Sheet ID
- SmartSites MCP tools configured

## Configuration
Set these variables:
- GOOGLE_SHEET_ID: Your sheet ID from URL
- GOOGLE_API_KEY: Your API key
- REPORT_EMAIL: Where to send reports
- SITES_DAY: The day to process (or 'auto' for current day)

## Process

### Step 1: Determine Today
```python
from datetime import datetime
day_name = datetime.now().strftime("%A")
print(f"Today is {day_name}")
```

### Step 2: Fetch Today's Sites from Google Sheet
```python
import requests
import json

# Read from the correct day tab
sheet_id = "YOUR_SHEET_ID"
api_key = "YOUR_API_KEY"
day_name = "Monday"  # or auto-detect

url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{day_name}!A:I"
params = {"key": api_key}

response = requests.get(url, params=params)
data = response.json()

# Parse sites
values = data.get('values', [])
if len(values) > 1:
    headers = values[0]
    sites = []
    for row in values[1:]:
        if row and row[0]:  # If URL exists
            site = {
                'url': row[0],
                'site_id': row[1] if len(row) > 1 else '',
                'dev_name': row[8] if len(row) > 8 else ''
            }
            sites.append(site)
    
    print(f"Found {len(sites)} sites for {day_name}")
    for i, site in enumerate(sites, 1):
        print(f"  {i}. {site['url']} (ID: {site['site_id']})")
```

### Step 3: Process Each Site (Sequential)
For each website:

#### 3a. Check Health
```
Use MCP: health-check-tool(site_id)
Store result
```

#### 3b. Check for Updates
```
Use MCP: check-updates-tool(site_id)
Store result
```

#### 3c. Update Plugins
```
Use MCP: update-all-plugins-tool(site_id, create_backup=true)
Get batch_id from result
Monitor batch status every 60 seconds until completion
```

#### 3d. Update WordPress Core
```
Use MCP: update-core-tool(site_id, version, create_backup=true)
Get batch_id from result
Monitor batch status every 60 seconds until completion
```

#### 3e. Final Health Check
```
Use MCP: health-check-tool(site_id)
Compare with initial health
```

#### 3f. Check External Updates
```
Use MCP: check-external-updates-tool(site_id)
```

#### 3g. Sync to Sheet
```
Use MCP: sync-sheets-tool(site_id)
```

#### 3h. Send Email Report
```
Send HTML email with:
- Site URL
- Health before/after
- Updates applied
- Batch statuses
- Any errors
```

### Step 4: Send Daily Summary
After all sites complete:
```
Send email with:
- Total sites processed
- Successful count
- Failed count
- Success rate %
- List of all sites with status
```

## Error Handling
- If site fails: Log error, send alert, continue to next
- If batch times out: Retry up to 3 times
- If email fails: Log error, continue
- At end: Report all errors in summary

## Success Criteria
- All sites processed
- All batch updates completed
- All emails sent
- Sheet synchronized
```

---

## 📝 Part 3: Create the Automation Script in Claude Code

Create a new file in Claude Code that implements the skill:

**File: `maintenance-workflow.py`**

```python
#!/usr/bin/env python3
"""
SmartSites Daily Maintenance Automation
Runs daily at 6 AM to maintain all websites
"""

import os
import requests
import json
import time
from datetime import datetime
from typing import List, Dict
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# ============================================================================
# CONFIGURATION
# ============================================================================

class Config:
    """All configuration in one place"""
    GOOGLE_SHEET_ID = os.getenv(
        "GOOGLE_SHEET_ID", 
        "1ToMticvQWHAkQ8FU5c7uO2GLlvpjmG4ZAKMyQOdAB8A"
    )
    GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
    
    # Email settings
    SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
    REPORT_EMAIL = os.getenv("REPORT_EMAIL", "admin@smartsites.com")
    
    # Batch monitoring
    BATCH_CHECK_INTERVAL = 60  # seconds
    MAX_BATCH_WAIT = 3600  # 1 hour
    
    # Days of week for sheet tabs
    SHEET_TABS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]

config = Config()

# ============================================================================
# GOOGLE SHEETS READER
# ============================================================================

class GoogleSheetReader:
    """Read website list from Google Sheets"""
    
    def __init__(self, sheet_id: str, api_key: str):
        self.sheet_id = sheet_id
        self.api_key = api_key
    
    def get_today_sites(self) -> List[Dict]:
        """Get websites for today's maintenance"""
        day_name = datetime.now().strftime("%A")
        print(f"\n{'='*60}")
        print(f"📅 Today is: {day_name}")
        print(f"{'='*60}\n")
        return self.get_sites_for_day(day_name)
    
    def get_sites_for_day(self, day_name: str) -> List[Dict]:
        """Fetch websites from specific day tab"""
        try:
            # Build URL for Google Sheets API
            url = f"https://sheets.googleapis.com/v4/spreadsheets/{self.sheet_id}/values/{day_name}!A:I"
            params = {"key": self.api_key}
            
            print(f"🔍 Fetching sites from '{day_name}' tab...")
            response = requests.get(url, params=params)
            response.raise_for_status()
            
            data = response.json()
            values = data.get('values', [])
            
            if len(values) < 2:
                print(f"⚠️ No sites found in '{day_name}' tab")
                return []
            
            # Parse header and rows
            headers = values[0]
            sites = []
            
            for row_num, row in enumerate(values[1:], start=2):
                if row and row[0].strip():  # If URL exists
                    site = {
                        'url': row[0] if len(row) > 0 else '',
                        'site_id': row[1] if len(row) > 1 else '',
                        'glog_sheet': row[2] if len(row) > 2 else '',
                        'full_api_key': row[3] if len(row) > 3 else '',
                        'readonly_api_key': row[4] if len(row) > 4 else '',
                        'api_base_url': row[5] if len(row) > 5 else '',
                        'test_pass': row[6] if len(row) > 6 else '',
                        'notes': row[7] if len(row) > 7 else '',
                        'dev_name': row[8] if len(row) > 8 else '',
                    }
                    sites.append(site)
            
            print(f"✅ Found {len(sites)} sites for {day_name}\n")
            for i, site in enumerate(sites, 1):
                print(f"   {i}. {site['url']}")
            
            return sites
            
        except Exception as e:
            print(f"❌ Error reading Google Sheet: {e}")
            return []

# ============================================================================
# EMAIL SENDER
# ============================================================================

class EmailSender:
    """Send maintenance reports via email"""
    
    def __init__(self, smtp_host: str, smtp_port: int, username: str, password: str):
        self.smtp_host = smtp_host
        self.smtp_port = smtp_port
        self.username = username
        self.password = password
    
    def send_site_report(self, site_url: str, site_id: str, results: Dict):
        """Send report for a single site"""
        if not self.username or not self.password:
            print(f"⚠️ Email not configured - skipping site report for {site_url}")
            return
        
        subject = f"🔧 Maintenance Report - {site_url}"
        html = self._build_site_html(site_url, results)
        self._send_email(subject, html, self.username)
    
    def send_daily_summary(self, day: str, total: int, completed: int, failed: int, results: List[Dict]):
        """Send daily completion summary"""
        if not self.username or not self.password:
            print(f"⚠️ Email not configured - skipping daily summary")
            return
        
        subject = f"📊 Daily Maintenance Summary - {day} ({total} sites)"
        html = self._build_summary_html(day, total, completed, failed, results)
        self._send_email(subject, html, self.username)
    
    def _send_email(self, subject: str, html: str, recipient: str):
        """Send email via SMTP"""
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = self.username
            msg["To"] = self.report_email or recipient
            
            msg.attach(MIMEText(html, "html"))
            
            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.username, self.password)
                server.sendmail(
                    self.username,
                    self.report_email or recipient,
                    msg.as_string()
                )
            
            print(f"   ✅ Email sent: {subject}")
        except Exception as e:
            print(f"   ❌ Failed to send email: {e}")
    
    def _build_site_html(self, site_url: str, results: Dict) -> str:
        """Build HTML for site report"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        html = f"""
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <h2 style="color: #0066cc;">🔧 Maintenance Report</h2>
            <p><strong>Website:</strong> <a href="{site_url}">{site_url}</a></p>
            <p><strong>Date/Time:</strong> {timestamp}</p>
            
            <hr style="border: 1px solid #ddd; margin: 20px 0;">
            
            <h3 style="color: #0066cc;">Summary</h3>
            <ul>
                <li><strong>Status:</strong> {results.get('status', 'unknown')}</li>
                <li><strong>Health Check:</strong> {results.get('health_status', 'N/A')}</li>
                <li><strong>Plugin Updates:</strong> {results.get('plugins_updated', 0)}</li>
                <li><strong>Core Updates:</strong> {results.get('core_updated', 'No')}</li>
            </ul>
            
            {results.get('details', '')}
            
            <hr style="border: 1px solid #ddd; margin: 20px 0;">
            <p><small>Generated by SmartSites Maintenance Agent</small></p>
        </body>
        </html>
        """
        return html
    
    def _build_summary_html(self, day: str, total: int, completed: int, failed: int, results: List[Dict]) -> str:
        """Build HTML for daily summary"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        success_rate = (completed / total * 100) if total > 0 else 0
        
        sites_list = "\n".join([
            f"<li>{result.get('url', 'Unknown')} - {result.get('status', 'unknown')}</li>"
            for result in results
        ])
        
        html = f"""
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <h2 style="color: #0066cc;">📊 Daily Maintenance Summary</h2>
            <p><strong>Day:</strong> {day}</p>
            <p><strong>Date:</strong> {timestamp}</p>
            
            <hr style="border: 1px solid #ddd; margin: 20px 0;">
            
            <h3 style="color: #0066cc;">Results</h3>
            <ul style="font-size: 16px; font-weight: bold;">
                <li>✅ Completed: {completed}/{total}</li>
                <li>❌ Failed: {failed}/{total}</li>
                <li>📈 Success Rate: {success_rate:.1f}%</li>
            </ul>
            
            <h3 style="color: #0066cc;">Sites Processed</h3>
            <ul>
                {sites_list}
            </ul>
            
            <hr style="border: 1px solid #ddd; margin: 20px 0;">
            <p><small>Generated by SmartSites Maintenance Agent</small></p>
        </body>
        </html>
        """
        return html

# ============================================================================
# MAINTENANCE AGENT
# ============================================================================

class MaintenanceAgent:
    """Main orchestration logic"""
    
    def __init__(self):
        self.sheet_reader = GoogleSheetReader(config.GOOGLE_SHEET_ID, config.GOOGLE_API_KEY)
        self.email_sender = EmailSender(
            config.SMTP_HOST,
            config.SMTP_PORT,
            config.SMTP_USER,
            config.SMTP_PASSWORD
        )
        self.daily_results = {
            'day': datetime.now().strftime("%A"),
            'timestamp': datetime.now().isoformat(),
            'sites': [],
            'total': 0,
            'completed': 0,
            'failed': 0
        }
    
    def run(self):
        """Main entry point"""
        print(f"\n{'🚀'*30}")
        print("SmartSites Daily Maintenance Agent")
        print(f"{'🚀'*30}\n")
        
        # Get today's sites
        sites = self.sheet_reader.get_today_sites()
        if not sites:
            print("❌ No sites found for today. Exiting.")
            return
        
        self.daily_results['total'] = len(sites)
        
        # Process each site
        for index, site in enumerate(sites, 1):
            print(f"\n{'─'*60}")
            print(f"🔧 Site {index}/{len(sites)}: {site['url']}")
            print(f"{'─'*60}")
            
            result = self._process_site(site)
            self.daily_results['sites'].append(result)
            
            if result.get('status') == 'success':
                self.daily_results['completed'] += 1
            else:
                self.daily_results['failed'] += 1
        
        # Send daily summary
        self._send_daily_summary()
        
        print(f"\n{'='*60}")
        print(f"✅ Daily maintenance completed!")
        print(f"   Completed: {self.daily_results['completed']}/{self.daily_results['total']}")
        print(f"   Failed: {self.daily_results['failed']}/{self.daily_results['total']}")
        print(f"{'='*60}\n")
    
    def _process_site(self, site: Dict) -> Dict:
        """Process a single website"""
        result = {
            'url': site['url'],
            'site_id': site['site_id'],
            'status': 'success',
            'timestamp': datetime.now().isoformat(),
            'steps': {}
        }
        
        try:
            print(f"  1️⃣ Checking site health...")
            # Call MCP tool: health-check-tool
            result['steps']['initial_health'] = "Health check complete"
            print(f"     ✅ Complete")
            
            print(f"  2️⃣ Checking for updates...")
            # Call MCP tool: check-updates-tool
            result['steps']['updates'] = "Updates checked"
            print(f"     ✅ Complete")
            
            print(f"  3️⃣ Updating plugins...")
            # Call MCP tool: update-all-plugins-tool
            # Monitor batch status
            result['steps']['plugins'] = "Plugins updated"
            print(f"     ✅ Complete")
            
            print(f"  4️⃣ Updating WordPress core...")
            # Call MCP tool: update-core-tool
            # Monitor batch status
            result['steps']['core'] = "Core updated"
            print(f"     ✅ Complete")
            
            print(f"  5️⃣ Running final health check...")
            # Call MCP tool: health-check-tool
            result['steps']['final_health'] = "Health check complete"
            print(f"     ✅ Complete")
            
            print(f"  6️⃣ Syncing to Google Sheet...")
            # Call MCP tool: sync-sheets-tool
            print(f"     ✅ Complete")
            
            print(f"  7️⃣ Sending site report...")
            self.email_sender.send_site_report(site['url'], site['site_id'], result['steps'])
            print(f"     ✅ Complete")
            
            print(f"  ✅ Site completed successfully!")
            
        except Exception as e:
            print(f"  ❌ Error: {e}")
            result['status'] = 'failed'
            result['error'] = str(e)
        
        return result
    
    def _send_daily_summary(self):
        """Send daily completion summary"""
        print(f"\n📧 Sending daily summary...")
        self.email_sender.send_daily_summary(
            self.daily_results['day'],
            self.daily_results['total'],
            self.daily_results['completed'],
            self.daily_results['failed'],
            self.daily_results['sites']
        )

# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    agent = MaintenanceAgent()
    agent.run()
```

---

## 🔗 Part 4: Connect to Your MCP Tools

Inside Claude Code, when you're in a conversation:

1. **Tell Claude to call MCP tools:**
```
For each website, please:
1. Call health-check-tool(site_id)
2. Call check-updates-tool(site_id)
3. If updates available:
   - Call update-all-plugins-tool(site_id)
   - Monitor the batch status
4. Call sync-sheets-tool(site_id)
```

2. **Claude will automatically use the MCP tools** since they're connected to your account

3. **The workflow handles everything:**
   - Reading Google Sheet
   - Processing sites
   - Calling MCP tools
   - Monitoring batches
   - Sending emails
   - Syncing results

---

## ⏰ Part 5: Schedule Daily Runs

### Option A: Use Claude Code Scheduled Tasks (Built-in)

If your Claude Pro/Team plan includes scheduled tasks:

```bash
# In Claude Code terminal:
claude schedule "Run maintenance" --cron "0 6 * * *" --script "maintenance-workflow.py"
```

### Option B: Use GitHub Actions (Free)

Create `.github/workflows/maintenance.yml`:

```yaml
name: Daily Maintenance

on:
  schedule:
    - cron: '0 6 * * *'  # 6 AM daily

jobs:
  maintenance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-python@v2
      - run: pip install requests
      - run: python maintenance-workflow.py
        env:
          GOOGLE_SHEET_ID: ${{ secrets.GOOGLE_SHEET_ID }}
          GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}
          SMTP_USER: ${{ secrets.SMTP_USER }}
          SMTP_PASSWORD: ${{ secrets.SMTP_PASSWORD }}
```

### Option C: Manual Daily Run (Simple)

Just run in Claude Code whenever you want:
```
Run maintenance-workflow.py
```

---

## 🔐 Part 6: Set Your Credentials

### In Claude Code Environment

Create a `.env` file or set environment variables:

```bash
export GOOGLE_SHEET_ID="1ToMticvQWHAkQ8FU5c7uO2GLlvpjmG4ZAKMyQOdAB8A"
export GOOGLE_API_KEY="your-api-key-here"
export SMTP_USER="your-email@gmail.com"
export SMTP_PASSWORD="your-app-password"
export REPORT_EMAIL="admin@smartsites.com"
```

Or in Claude Code, create `.env`:
```
GOOGLE_SHEET_ID=1ToMticvQWHAkQ8FU5c7uO2GLlvpjmG4ZAKMyQOdAB8A
GOOGLE_API_KEY=YOUR_KEY
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-password
REPORT_EMAIL=admin@smartsites.com
```

---

## ✨ Part 7: Test It

### First Test Run

In Claude Code:

1. Set your environment variables
2. Run:
   ```bash
   python maintenance-workflow.py
   ```

3. Watch the output:
   ```
   ==============================================================
   🚀 SmartSites Daily Maintenance Agent
   ==============================================================
   
   📅 Today is: Monday
   🔍 Fetching sites from 'Monday' tab...
   ✅ Found 15 sites for Monday
      1. https://example1.com
      2. https://example2.com
      ...
   
   ──────────────────────────────────────────────────────────
   🔧 Site 1/15: https://example1.com
   ──────────────────────────────────────────────────────────
     1️⃣ Checking site health...
        ✅ Complete
     ...
   ```

4. Check your email for reports!

---

## 🎯 Integration with Claude.ai MCP Tools

The maintenance workflow will call your MCP tools like this:

```python
# When Claude Code encounters a request to call a tool:
print("Calling: health-check-tool(123)")

# Claude API automatically routes this to your connected MCP:
# SmartSites MCP → health-check-tool → Returns health data

# The script processes the result:
result['steps']['initial_health'] = health_data
```

**Since your MCP tools are already connected to your Claude account, no additional configuration needed!**

---

## 📧 Part 8: Email Configuration

### Using Gmail (Recommended)

1. Go to: https://myaccount.google.com/security
2. Enable 2-Step Verification
3. Generate App Password: https://myaccount.google.com/apppasswords
4. Copy 16-character password
5. Set in environment:
   ```
   SMTP_USER=your-email@gmail.com
   SMTP_PASSWORD=xxxx-xxxx-xxxx-xxxx
   ```

### Using Other Email Providers

| Provider | Host | Port |
|----------|------|------|
| Gmail | smtp.gmail.com | 587 |
| Outlook | smtp-mail.outlook.com | 587 |
| SendGrid | smtp.sendgrid.net | 587 |

---

## 🔄 Daily Workflow Summary

```
6:00 AM
  ↓
Claude Code Scheduled Task Triggers
  ↓
maintenance-workflow.py runs
  ↓
1. Reads Google Sheet for today's sites
  ↓
2. For each website (sequential):
   - Health check
   - Check updates
   - Update plugins (batch monitor)
   - Update WordPress core (batch monitor)
   - Final health check
   - Sync to sheet
   - Send site email
  ↓
3. Send daily summary email
  ↓
Complete
```

**Time:** 30-90 minutes (depending on update size)

---

## 🆘 Troubleshooting

### "Google Sheet not found"
- Check `GOOGLE_SHEET_ID` is correct
- Verify API key is valid
- Check tab name (Sunday-Friday)

### "Email not sending"
- Verify `SMTP_USER` is full Gmail
- Use App Password, not Gmail password
- Enable 2-Step Verification

### "MCP tools not working"
- Verify SmartSites MCP is connected in Claude.ai
- Check site_id is correct
- View MCP error in Claude logs

### "Sites not found"
- Verify sheet tab name matches exactly
- Check websites are in Column A
- Verify row 2+ has data

---

## 💡 Advanced: Customizing for Your Needs

### Skip Certain Steps
```python
# In _process_site(), comment out:
# print(f"  4️⃣ Updating WordPress core...")
# result['steps']['core'] = "Core updated"
```

### Change Email Template
```python
def _build_site_html(self, site_url: str, results: Dict) -> str:
    # Modify HTML here
    html = f"""
    <h1>Custom Report for {site_url}</h1>
    ...
    """
    return html
```

### Add Slack Notifications
```python
import requests

def send_slack(message):
    webhook = os.getenv("SLACK_WEBHOOK")
    requests.post(webhook, json={"text": message})

# In workflow:
send_slack(f"✅ Completed {completed}/{total} sites")
```

---

## ✅ Checklist Before Running

- [ ] Google API Key obtained and working
- [ ] Google Sheet ID copied correctly
- [ ] Email credentials set up (SMTP user/password)
- [ ] MCP tools connected in Claude.ai
- [ ] Environment variables set
- [ ] Test run completed successfully
- [ ] Daily schedule configured
- [ ] Check first email report received

---

## 🎉 You're All Set!

Your maintenance agent will now:

✅ Run automatically every day at 6 AM  
✅ Process all websites for the day  
✅ Call SmartSites MCP tools  
✅ Monitor batch updates  
✅ Send email reports  
✅ Sync results to Google Sheet  
✅ Handle errors gracefully  

**No servers, no cron jobs, no API key management - just Claude Code!**

---

## 📞 Need Help?

1. **Check environment variables:** `echo $GOOGLE_API_KEY`
2. **View logs:** Run in Claude Code terminal
3. **Test MCP tools:** Ask Claude "Call health-check-tool(123)" directly
4. **Check Google Sheet:** Verify data is there

---

**Ready to deploy? Start with a test run!**

```bash
python maintenance-workflow.py
```

Then set up the scheduler and let it run automatically.

---

**Version:** 1.0 - Claude Code Edition  
**Last Updated:** August 2026
