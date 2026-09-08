#!/usr/bin/env python3
"""
Test email sending functionality
"""

import subprocess
import json
import sys

def test_email():
    """Test sending a test email"""
    print("🧪 Testing email send functionality...\n")

    # Create a test HTML email
    test_html = """
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; }
            .header { background-color: #007bff; color: white; padding: 20px; }
            .content { padding: 20px; }
            .footer { background-color: #f8f9fa; padding: 10px; text-align: center; color: #666; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🧪 Email Test</h1>
        </div>
        <div class="content">
            <p>This is a test email to verify the email sending functionality is working correctly.</p>
            <p><strong>Test Date:</strong> Daily Maintenance Test</p>
            <p>If you received this email, your email configuration is working!</p>
        </div>
        <div class="footer">
            <p>SmartSites Maintenance System</p>
        </div>
    </body>
    </html>
    """

    try:
        # Run the send_email script
        result = subprocess.run(
            [
                sys.executable,
                'send_email.py',
                '--to', 'frontend@smartsites.com',
                '--subject', '🧪 SmartSites Maintenance - Email Test',
                '--body', test_html
            ],
            capture_output=True,
            text=True,
            timeout=30
        )

        # Parse the response
        if result.returncode == 0:
            try:
                response = json.loads(result.stdout)
                if response.get('sent'):
                    print("✅ SUCCESS! Email sent successfully!")
                    print(f"   To: {response.get('recipient')}")
                    print(f"   Subject: {response.get('subject')}")
                    print(f"   Message: {response.get('message')}\n")
                    return True
                else:
                    print("❌ FAILED! Email was not sent.")
                    print(f"   Error: {response.get('error')}\n")
                    return False
            except json.JSONDecodeError:
                print("❌ FAILED! Invalid response from email script.")
                print(f"   stdout: {result.stdout}")
                print(f"   stderr: {result.stderr}\n")
                return False
        else:
            print("❌ FAILED! Email script execution failed.")
            print(f"   stderr: {result.stderr}\n")
            return False

    except subprocess.TimeoutExpired:
        print("❌ FAILED! Email script timed out (30 seconds).\n")
        return False
    except Exception as e:
        print(f"❌ FAILED! Unexpected error: {str(e)}\n")
        return False

if __name__ == '__main__':
    success = test_email()
    print("=" * 60)
    if success:
        print("✅ Email system is working correctly!")
        print("   You can now run the daily-maintenance workflow.")
        print("   Check frontend@smartsites.com for test email.")
    else:
        print("❌ Email system is not working.")
        print("   Please check:")
        print("   1. .env file has SMTP_USER and SMTP_PASSWORD")
        print("   2. Gmail app password is correct (not regular password)")
        print("   3. Gmail account allows SMTP connections")
    print("=" * 60)

    sys.exit(0 if success else 1)
