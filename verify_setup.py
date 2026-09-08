#!/usr/bin/env python3
"""
Verify the maintenance agent setup
Run this to check if everything is configured correctly before running maintenance
"""

import os
import json
from pathlib import Path
from datetime import datetime

def check_service_account():
    """Verify service account JSON exists and is valid"""
    print("\n📋 Checking Service Account...")

    path = Path("maintenance-backups-1e58c79f6033.json")
    if not path.exists():
        print(f"   ❌ Service account file not found: {path}")
        return False

    try:
        with open(path, 'r') as f:
            sa = json.load(f)

        client_email = sa.get('client_email', 'N/A')
        project_id = sa.get('project_id', 'N/A')

        print(f"   ✅ Service account loaded")
        print(f"      Email: {client_email}")
        print(f"      Project: {project_id}")
        print(f"\n   📌 Important: Share your Google Sheet with:")
        print(f"      {client_email}")
        return True
    except Exception as e:
        print(f"   ❌ Error reading service account: {e}")
        return False

def check_environment():
    """Verify environment variables are set"""
    print("\n📋 Checking Environment Variables...")

    from dotenv import load_dotenv
    load_dotenv()

    required = {
        'GOOGLE_SHEET_ID': 'Google Sheet ID',
        'SERVICE_ACCOUNT_JSON_PATH': 'Service account JSON path',
        'SMTP_USER': 'Gmail address',
        'SMTP_PASSWORD': 'Gmail app password',
        'REPORT_EMAIL': 'Report recipient email'
    }

    all_good = True
    for key, description in required.items():
        value = os.getenv(key)
        if value:
            if 'PASSWORD' in key:
                display = value[:3] + '*' * (len(value) - 3)
            else:
                display = value
            print(f"   ✅ {description}: {display}")
        else:
            print(f"   ❌ {description}: NOT SET")
            all_good = False

    return all_good

def check_google_sheet():
    """Verify Google Sheet is accessible"""
    print("\n📋 Checking Google Sheet Access...")

    try:
        import requests

        sheet_id = os.getenv('GOOGLE_SHEET_ID')
        api_key = os.getenv('GOOGLE_API_KEY')

        if not sheet_id:
            print("   ⚠️  GOOGLE_SHEET_ID not set - cannot verify")
            return False

        # Try to read the Monday tab
        url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/Monday!A1:A10"
        params = {}
        if api_key:
            params['key'] = api_key

        response = requests.get(url, params=params, timeout=5)

        if response.status_code == 200:
            data = response.json()
            rows = len(data.get('values', []))
            print(f"   ✅ Google Sheet is readable")
            print(f"      Found {rows} rows in Monday tab")
            return True
        elif response.status_code == 403:
            print(f"   ⚠️  Access denied - sheet may need to be shared with service account")
            print(f"      Make sure you've shared the sheet with:")
            sa_email = json.load(open('maintenance-backups-1e58c79f6033.json')).get('client_email')
            print(f"      {sa_email}")
            return False
        else:
            print(f"   ⚠️  Unexpected response: {response.status_code}")
            return False

    except Exception as e:
        print(f"   ⚠️  Could not verify (may need requests library): {e}")
        return False

def check_email():
    """Verify email configuration"""
    print("\n📋 Checking Email Configuration...")

    try:
        import smtplib

        smtp_user = os.getenv('SMTP_USER')
        smtp_password = os.getenv('SMTP_PASSWORD')

        if not smtp_user or not smtp_password:
            print("   ⚠️  Email credentials not set")
            return False

        # Try to connect (don't actually send)
        with smtplib.SMTP('smtp.gmail.com', 587, timeout=5) as server:
            server.starttls()
            server.login(smtp_user, smtp_password)
            print(f"   ✅ Gmail connection successful")
            print(f"      User: {smtp_user}")
            return True

    except smtplib.SMTPAuthenticationError:
        print(f"   ❌ Gmail authentication failed")
        print(f"      Make sure you're using an App Password, not your regular password")
        print(f"      See: https://myaccount.google.com/apppasswords")
        return False
    except Exception as e:
        print(f"   ⚠️  Could not verify email: {e}")
        return False

def main():
    """Run all checks"""
    print(f"\n{'='*60}")
    print("🔍 SmartSites Maintenance Agent - Setup Verification")
    print(f"{'='*60}")

    checks = [
        ("Service Account", check_service_account),
        ("Environment", check_environment),
        ("Google Sheet", check_google_sheet),
        ("Email", check_email),
    ]

    results = {}
    for name, check in checks:
        try:
            results[name] = check()
        except Exception as e:
            print(f"   ❌ Error: {e}")
            results[name] = False

    # Summary
    print(f"\n{'='*60}")
    print("📊 Summary")
    print(f"{'='*60}")

    passed = sum(1 for v in results.values() if v)
    total = len(results)

    for name, passed_check in results.items():
        icon = "✅" if passed_check else "❌"
        print(f"{icon} {name}")

    print(f"\nPassed: {passed}/{total}")

    if passed == total:
        print(f"\n✅ All checks passed! Ready to run maintenance.py")
    else:
        print(f"\n⚠️  Some checks failed. Please fix the issues above.")

    print(f"{'='*60}\n")

if __name__ == "__main__":
    main()
