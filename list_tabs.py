#!/usr/bin/env python3
"""
List all available tabs (sheets) in your Google Sheet
"""

import os
import requests
import json
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except:
    pass

# Get config
sheet_id = os.getenv("GOOGLE_SHEET_ID")
api_key = os.getenv("GOOGLE_API_KEY")

if not api_key or not sheet_id:
    print("❌ Missing GOOGLE_SHEET_ID or GOOGLE_API_KEY in .env")
    exit(1)

print(f"\n📊 Fetching sheet metadata...")
print(f"Sheet ID: {sheet_id}\n")

# Get metadata about all sheets
url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}"
params = {"key": api_key}

try:
    response = requests.get(url, params=params, timeout=10)
    response.raise_for_status()

    data = response.json()
    properties = data.get('properties', {})
    sheets = data.get('sheets', [])

    print(f"📌 Sheet Title: {properties.get('title', 'Unknown')}\n")
    print(f"{'='*60}")
    print("Available Tabs:")
    print(f"{'='*60}\n")

    for i, sheet in enumerate(sheets, 1):
        sheet_props = sheet.get('properties', {})
        title = sheet_props.get('title', 'Unknown')
        sheet_id_num = sheet_props.get('sheetId', 'N/A')
        grid = sheet_props.get('gridProperties', {})
        rows = grid.get('rowCount', 0)
        cols = grid.get('columnCount', 0)

        print(f"{i}. {title}")
        print(f"   - Sheet ID: {sheet_id_num}")
        print(f"   - Size: {rows} rows × {cols} columns")
        print()

    # Now try to read each tab
    print(f"{'='*60}")
    print("Testing Access to Each Tab:")
    print(f"{'='*60}\n")

    for sheet in sheets:
        title = sheet.get('properties', {}).get('title', 'Unknown')

        # Try to read first row
        range_str = f"{title}!A1:I1"
        range_url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{range_str}"

        try:
            resp = requests.get(range_url, params=params, timeout=5)

            if resp.status_code == 200:
                print(f"✅ {title}: Readable")
            elif resp.status_code == 403:
                print(f"❌ {title}: Access Denied (403)")
            else:
                print(f"⚠️  {title}: Status {resp.status_code}")

        except Exception as e:
            print(f"❌ {title}: Error - {e}")

except Exception as e:
    print(f"❌ Error fetching metadata: {e}")
    print("\nMake sure your API key and sheet ID are correct.")
