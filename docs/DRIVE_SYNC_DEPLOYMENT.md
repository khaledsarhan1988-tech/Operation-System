# Google Drive Sync — Production Deployment Guide

This guide covers deploying the Drive sync feature to Railway (backend) and ensuring it works in production.

---

## 1. Environment Variables (Railway)

Add these three env vars to the Railway backend service (Settings → Variables):

### Required

| Variable | Value | Notes |
|---|---|---|
| `GOOGLE_CREDENTIALS_JSON` | Full JSON content of `credentials.json` (one line) | Paste the entire JSON file content. Single value, no quotes around the whole thing. |
| `DRIVE_ROOT_FOLDER_ID` | `1_1fV1TmaTI-JenXDqa-A_2fsBKkboSLr` | The Drive folder ID for Quality_System_Data. |

### Optional — auto-sync controls (disabled by default)

| Variable | Default | Notes |
|---|---|---|
| `DRIVE_AUTO_SYNC_ENABLED` | _(unset = off)_ | Set to `1` to enable hourly auto-sync. Leave unset until manual sync is proven. |
| `DRIVE_AUTO_SYNC_CRON` | `0 */1 * * *` (top of every hour) | Standard cron expression. Examples: `*/15 * * * *` (every 15 min), `0 8-22 * * *` (hourly 8 AM–10 PM). |
| `DRIVE_AUTO_SYNC_TZ` | `Africa/Cairo` | IANA timezone for the cron schedule. |

---

## 2. How to paste `GOOGLE_CREDENTIALS_JSON` into Railway

The credentials.json contains newlines inside the private_key field — Railway handles this fine, but you need to paste the full file content as a single env var value:

1. Open `credentials.json` in a text editor
2. Select all (Ctrl+A) and copy (Ctrl+C)
3. In Railway: Variables → New Variable
4. Name: `GOOGLE_CREDENTIALS_JSON`
5. Value: paste the entire JSON (it will look like one long blob with `\n` escapes — this is correct)
6. Save

The backend's `googleDrive.service.js` calls `JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)` and handles the embedded newlines automatically.

---

## 3. Verify Service Account access

Before deploy, ensure the service account email has Editor access on the Drive folder:

- Email: `quality-sync@quality-system-492316.iam.gserviceaccount.com`
- Folder: `Quality_System_Data` (ID above)
- Role: **Editor**

The Quality team's accounts also need access (Editor) to upload files — they upload in their own Google account; the service account only reads.

---

## 4. Deployment Steps

### First-time deploy

1. **Commit code** to your main branch (drive.routes.js, googleDrive.service.js, driveSync.service.js, DriveSync.jsx, etc.).
   - Verify `.gitignore` excludes `credentials.json` and `drive-folders.json` — run `git status` to confirm neither appears as a tracked file.
2. **Push to GitHub** → Railway auto-deploys the backend.
3. **Add env vars** in Railway (Section 1 above). The first two are required even without auto-sync.
4. **Restart** the Railway service so the new env vars are loaded.
5. **Verify** logs include:
   ```
   ✅ Migration: drive_sync_runs ready
   ☁️  Drive auto-sync cron disabled (set DRIVE_AUTO_SYNC_ENABLED=1 to enable).
   ```

### Enabling auto-sync (after manual sync is verified)

1. In Railway, add `DRIVE_AUTO_SYNC_ENABLED=1`
2. Optionally tune `DRIVE_AUTO_SYNC_CRON` (default = every hour)
3. Restart the service. Logs should now show:
   ```
   ⏰ Drive auto-sync cron scheduled (0 */1 * * *, Africa/Cairo)
   ```

---

## 5. Smoke Test (Production)

After deploy:

### From the admin UI

1. Open `https://<your-frontend-url>/admin/drive-sync`
2. Status banner should be green: "Connected to Google Drive"
3. Click **Preview Available Files** — should list whatever's in Drive for today
4. If files exist, click **Sync Now** — verify rows imported in DB

### From a terminal (Railway logs / curl)

```bash
# Replace <TOKEN> with a valid admin access token
curl -H "Authorization: Bearer <TOKEN>" \
  https://operation-system-production.up.railway.app/api/drive/status
```

Expected:
```json
{
  "connected": true,
  "rootFolder": { "id": "1_1fV1...", "name": "Quality_System_Data" },
  ...
}
```

### Verify auto-sync (after enabling)

```bash
curl -H "Authorization: Bearer <TOKEN>" \
  "https://operation-system-production.up.railway.app/api/drive/sync-runs?limit=10"
```

Each entry shows: trigger (cron/manual), status, totals, error if any.

---

## 6. Routes Reference

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/drive/status` | leader+ | Verify connection |
| GET | `/api/drive/files?line=X&date=Y` | leader+ | Preview files for a day |
| POST | `/api/drive/sync` | leader+ | Import files for a (line, date) |
| POST | `/api/drive/sync-today` | leader+ | Import today's files for all lines |
| POST | `/api/drive/run-auto-now` | admin | Trigger the cron job manually (testing) |
| GET | `/api/drive/sync-runs?limit=N` | leader+ | List recent auto-sync runs |
| GET | `/api/drive/sync-runs/:id` | leader+ | Full details for one run |

---

## 7. Troubleshooting

### "Drive root folder ID not configured"
→ `DRIVE_ROOT_FOLDER_ID` not set in Railway env. Add it and restart.

### "Google credentials not found"
→ `GOOGLE_CREDENTIALS_JSON` missing or malformed. Re-paste the entire JSON file content.

### "File not found" or 404 from Drive
→ Service account doesn't have access to the folder. Verify the share at the email `quality-sync@quality-system-492316.iam.gserviceaccount.com`.

### Sync returns `skipped: folder_empty` for everything
→ Team hasn't uploaded files yet for that day, OR the date you queried is wrong, OR the file type folder names on Drive don't match exactly. See folder mapping in `googleDrive.service.js` (`FILE_TYPE_FOLDERS`).

### Cron didn't run
→ Check Railway logs for `⏰ Drive auto-sync cron scheduled`. If absent, `DRIVE_AUTO_SYNC_ENABLED` is not `1`, OR the cron expression is invalid.

---

## 8. Rotating the service-account key

If the credentials.json is ever leaked (committed, posted, etc.):

1. Go to Google Cloud Console → IAM & Admin → Service Accounts
2. Find `quality-sync@quality-system-492316.iam.gserviceaccount.com`
3. Keys tab → delete the leaked key
4. Create a new key (JSON) → download
5. Update `GOOGLE_CREDENTIALS_JSON` in Railway with the new content
6. Restart the service

The Drive folder share does NOT need to be re-done — the service account identity is unchanged.

---

## 9. Coexistence with Manual Upload

The Drive sync is **additive**. The existing manual upload at `/admin/upload` continues to work unchanged. Users can use either method:

- **Manual upload** (`ExcelUpload.jsx`): pick a file from your computer, upload directly.
- **Drive sync** (`DriveSync.jsx`): pull from Drive without local file handling.

Removal of the manual upload UI is a separate, user-approved step — not part of this deployment.
