# Google Chat Integration Migration Guide

Replace email notifications with Google Chat messages using your existing GSuite service account.

---

## Overview

**Current State:** Maintenance reports sent via email (SMTP/Gmail)  
**Target State:** Maintenance reports sent to Google Chat via GSuite service account  
**Authentication:** Uses your existing `SERVICE_ACCOUNT_JSON_PATH` credentials  
**Impact:** 3 notification points in workflow

---

## Setup Steps

### Step 1: Identify Your Google Chat Space ID

1. **Open Google Chat**
   - Go to https://mail.google.com/chat/u/0
   - Create or select a space: "SmartSites Maintenance Reports"

2. **Get the Space ID**
   - Open the space
   - Look at the URL: `https://mail.google.com/chat/u/0/#chat/space/AAAAAAAAAAA`
   - Copy the ID after `space/` (e.g., `AAAAAAAAAAA`)

### Step 2: Enable Google Chat API

1. **Google Cloud Console**
   - Go to https://console.cloud.google.com
   - Select the same project as your service account
   - Go to "APIs & Services" → "Library"
   - Search for "Google Chat API"
   - Click "Enable"

2. **Service Account Permissions**
   - Go to "APIs & Services" → "Credentials"
   - Click your service account
   - Ensure it has Chat API access (should be automatic after enabling)

### Step 3: Configure .env

**File:** `.env`

Add your space ID:

```env
# Google Chat Configuration (uses GSuite service account)
GOOGLE_CHAT_SPACE_ID=spaces/AAAAAAAAAAA
GOOGLE_CHAT_ENABLED=true
```

Replace `AAAAAAAAAAA` with your actual space ID from Step 1.

### Step 3: Test the Integration

```bash
# Test all message types (info, success, warning, error)
python test_google_chat.py

# Expected output:
# ✅ INFO message sent successfully
# ✅ SUCCESS message sent successfully
# ✅ WARNING message sent successfully
# ✅ ERROR message sent successfully
# ✅ All tests passed! Google Chat integration is working.
```

---

## Files Added/Modified

### New Files

- **`send_to_chat.py`** — Sends formatted messages to Google Chat via webhook
  - Usage: `python send_to_chat.py --webhook-url "..." --title "..." --body "..." --status "success"`
  - Status types: `info`, `success`, `warning`, `error`
  - Returns: JSON with `sent: true/false` and details

- **`test_google_chat.py`** — Test suite for Google Chat integration
  - Verifies webhook connectivity
  - Tests all message types
  - Usage: `python test_google_chat.py`

### Modified Files

- **`.env`** — Added Google Chat webhook configuration
  - `GOOGLE_CHAT_WEBHOOK_URL` — Webhook URL from Google Chat space
  - `GOOGLE_CHAT_ENABLED` — Toggle for Google Chat (future: parallel email+chat)

- **`.claude/workflows/daily-maintenance.js`** — PENDING (to be updated)
  - Replace `send_email.py` calls with `send_to_chat.py`
  - 3 notification points: plugin update, site report, daily summary

---

## Workflow Notification Points

### 1. Plugin Update Report
**Current:** Email after plugin batch job completes  
**New:** Google Chat message with update summary

**Example message:**
```
🔧 Plugin Updates Complete
Site: thermalspray.com
Status: SUCCESS
Plugins Updated: 10
Backup Created: bkp_2026_09_01_xyz
Health Check: PASSED
```

### 2. Site Maintenance Report
**Current:** Email after all site steps complete  
**New:** Google Chat message with full site status

**Example message:**
```
✅ Site Maintenance Complete
Site: thermalspray.com
Updates Applied: 10 plugins + core
Final Health: PASSED
Synced to Sheet: YES
```

### 3. Daily Summary Report
**Current:** Email at end of day with all sites  
**New:** Google Chat message with daily stats

**Example message:**
```
📊 Daily Maintenance Summary
Date: Tuesday, Sept 1, 2026
Total Sites: 2
Completed: 2
Failed: 0
Success Rate: 100%
```

---

## Message Format

Google Chat messages use **Card format** (rich formatting):

