#!/usr/bin/env python3
"""
Check if SmartSites Maintenance MCP is available
"""

import json
import subprocess
import sys

print("\n" + "="*70)
print("🔍 SmartSites Maintenance MCP - Availability Check")
print("="*70 + "\n")

# Try to find claude command
try:
    result = subprocess.run(
        ["claude", "--version"],
        capture_output=True,
        text=True,
        timeout=5
    )
    print(f"✅ Claude Code CLI found")
    print(f"   Version: {result.stdout.strip()}\n")
except Exception as e:
    print(f"❌ Claude Code CLI not found: {e}\n")
    print("   Need to install: npm install -g @anthropic-ai/claude-code\n")

# Check Claude Code settings
print("📋 Claude Code Configuration Locations:")
print("   Windows: %APPDATA%\\.claude\\")
print("   Mac: ~/.claude/")
print("   Linux: ~/.claude/\n")

settings_path = None
import os
if os.name == 'nt':  # Windows
    settings_path = os.path.expandvars(r"%APPDATA%\.claude\settings.json")
elif os.name == 'posix':  # Mac/Linux
    settings_path = os.path.expanduser("~/.claude/settings.json")

if settings_path and os.path.exists(settings_path):
    print(f"✅ Found settings file: {settings_path}\n")
    try:
        with open(settings_path, 'r') as f:
            settings = json.load(f)

            if 'mcpServers' in settings or 'mcp' in settings:
                print("📡 MCP Servers configured:")
                mcp_config = settings.get('mcpServers') or settings.get('mcp', {})
                if isinstance(mcp_config, dict):
                    for name, config in mcp_config.items():
                        print(f"   ✅ {name}")
                        if isinstance(config, dict):
                            print(f"      Type: {config.get('type', 'unknown')}")
                else:
                    print(f"   {mcp_config}")
            else:
                print("⚠️  No MCP servers configured in settings.json")

    except Exception as e:
        print(f"⚠️  Could not read settings: {e}\n")
else:
    print(f"⚠️  Settings file not found at {settings_path}\n")

print("="*70)
print("🎯 How to Check MCP in Claude Code")
print("="*70 + "\n")

print("Option 1: In Claude Code Web Interface")
print("   1. Go to https://claude.ai")
print("   2. Open Claude Code")
print("   3. Type: 'What MCP tools are available?'")
print("   4. Claude will list all connected MCP servers\n")

print("Option 2: In VSCode Extension")
print("   1. Open Claude Code extension in VSCode")
print("   2. Look for 'Available Tools' section")
print("   3. Should show SmartSites tools\n")

print("Option 3: Check Settings")
print("   1. In Claude Code, type: /config")
print("   2. Look for MCP or tools section\n")

print("="*70)
print("✅ What You Should See")
print("="*70 + "\n")

mcp_tools = [
    "health-check-tool",
    "check-updates-tool",
    "update-plugin-tool",
    "update-all-plugins-tool",
    "update-core-tool",
    "check-external-updates-tool",
    "create-backup-tool",
    "list-backups-tool",
    "rollback-tool",
    "all-site-maintenance-overview-tool",
    "maintenance-detailed-report-tool",
    "sync-sheets-tool",
    "queue-status-tool",
    "site-info-tool",
    "list-maintenance-tool",
    "maintenance-logs-tool",
    "who-am-i-tool",
]

print("If SmartSites MCP is connected, you should see these 17 tools:\n")
for i, tool in enumerate(mcp_tools, 1):
    print(f"   {i:2d}. {tool}")

print("\n" + "="*70)
print("⚙️  Next Steps")
print("="*70 + "\n")

print("If tools are NOT showing:")
print("   1. Check if SmartSites MCP is enabled in Claude Code settings")
print("   2. Verify the MCP server is running")
print("   3. Restart Claude Code")
print("   4. Reconnect the MCP server\n")

print("If tools ARE showing:")
print("   1. ✅ Workflow is ready to run!")
print("   2. Use: claude run .claude/workflows/daily-maintenance.js")
print("   3. Or use Claude.ai web interface\n")

print("="*70 + "\n")
