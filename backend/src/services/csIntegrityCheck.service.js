'use strict';

/**
 * Daily client-number integrity watch (owner 2026-07-24).
 *
 * Cleaning ~800 mismatched clients by hand once was worth it; doing it again in
 * six months is not. This runs every day over data that appeared ON OR AFTER the
 * cutoff and records any client sitting in a group without a matching membership
 * in كشف العملاء — so a mistyped number surfaces the next morning instead of
 * after it has spread across a dozen groups.
 *
 * Three sources, and the check is deliberately NOT image-first:
 *   1. clients            ← Active Batches Trainees (the group side)
 *   2. cs_sales_register  ← كشف العملاء (the membership side)
 *   3. the transfer photo ← evidence, when one exists
 * A client with a wrong number and NO receipt still gets caught, because 1↔2 is
 * the primary check. The image is a confirmation layer on top.
 *
 * On images: the server cannot READ a number out of a photo — that needs vision.
 * What it CAN do is ask Drive "does an image in this month contain this number?"
 * (Drive OCRs uploads and exposes it to fullText search). So the job confirms an
 * expected number and flags what it cannot confirm; a human reads the few that
 * are flagged. That division is why this stays cheap enough to run daily.
 *
 * Findings auto-resolve: anything no longer mismatched in the live data is
 * closed on the next run, so the open list always describes the present.
 */

const db = require('../config/database');
const { saveNow } = require('../config/database');
const unreg = require('./csUnregisteredClients.service');

const IMAGE_LINE = 'Ahmed Hassan';
const IMAGE_ROOT = 'Customer transfer photos';

/** Findings we care about: a real client (not staff) first seen after the cutoff. */
function isWatchable(item) {
  return !item.is_legacy && item.category !== 'staff';
}

/**
 * One pass: refresh findings from the live data.
 * - new mismatch      → inserted as `open`
 * - still mismatched  → last_checked_at bumped, live fields refreshed
 * - no longer listed  → auto-resolved (someone fixed the number)
 * Manual `ignored` rows are never reopened or auto-resolved.
 */
function runCheck() {
  const live = unreg.getUnregisteredClients();
  const watch = live.items.filter(isWatchable);
  const livePhones = new Set(watch.map(i => i.phone));

  const existing = new Map(
    db.prepare(`SELECT client_phone_norm, status FROM cs_integrity_findings`).all()
      .map(r => [r.client_phone_norm, r.status])
  );

  const ins = db.prepare(`
    INSERT INTO cs_integrity_findings
      (client_phone_norm, client_name, category, first_seen, groups_count, groups_sample,
       evidence, image_check, last_checked_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now','+2 hours'), 'open')
    ON CONFLICT(client_phone_norm) DO UPDATE SET
      client_name     = excluded.client_name,
      category        = excluded.category,
      groups_count    = excluded.groups_count,
      groups_sample   = excluded.groups_sample,
      evidence        = excluded.evidence,
      last_checked_at = excluded.last_checked_at,
      -- A row that was auto-resolved and has gone wrong AGAIN must reopen.
      -- 'ignored' is a human decision and stays put.
      status          = CASE WHEN cs_integrity_findings.status = 'ignored'
                             THEN 'ignored' ELSE 'open' END,
      resolved_at     = CASE WHEN cs_integrity_findings.status = 'ignored'
                             THEN cs_integrity_findings.resolved_at ELSE NULL END
  `);

  let added = 0, refreshed = 0;
  const tx = db.transaction(() => {
    for (const it of watch) {
      ins.run(it.phone, it.name || null, it.category, it.first_seen || null,
        it.groups_count || 0, (it.groups || []).slice(0, 3).join(' | '), it.evidence || null);
      if (existing.has(it.phone)) refreshed++; else added++;
    }
  });
  tx();

  // Auto-resolve: open rows whose client no longer mismatches.
  const stale = db.prepare(`SELECT client_phone_norm FROM cs_integrity_findings WHERE status = 'open'`)
    .all().map(r => r.client_phone_norm).filter(p => !livePhones.has(p));
  if (stale.length) {
    const res = db.prepare(`UPDATE cs_integrity_findings
      SET status='resolved', resolved_at=datetime('now','+2 hours') WHERE client_phone_norm = ?`);
    db.transaction(() => { for (const p of stale) res.run(p); })();
  }

  saveNow();
  return { scanned: live.items.length, watched: watch.length, added, refreshed, resolved: stale.length };
}

