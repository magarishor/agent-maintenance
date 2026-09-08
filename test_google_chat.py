#!/usr/bin/env python3
"""
Test Google Chat integration - verify GSuite service account connectivity
"""

import subprocess
import json
import sys
from pathlib import Path

# Fix Unicode encoding on Windows
if sys.platform == 'win32':
    import os
    os.environ['PYTHONIOENCODING'] = 'utf-8'
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


def run_test(test_type='info'):
    """Run a test message send"""

    print(f"\n🧪 Testing {test_type} message...")

    test_messages = {
        'info': {
            'title': 'Test: Info Message',
            'body': 'This is a test information message to verify Google Chat connectivity.',
            'status': 'info'
        },
        'success': {
            'title': 'Test: Success Message',
            'body': 'All systems operational. Plugin updates completed successfully.',
            'status': 'success'
        },
        'warning': {
            'title': 'Test: Warning Message',
            'body': 'Warning: One site requires manual review before proceeding.',
            'status': 'warning'
        },
        'error': {
            'title': 'Test: Error Message',
            'body': 'Error: Failed to reach API endpoint. Check network connectivity.',
            'status': 'error'
        }
    }

    msg = test_messages.get(test_type, test_messages['info'])

    try:
        result = subprocess.run(
            [
                sys.executable, 'send_to_chat.py',
                '--title', msg['title'],
                '--body', msg['body'],
                '--status', msg['status']
            ],
            capture_output=True,
            text=True,
            timeout=15
        )

        if result.returncode == 0:
            response = json.loads(result.stdout)
            if response.get('sent'):
                print(f"✅ {test_type.upper()} message sent successfully")
                return True
            else:
                error = response.get('error', 'Unknown error')
                print(f"❌ Failed to send message: {error}")
                return False
        else:
            print(f"❌ Script error: {result.stderr}")
            return False

    except subprocess.TimeoutExpired:
        print("❌ Request timeout - Google Chat API not responding")
        return False
    except Exception as e:
        print(f"❌ Test failed: {str(e)}")
        return False


def main():
    """Run full test suite"""

    print("=" * 60)
    print("Google Chat Integration Test (Webhook)")
    print("=" * 60)

    # Load .env
    env_path = Path('.env')
    if not env_path.exists():
        print("\n❌ .env file not found")
        return False

    env = {}
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                env[key.strip()] = value.strip()

    # Check webhook URL
    webhook_url = env.get('GOOGLE_CHAT_WEBHOOK_URL', '')
    if not webhook_url:
        print("\n❌ GOOGLE_CHAT_WEBHOOK_URL not configured in .env")
        return False

    print(f"✅ Webhook URL: {webhook_url[:50]}...")

    # Run tests
    tests_passed = 0
    total_tests = 4

    for test_type in ['info', 'success', 'warning', 'error']:
        if run_test(test_type):
            tests_passed += 1

    print("\n" + "=" * 60)
    print(f"Results: {tests_passed}/{total_tests} tests passed")

    if tests_passed == total_tests:
        print("✅ All tests passed! Google Chat integration is working.")
        return True
    else:
        print(f"⚠️  {total_tests - tests_passed} test(s) failed.")
        print("   Check: service account file, space ID, and API permissions")
        return False


if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
