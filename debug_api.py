#!/usr/bin/env python3
"""
Debug API access issues
"""

import os
import requests
import json
from pathlib import Path

# Load environment
try:
    from dotenv import load_dotenv
    load_dotenv()
    print("✅ Loaded .env file\n")
except:
    print("⚠️  python-dotenv not installed, but trying to read env vars\n")

# Check environment variables
print("=" * 60)
print("📋 Environment Variables")
print("=" * 60)

sheet_id = os.getenv("GOOGLE_SHEET_ID")
api_key = os.getenv("GOOGLE_API_KEY")

print(f"GOOGLE_SHEET_ID: {sheet_id[:50]}..." if sheet_id else "GOOGLE_SHEET_ID: NOT SET")
print(f"GOOGLE_API_KEY: {api_key[:20]}..." if api_key else "GOOGLE_API_KEY: NOT SET")

if not api_key:
    print("\n❌ API key not found in environment!")
    print("Make sure you've added GOOGLE_API_KEY= to your .env file")
    exit(1)

if not sheet_id:
    print("\n❌ Sheet ID not found in environment!")
    exit(1)

# Test the API call
print("\n" + "=" * 60)
print("🧪 Testing Google Sheets API")
print("=" * 60)

url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/Monday!A1:A10"
params = {"key": api_key}

print(f"\n📍 URL: {url}")
print(f"🔑 API Key: {api_key[:20]}...")
print(f"\nMaking request...")

try:
    response = requests.get(url, params=params, timeout=10)

    print(f"\n✅ Response Status: {response.status_code}")
    print(f"Response Headers:")
    for key, value in response.headers.items():
        print(f"  {key}: {value}")

    print(f"\nResponse Body:")
    print(response.text[:500])

    if response.status_code == 200:
        data = response.json()
        print(f"\n✅ SUCCESS! Sheet is readable")
        print(f"   Found {len(data.get('values', []))} rows")

    elif response.status_code == 403:
        print(f"\n❌ ACCESS DENIED (403)")
        print("Possible causes:")
        print("  1. API key is invalid or has wrong permissions")
        print("  2. Google Sheets API not enabled in Google Cloud")
        print("  3. API key has IP restrictions that don't match")
        print("\nDebug info:")
        try:
            error = response.json()
            print(f"  Error message: {error.get('error', {}).get('message', 'Unknown')}")
        except:
            pass

    elif response.status_code == 404:
        print(f"\n❌ NOT FOUND (404)")
        print("The sheet ID or tab name might be wrong")
        print(f"Sheet ID: {sheet_id}")
        print(f"Looking for tab: Monday")

    else:
        print(f"\n⚠️  Unexpected status: {response.status_code}")

except Exception as e:
    print(f"\n❌ Error: {e}")

# Try to get spreadsheet metadata
print("\n" + "=" * 60)
print("📊 Checking Spreadsheet Access")
print("=" * 60)

metadata_url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}"
metadata_params = {"key": api_key}

try:
    response = requests.get(metadata_url, params=metadata_params, timeout=10)

    if response.status_code == 200:
        data = response.json()
        print(f"✅ Sheet found!")
        print(f"   Title: {data.get('properties', {}).get('title', 'Unknown')}")

        sheets = data.get('sheets', [])
        print(f"   Sheets available: {len(sheets)}")
        for sheet in sheets:
            title = sheet.get('properties', {}).get('title', 'Unknown')
            print(f"     - {title}")
    else:
        print(f"❌ Failed to get metadata: {response.status_code}")

except Exception as e:
    print(f"❌ Error: {e}")

# Check if API is enabled
print("\n" + "=" * 60)
print("💡 Possible Solutions")
print("=" * 60)

print("""
1. Verify API Key:
   - Go to: https://console.cloud.google.com/credentials
   - Make sure your API key is listed and "Google Sheets API" is enabled

2. Enable Google Sheets API:
   - Go to: https://console.cloud.google.com/apis/api/sheets.googleapis.com
   - Click "Enable"

3. Check API Restrictions:
   - In Google Cloud Console, click on your API key
   - Check "API Restrictions" - should be set to "Google Sheets API"
   - Check "Application restrictions" - if set to "IP addresses", make sure yours is listed

4. Verify Sheet Sharing:
   - Open your sheet: https://docs.google.com/spreadsheets/d/{sheet_id}
   - Make sure it's not "Private" - should be "Anyone with link" or shared with service account

5. Try the API directly:
   - Open this URL in your browser (replace {API_KEY}):
   https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/Monday!A1:A10?key={api_key}
""")