/**
 * Confirm open findings against the transfer photos: does ANY receipt image
 * contain this client's number? Drive-search only — no vision, no downloads.
 * `found` means a receipt carries the number the group data uses (so the group
 * side is probably right and كشف العملاء is the one to fix); `not_found` means
 * nothing backs that number up and a human should look.
 */
async function verifyImages({ limit = 40 } = {}) {
  const drive = require('./googleDrive.service');
  const rows = db.prepare(`
    SELECT client_phone_norm AS p FROM cs_integrity_findings
     WHERE status = 'open' AND (image_check IS NULL OR image_check = 'pending')
     ORDER BY detected_at DESC LIMIT ?`).all(limit);
  if (!rows.length) return { checked: 0, found: 0, notFound: 0 };

  const rootId = drive.getRootFolderId();
  const line = await drive.findFolderByName(rootId, IMAGE_LINE);
  if (!line) throw new Error(`Line folder "${IMAGE_LINE}" not found`);
  const transferRoot = await drive.findFolderByName(line.id, IMAGE_ROOT);
  if (!transferRoot) throw new Error(`Folder "${IMAGE_ROOT}" not found`);

  const client = drive.getDriveClient();
  const upd = db.prepare(`UPDATE cs_integrity_findings
    SET image_check = ?, image_file = ?, last_checked_at = datetime('now','+2 hours')
    WHERE client_phone_norm = ?`);

  let found = 0, notFound = 0;
  for (const { p } of rows) {
    // Egyptian numbers are written both with and without the leading zero, so
    // a single query would miss half the receipts.
    const variants = [p, p.replace(/^0/, '')].filter((v, i, a) => v && a.indexOf(v) === i);
    let hit = null;
    for (const v of variants) {
      const q = `fullText contains '${v.replace(/'/g, "\\'")}' and mimeType contains 'image/' and trashed = false`;
      const res = await client.files.list({
        q, fields: 'files(id, name)', pageSize: 3,
        supportsAllDrives: true, includeItemsFromAllDrives: true,
      });
      if (res.data.files && res.data.files.length) { hit = res.data.files[0]; break; }
    }
    if (hit) { upd.run('found', hit.name, p); found++; }
    else { upd.run('not_found', null, p); notFound++; }
  }
  saveNow();
  return { checked: rows.length, found, notFound };
}

/** Findings for the page. `weekOf` (YYYY-MM-DD) narrows to one week's detections. */
function getFindings({ status = 'open', weekOf = null } = {}) {
  const where = ['1=1'], args = [];
  if (status && status !== 'all') { where.push('status = ?'); args.push(status); }
  if (weekOf) { where.push("date(detected_at) >= date(?) AND date(detected_at) < date(?, '+7 days')"); args.push(weekOf, weekOf); }
  const items = db.prepare(`SELECT * FROM cs_integrity_findings
     WHERE ${where.join(' AND ')} ORDER BY detected_at DESC, groups_count DESC`).all(...args);
  const counts = db.prepare(`SELECT status, COUNT(*) c FROM cs_integrity_findings GROUP BY status`).all()
    .reduce((a, r) => (a[r.status] = r.c, a), { open: 0, resolved: 0, ignored: 0 });
  return { counts, items };
}

/** Weekly digest for the Saturday report — the last 7 days of detections. */
function weeklySummary() {
  const row = db.prepare(`
    SELECT COUNT(*) total,
           SUM(CASE WHEN status='open'     THEN 1 ELSE 0 END) still_open,
           SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) fixed,
           SUM(CASE WHEN image_check='not_found' AND status='open' THEN 1 ELSE 0 END) no_receipt
      FROM cs_integrity_findings
     WHERE date(detected_at) >= date('now','+2 hours','-7 days')`).get();
  return {
    week_ending: new Date().toISOString().slice(0, 10),
    detected: row.total || 0,
    still_open: row.still_open || 0,
    fixed: row.fixed || 0,
    no_receipt: row.no_receipt || 0,
  };
}

function setStatus({ phone, status, note, userName }) {
  if (!['open', 'resolved', 'ignored'].includes(status)) throw new Error('Invalid status');
  db.prepare(`UPDATE cs_integrity_findings
     SET status = ?, note = COALESCE(?, note), note_by = COALESCE(?, note_by),
         resolved_at = CASE WHEN ? = 'open' THEN NULL ELSE datetime('now','+2 hours') END
   WHERE client_phone_norm = ?`).run(status, note ?? null, userName ?? null, status, phone);
  saveNow();
  return { phone, status };
}

module.exports = { runCheck, verifyImages, getFindings, weeklySummary, setStatus, isWatchable };
