'use strict';
/*
 * Standalone «Transfer Photo <Month> <Year>» folder creator.
 *
 * Builds the SAME folders the in-app monthly cron builds, but meant to run
 * OUTSIDE the Railway server (e.g. from GitHub Actions on a schedule) so the
 * folders still get created even when Railway is shut down.
 *
 * Reuses the exact in-app logic (csTransferFolders → googleDrive), which only
 * talks to Google Drive — no database, no Express, no server boot.
 *
 * Required env (set as GitHub Actions secrets):
 *   GOOGLE_CREDENTIALS_JSON   — the service-account JSON (same value as Railway)
 *   DRIVE_ROOT_FOLDER_ID      — the Drive root folder id (same value as Railway)
 * Optional:
 *   DRIVE_PREP_FOLDERS_TZ     — timezone for the month calc (default Africa/Cairo)
 *
 * Idempotent: every folder goes through getOrCreateFolder, so re-runs and
 * hand-made folders are left untouched. Exits 1 on failure so the Action turns red.
 */
const transferFolders = require('../src/services/csTransferFolders.service');

const TZ = process.env.DRIVE_PREP_FOLDERS_TZ || 'Africa/Cairo';

(async () => {
  if (!process.env.GOOGLE_CREDENTIALS_JSON) { console.error('FAILED: GOOGLE_CREDENTIALS_JSON not set'); process.exit(1); }
  if (!process.env.DRIVE_ROOT_FOLDER_ID)    { console.error('FAILED: DRIVE_ROOT_FOLDER_ID not set');    process.exit(1); }
  try {
    // Build the CURRENT month (catch-up) and the NEXT month, same as the server's
    // boot/cron. Existing folders are a no-op.
    for (const [offset, label] of [[0, 'current month'], [1, 'next month']]) {
      const r = await transferFolders.prepareRelativeMonth(offset, TZ);
      console.log(`Transfer folders (${label}) — ${r.month}: created=${r.created} existing=${r.existed}`);
    }
    console.log('DONE');
    process.exit(0);
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exit(1);
  }
})();