- **Header** — Title, subtitle, icon
- **Body** — Formatted text with status indicator
- **Actions** — Quick link to Pegasus dashboard
- **Color** — Status-based (green=success, orange=warning, red=error)

---

## Parallel Approach: Email + Google Chat

**Option:** Keep email AND add Google Chat (during transition)

```python
# In workflow:
# Send to email (existing)
send_email.py ...

# Send to Google Chat (new)
send_to_chat.py ...
```

**Benefits:**
- ✅ Gradual migration (no breaking changes)
- ✅ Verify Google Chat works before removing email
- ✅ Team sees notifications in both channels

**Duration:** 1-2 weeks of parallel sending, then remove email

---

## Migration Timeline

### Phase 1: Setup (Today)
- [ ] Create Google Chat space
- [ ] Generate webhook URL
- [ ] Add webhook to `.env`
- [ ] Test with `test_google_chat.py`

### Phase 2: Workflow Update (Next)
- [ ] Update workflow to call `send_to_chat.py`
- [ ] Keep email calls (parallel mode)
- [ ] Test one full maintenance run
- [ ] Monitor Google Chat messages

### Phase 3: Validation (1 week)
- [ ] Run 3-5 full cycles with parallel notifications
- [ ] Confirm Google Chat messages arrive consistently
- [ ] Check message formatting and clarity
- [ ] Gather feedback from team

### Phase 4: Email Removal (Optional)
- [ ] Remove email calls from workflow
- [ ] Remove SMTP configuration (if not needed elsewhere)
- [ ] Update documentation

---

## Troubleshooting

### "❌ No webhook URL configured"

**Issue:** `GOOGLE_CHAT_WEBHOOK_URL` not in `.env`

**Fix:**
1. Get webhook URL from Google Chat space settings
2. Add to `.env`: `GOOGLE_CHAT_WEBHOOK_URL=https://chat.googleapis.com/...`
3. Save and retry

### "❌ Google Chat API returned status 403"

**Issue:** Webhook URL is invalid or permission denied

**Fix:**
1. Verify webhook URL is complete (includes key and token)
2. Recreate webhook in Google Chat if needed
3. Check space permissions (bot must have access)

### "❌ Request timeout"

**Issue:** Google Chat server not responding

**Fix:**
1. Check network connectivity
2. Verify webhook URL is correct
3. Try again (may be temporary outage)

### Message not appearing in space

**Issue:** Webhook might be pointing to wrong space or disabled

**Fix:**
1. Verify webhook was created in correct space
2. Check space for webhook in "Apps & integrations"
3. Recreate webhook if needed

---

## API Reference

### send_to_chat.py

```bash
python send_to_chat.py \
  --space-id "spaces/AAAAAAAAAAA" \
  --title "Update Complete" \
  --body "10 plugins updated successfully" \
  --status "success"
```

**Parameters:**
- `--space-id` — Google Chat space ID (e.g., `spaces/AAAAAAAAAAA`), or use `GOOGLE_CHAT_SPACE_ID` from `.env`
- `--title` — Message heading (required)
- `--body` — Message body text (required)
- `--status` — Message type: `info` | `success` | `warning` | `error` (default: info)

**Returns:**
```json
{
  "sent": true,
  "message": "Message sent successfully to Google Chat",
  "message_id": "spaces/AAAAAAAAAAA/messages/BBBBBBBBBBB",
  "title": "Update Complete"
}
```

---

## Security Notes

✅ **Secure approach using service account:**
- Uses your existing GSuite service account credentials
- No separate webhook URLs to manage
- Credentials already in `.env` which is in `.gitignore`
- Service account scoped to Chat API only
- All authentication through Google OAuth 2.0

---

## Next Steps

1. **Set up webhook** — Follow Step 1 above
2. **Configure .env** — Add `GOOGLE_CHAT_WEBHOOK_URL`
3. **Test** — Run `python test_google_chat.py`
4. **Notify:** Confirm with team and schedule workflow update

---

## Questions?

Check:
- Google Chat space settings (Apps & integrations)
- `.env` configuration (GOOGLE_CHAT_WEBHOOK_URL set?)
- Test output (`python test_google_chat.py`)
- Message format in Google Chat space (appears correctly?)

---

**Ready to migrate? Let's update the workflow next.**
