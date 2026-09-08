#!/usr/bin/env python3
"""
Run the maintenance workflow without Claude Code CLI
This is a wrapper that orchestrates the maintenance using agents directly
"""

import os
import sys
import json
import subprocess
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except:
    pass

def run_workflow():
    """Execute the daily maintenance workflow"""

    print("\n" + "="*60)
    print("🚀 SmartSites Daily Maintenance Workflow")
    print("="*60 + "\n")

    # Step 1: Get today's sites
    print("📅 Phase 1: Loading today's sites...")
    try:
        result = subprocess.run(
            [sys.executable, "get_today_sites.py"],
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode != 0:
            print(f"❌ Error: {result.stderr}")
            return False

        sites_data = json.loads(result.stdout)
        day = sites_data.get('day')
        sites = sites_data.get('sites', [])
        total = len(sites)

        if total == 0:
            print(f"❌ No sites found for {day}")
            return False

        print(f"✅ Found {total} sites for {day}\n")

    except Exception as e:
        print(f"❌ Error loading sites: {e}")
        return False

    # Step 2: Run the actual workflow via Claude Code
    print("🔧 Phase 2: Running maintenance workflow...")
    print("\n📝 To run the workflow, you have these options:\n")

    print("Option 1️⃣ : Install Claude Code CLI and run:")
    print("   npm install -g @anthropic-ai/claude-code")
    print("   claude run .claude/workflows/daily-maintenance.js\n")

    print("Option 2️⃣ : Use Claude.ai Web Interface:")
    print("   1. Go to https://claude.ai")
    print("   2. Open Claude Code")
    print("   3. Paste: 'Run the daily-maintenance workflow'\n")

    print("Option 3️⃣ : Use Claude Code from VSCode/IDE:")
    print("   1. Install Claude Code extension")
    print("   2. Open your project folder")
    print("   3. Press Ctrl+K to run commands\n")

    print("="*60)
    print("📊 Workflow Summary")
    print("="*60)
    print(f"Day: {day}")
    print(f"Sites to process: {total}")
    print(f"Processing order: Sequential (1 site at a time)")
    print("\nFor each site:")
    for i, site in enumerate(sites, 1):
        print(f"  {i}. {site['url']}")

    print("\n✅ Configuration is ready!")
    print("❓ Choose an option above to run the workflow.\n")

    return True

if __name__ == "__main__":
    success = run_workflow()
    sys.exit(0 if success else 1)
