#!/usr/bin/env python3
"""
Email sender utility using SMTP (Gmail)
Usage: python send_email.py --to recipient@example.com --subject "Subject" --body "HTML body" --from sender@gmail.com
"""

import smtplib
import json
import sys
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from argparse import ArgumentParser
from pathlib import Path

def load_env():
    """Load environment variables from .env file"""
    env_path = Path(__file__).parent / '.env'
    if not env_path.exists():
        print(json.dumps({"sent": False, "error": ".env file not found"}))
        sys.exit(1)

    env = {}
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#'):
                if '=' in line:
                    key, value = line.split('=', 1)
                    env[key.strip()] = value.strip()

    return env

def send_email(to_email, subject, html_body, from_name="SmartSites Maintenance"):
    """Send email via Gmail SMTP"""
    try:
        env = load_env()

        smtp_host = env.get('SMTP_HOST', 'smtp.gmail.com')
        smtp_port = int(env.get('SMTP_PORT', '587'))
        smtp_user = env.get('SMTP_USER', '')
        smtp_password = env.get('SMTP_PASSWORD', '')

        if not smtp_user or not smtp_password:
            return {"sent": False, "error": "SMTP credentials not configured in .env"}

        # Create message
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = f"{from_name} <{smtp_user}>"
        msg['To'] = to_email

        # Add HTML body
        msg.attach(MIMEText(html_body, 'html', 'utf-8'))

        # Send via SMTP
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.send_message(msg)

        return {
            "sent": True,
            "message": f"Email sent successfully to {to_email}",
            "recipient": to_email,
            "subject": subject
        }

    except smtplib.SMTPAuthenticationError:
        return {
            "sent": False,
            "error": "SMTP authentication failed - check credentials in .env"
        }
    except smtplib.SMTPException as e:
        return {
            "sent": False,
            "error": f"SMTP error: {str(e)}"
        }
    except Exception as e:
        return {
            "sent": False,
            "error": f"Email send failed: {str(e)}"
        }

if __name__ == '__main__':
    parser = ArgumentParser(description='Send HTML email via Gmail SMTP')
    parser.add_argument('--to', required=True, help='Recipient email address')
    parser.add_argument('--subject', required=True, help='Email subject')
    parser.add_argument('--body', required=True, help='HTML email body')
    parser.add_argument('--from-name', default='SmartSites Maintenance', help='From name')

    args = parser.parse_args()

    result = send_email(args.to, args.subject, args.body, args.from_name)
    print(json.dumps(result))
