#!/usr/bin/env python3
"""
Helper script to get today's sites from Google Sheet
Used by the Claude Code workflow to fetch the maintenance list
"""

import os
import sys
import json
import requests
from datetime import datetime
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except:
    pass

def get_today_sites():
    """Get websites scheduled for today"""

    # Get configuration
    sheet_id = os.getenv("GOOGLE_SHEET_ID")
    api_key = os.getenv("GOOGLE_API_KEY")

    if not sheet_id or not api_key:
        print(json.dumps({
            "error": "Missing GOOGLE_SHEET_ID or GOOGLE_API_KEY",
            "sites": []
        }))
        sys.exit(1)

    # Get today's day name
    day_name = datetime.now().strftime("%A")

    try:
        # Fetch from Google Sheets API (bypass proxy)
        url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{day_name}!A:I"
        params = {"key": api_key}

        # Disable proxy
        proxies = {"https": None, "http": None}
        response = requests.get(url, params=params, timeout=10, proxies=proxies)
        response.raise_for_status()

        data = response.json()
        values = data.get('values', [])

        if len(values) < 2:
            print(json.dumps({
                "day": day_name,
                "sites": [],
                "message": f"No sites found for {day_name}"
            }))
            sys.exit(0)

        # Parse sites from rows (skip header in row 0)
        sites = []
        for row_idx, row in enumerate(values[1:], start=2):
            if row and len(row) > 0 and row[0].strip():
                site = {
                    'row': row_idx,
                    'url': row[0].strip(),
                    'site_id': row[1].strip() if len(row) > 1 else '',
                    'glog_sheet': row[2].strip() if len(row) > 2 else '',
                    'full_api_key': row[3].strip() if len(row) > 3 else '',
                    'readonly_api_key': row[4].strip() if len(row) > 4 else '',
                    'api_base_url': row[5].strip() if len(row) > 5 else '',
                    'test_pass': row[6].strip() if len(row) > 6 else '',
                    'notes': row[7].strip() if len(row) > 7 else '',
                    'dev_name': row[8].strip() if len(row) > 8 else '',
                }
                sites.append(site)

        # Output as JSON
        output = {
            "day": day_name,
            "date": datetime.now().isoformat(),
            "total_sites": len(sites),
            "sites": sites
        }

        print(json.dumps(output, indent=2))

    except Exception as e:
        print(json.dumps({
            "error": str(e),
            "sites": []
        }))
        sys.exit(1)

if __name__ == "__main__":
    get_today_sites()
