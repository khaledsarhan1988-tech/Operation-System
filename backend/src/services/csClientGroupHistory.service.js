'use strict';

/**
 * Cumulative client↔group membership history (cs_client_group_history).
 *
 * Why: the daily trainees sheet REPLACES `clients` every sync, and the
 * completed-levels Drive files stop at May 2026 — so a group that started
 * June+ and already ENDED disappeared from BOTH sources and its level was
 * counted nowhere (owner 2026-07-14, ≥432 clients under-counted).
 *
 * This service keeps a permanent memory of every (client, group) membership:
 *   - upsertRoster()        called on every daily trainees sync (never deletes)
 *   - backfillFromLocal()   seeds from the absence tables + current clients
 *   - backfillFromDrive()   walks the daily "Active Batches Trainees" files on
 *                           Drive (2026-06-01 → today) and upserts each roster
 *   - ensureBackfilled()    one-time orchestration, safe to call repeatedly
 *
 * Placement/تعويض placeholder groups are never stored. Rows are keyed by
 * (phone, canonKey) so name variants of one group stay a single membership.
 */

const db = require('../config/database');
const { saveNow } = require('../config/database');
const { csPrimaryPhone } = require('../utils/csPhoneNormalize');
const { canonKey } = require('../utils/csBatchMatch');
const { isIgnoredGroup } = require('../utils/csGroupHelpers');

const BACKFILL_FROM = '2026-06-01';   // daily Drive files start here (files before May live in the levels folder)

const _upsert = () => db.prepare(`
  INSERT INTO cs_client_group_history
    (client_phone_norm, client_name_raw, group_name_raw, group_key, line, source, first_seen, last_seen)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(client_phone_norm, group_key) DO UPDATE SET
    client_name_raw = COALESCE(excluded.client_name_raw, client_name_raw),
    group_name_raw  = CASE WHEN LENGTH(excluded.group_name_raw) > LENGTH(group_name_raw)
                           THEN excluded.group_name_raw ELSE group_name_raw END,
    line            = COALESCE(excluded.line, line),
    first_seen      = CASE WHEN excluded.first_seen < first_seen THEN excluded.first_seen ELSE first_seen END,
    last_seen       = CASE WHEN excluded.last_seen  > last_seen  THEN excluded.last_seen  ELSE last_seen  END
`);

/**
 * Upsert one roster snapshot. rows: [{ phone, name, group_name }].
 * seenDate: YYYY-MM-DD the roster was observed (defaults to today, Cairo).
 */
function upsertRoster(rows, { line = null, source = 'daily_sync', seenDate = null } = {}) {
  const day = seenDate || new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  const stmt = _upsert();
  let n = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const g = String(r.group_name || '').trim();
      if (!g || isIgnoredGroup(g)) continue;
      const pn = csPrimaryPhone(r.phone);
      if (!pn) continue;
      const gk = canonKey(g);
      if (!gk) continue;
      stmt.run(pn, r.name || null, g, gk, line, source, day, day);
      n++;
    }
  });
  tx();
  return n;
}

// Seed from data already in the DB: current clients roster + the accumulating
// absence tables (only clients who missed a lecture appear there — partial but
// reaches back before June). Idempotent.
function backfillFromLocal() {
  const out = {};
  out.clients_seed = upsertRoster(
    db.prepare(`SELECT name, phone, group_name, line FROM clients WHERE group_name IS NOT NULL`).all(),
    { source: 'clients_seed' },
  );
  for (const t of ['absent_students', 'absent_zoom_students']) {
    let n = 0;
    const stmt = _upsert();
    const rows = db.prepare(`
      SELECT phone, group_name, MIN(date) mn, MAX(date) mx, MAX(student_name) nm
        FROM ${t}
       WHERE phone IS NOT NULL AND group_name IS NOT NULL
       GROUP BY phone, group_name`).all();
    const tx = db.transaction(() => {
      for (const r of rows) {
        const g = String(r.group_name || '').trim();
        if (!g || isIgnoredGroup(g)) continue;
        const pn = csPrimaryPhone(r.phone);
        if (!pn) continue;
        const gk = canonKey(g);
        if (!gk) continue;
        stmt.run(pn, r.nm || null, g, gk, null, 'absence_backfill', r.mn || null, r.mx || r.mn || null);
        n++;
      }
    });
    tx();
    out[t] = n;
  }
  saveNow();
  return out;
}

/**
 * Walk the daily "Active Batches Trainees" files on Drive from `from` → `to`
 * and upsert each day's roster. Reuses the SAME parser as the daily sync.
 * Missing days/files are skipped silently (not every day has an upload).
 */
async function backfillFromDrive({ from = BACKFILL_FROM, to = null, lines = null } = {}) {
  const drive = require('./googleDrive.service');
  const excel = require('./excel.service');
  const endDay = to || new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  const lineList = lines
    || db.prepare(`SELECT DISTINCT line FROM clients WHERE line IS NOT NULL AND TRIM(line) <> ''`).all().map(r => r.line);
  if (!lineList.length) lineList.push('Ahmed Hassan');

  const out = { days_scanned: 0, files_found: 0, rows_upserted: 0, errors: [] };
  for (let d = new Date(from + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= endDay; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    out.days_scanned++;
    for (const line of lineList) {
      try {
        const files = await drive.getLatestFilesForDay(line, day);
        const f = files && files.trainees;
        if (!f) continue;
        out.files_found++;
        const buf = await drive.downloadFile(f.id);
        const rows = excel.parseTrainees(buf);
        out.rows_upserted += upsertRoster(rows, { line, source: 'drive_backfill', seenDate: day });
      } catch (e) {
        out.errors.push(`${day}/${line}: ${e.message}`);
      }
    }
  }
  saveNow();
  return out;
}

// One-time orchestration (safe to call on every ingest): seed local sources if
// the table is empty, and run the Drive walk once (marker = any drive_backfill row).
async function ensureBackfilled() {
  const out = {};
  const total = db.prepare(`SELECT COUNT(*) c FROM cs_client_group_history`).get().c;
  if (total === 0) out.local = backfillFromLocal();
  const hasDrive = db.prepare(`SELECT 1 FROM cs_client_group_history WHERE source='drive_backfill' LIMIT 1`).get();
  if (!hasDrive) out.drive = await backfillFromDrive({});
  out.total_rows = db.prepare(`SELECT COUNT(*) c FROM cs_client_group_history`).get().c;
  return out;
}

module.exports = { upsertRoster, backfillFromLocal, backfillFromDrive, ensureBackfilled, BACKFILL_FROM };
