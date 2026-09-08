#!/usr/bin/env python3
"""
Google Chat message sender using incoming webhook
Usage: python send_to_chat.py --title "Title" --body "Message body" --status "success"
"""

import json
import sys
from argparse import ArgumentParser
from pathlib import Path
import urllib.request
import urllib.error


def load_env():
    """Load environment variables from .env file"""
    env_path = Path(__file__).parent / '.env'
    if not env_path.exists():
        return {}

    env = {}
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#'):
                if '=' in line:
                    key, value = line.split('=', 1)
                    env[key.strip()] = value.strip()
    return env


def send_to_chat(title, body, status='info', webhook_url=None):
    """
    Send formatted message to Google Chat via webhook

    Args:
        title: Message title/heading
        body: Message body text
        status: Message status type - 'info', 'success', 'warning', 'error'
        webhook_url: Google Chat webhook URL (optional, uses .env if not provided)

    Returns:
        dict with sent status and details
    """

    env = load_env()

    if not webhook_url:
        webhook_url = env.get('GOOGLE_CHAT_WEBHOOK_URL', '')

    if not webhook_url:
        return {
            "sent": False,
            "error": "No webhook URL configured in .env or provided as argument"
        }

    # Icon map for status (valid Google Chat knownIcon values)
    icons = {
        'info': 'INFO',
        'success': 'CHECKMARK',
        'warning': 'WARNING',
        'error': 'ERROR_CIRCLE',
    }

    # Build Google Chat card message
    message = {
        "cardsV2": [
            {
                "cardId": f"maintenance-{status}",
                "card": {
                    "header": {
                        "title": title,
                        "subtitle": f"SmartSites Maintenance • {status.upper()}",
                        "imageUrl": "https://www.smartsites.com/favicon.ico",
                        "imageType": "CIRCLE",
                        "imageAltText": "SmartSites"
                    },
                    "sections": [
                        {
                            "widgets": [
                                {
                                    "decoratedText": {
                                        "text": body,
                                        "topLabel": "Report",
                                        "wrapText": True
                                    }
                                }
                            ]
                        }
                    ],
                    "cardActions": [
                        {
                            "actionLabel": "View Pegasus",
                            "onClick": {
                                "openLink": {
                                    "url": "https://pegasus-v4.plabs.app/dashboard"
                                }
                            }
                        }
                    ]
                }
            }
        ]
    }

    try:
        headers = {
            'Content-Type': 'application/json'
        }

        data = json.dumps(message).encode('utf-8')
        request = urllib.request.Request(
            webhook_url,
            data=data,
            headers=headers,
            method='POST'
        )

        try:
            response = urllib.request.urlopen(request, timeout=10)
            response_data = response.read().decode('utf-8')

            return {
                "sent": True,
                "message": "Message sent successfully to Google Chat",
                "title": title
            }
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8')
            return {
                "sent": False,
                "error": f"Google Chat API error {e.code}",
                "details": error_body[:200],
                "status_code": e.code
            }

    except Exception as e:
        return {
            "sent": False,
            "error": f"Failed to send message: {str(e)}"
        }


if __name__ == '__main__':
    parser = ArgumentParser(description='Send formatted message to Google Chat using webhook')
    parser.add_argument('--title', required=True, help='Message title')
    parser.add_argument('--body', required=True, help='Message body')
    parser.add_argument('--status', default='info', choices=['info', 'success', 'warning', 'error'],
                        help='Message status type (affects color and icon)')
    parser.add_argument('--webhook-url', help='Google Chat webhook URL (optional, uses .env if not provided)')

    args = parser.parse_args()

    result = send_to_chat(args.title, args.body, args.status, args.webhook_url)
    print(json.dumps(result))
