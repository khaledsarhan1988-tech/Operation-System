'use strict';

/**
 * cs_* — Ingestion of per-level "completed clients" Excel files from Drive.
 *
 * Drive structure:
 *   Customer subscription to groups/
 *     ├── A-H Genaral/           ← General customers
 *     │     ├── Starter 2.xlsx, Starter 3.xlsx
 *     │     ├── General 1..5.xlsx
 *     │     └── CON 1..5.xlsx
 *     ├── A-H Private/           ← Private customers
 *     └── Private 2 in 1/        ← Semi-Private customers
 *
 * Each Excel sheet has columns (header row 1):
 *   #, العميل, المُعرف, معلومات التواصل, المجموعة, تاريخ التسجيل
 *
 * Business rules:
 *   - File NAME determines the level (not the group text inside).
 *   - Phone is the only reliable client identifier (Arabic names can be OCR-garbled).
 *   - One row in source = one row in cs_completed_levels.
 *   - UNIQUE(client_phone_norm, track, level_number) prevents duplicates.
 *   - Dept comes from the parent FOLDER name, NOT from group text.
 */

const XLSX = require('xlsx');
const db = require('../config/database');
const { saveNow } = require('../config/database');
const drive = require('./googleDrive.service');
const { csPrimaryPhone } = require('../utils/csPhoneNormalize');
const { parseFileName, orderOf } = require('../utils/csLevelOrder');
const { matchClientByPhone } = require('./csIngestMembership.service');
const { canonKey, slotKey } = require('../utils/csBatchMatch');

const ROOT_SUBFOLDER = 'Customer subscription to groups';

// Department folder name → canonical dept
const DEPT_FOLDERS = {
  'A-H Genaral':    'General',  // typo preserved — folder is named this way on Drive
  'A-H General':    'General',  // accept the corrected spelling too
  'A-H Private':    'Private',
  'Private 2 in 1': 'Semi',
};

// ─── Drive lookups ────────────────────────────────────────────────────────────

async function findDeptFolders({ lineFolderName = 'Ahmed Hassan' } = {}) {
  const rootId = drive.getRootFolderId();
  const lineFolder = await drive.findFolderByName(rootId, lineFolderName);
  if (!lineFolder) throw new Error(`Line folder "${lineFolderName}" not found`);

  const subFolder = await drive.findFolderByName(lineFolder.id, ROOT_SUBFOLDER);
  if (!subFolder) throw new Error(`Folder "${ROOT_SUBFOLDER}" not found inside "${lineFolderName}"`);

  const found = [];
  for (const [folderName, dept] of Object.entries(DEPT_FOLDERS)) {
    const f = await drive.findFolderByName(subFolder.id, folderName);
    if (f) found.push({ folderName, dept, id: f.id });
  }
  if (!found.length) {
    throw new Error(`No dept folders (A-H Genaral / A-H Private / Private 2 in 1) found`);
  }
  return found;
}

// ─── All Batches reference ingest ──────────────────────────────────────────────
// The "All Batches …" Excel lives directly inside the "Customer subscription to
// groups" folder (same folder whose subfolders hold the level files). It lists
// EVERY group (نشطة / إنتهت / منتظرة) — the reference for "did this group really
// exist". We mirror it into cs_all_batches_ref with canon_key + slot_key each sync.
async function findCustomerSubFolderId({ lineFolderName = 'Ahmed Hassan' } = {}) {
  const rootId = drive.getRootFolderId();
  const lineFolder = await drive.findFolderByName(rootId, lineFolderName);
  if (!lineFolder) throw new Error(`Line folder "${lineFolderName}" not found`);
  const subFolder = await drive.findFolderByName(lineFolder.id, ROOT_SUBFOLDER);
  if (!subFolder) throw new Error(`Folder "${ROOT_SUBFOLDER}" not found inside "${lineFolderName}"`);
  return subFolder.id;
}

function parseAllBatchesBuffer(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
  // Locate columns by header (المجموعة / الحالة / المدرب); fall back to known layout.
  let ci = { group: 1, status: 3, trainer: 4 }, hdr = 0;
  for (let i = 0; i < Math.min(6, aoa.length); i++) {
    const cells = (aoa[i] || []).map(c => String(c || '').trim());
    const gi = cells.findIndex(c => /مجموع/.test(c));
    if (gi >= 0) { hdr = i; ci = { group: gi, status: cells.findIndex(c => /حال/.test(c)), trainer: cells.findIndex(c => /مدرب|مدرّب/.test(c)) }; break; }
  }
  const out = [];
  for (let i = hdr + 1; i < aoa.length; i++) {
    const nm = ci.group >= 0 ? aoa[i][ci.group] : '';
    if (!nm || !String(nm).trim()) continue;
    out.push({
      group: String(nm),
      status: ci.status >= 0 ? String(aoa[i][ci.status] || '') : '',
      trainer: ci.trainer >= 0 ? String(aoa[i][ci.trainer] || '') : '',
    });
  }
  return out;
}

async function ingestAllBatchesRef({ lineFolderName = 'Ahmed Hassan' } = {}) {
  const subId = await findCustomerSubFolderId({ lineFolderName });
  const files = await drive.listFilesInFolder(subId);
  const cands = files.filter(f => /all\s*batches/i.test(f.name) && /\.xlsx?$/i.test(f.name));
  if (!cands.length) throw new Error('No "All Batches" file found in the Customer subscription folder');
  // latest by modifiedTime (falls back to name order)
  const file = cands.sort((a, b) => String(b.modifiedTime || b.name).localeCompare(String(a.modifiedTime || a.name)))[0];
  const buf = await drive.downloadFile(file.id);
  const rows = parseAllBatchesBuffer(buf);

  const now = nowCairo();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM cs_all_batches_ref').run();
    const ins = db.prepare(`INSERT INTO cs_all_batches_ref
      (group_name_raw, status, trainer_col, canon_key, slot_key, source_file, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const r of rows) ins.run(r.group, r.status || null, r.trainer || null, canonKey(r.group), slotKey(r.group), file.name, now);
  });
  tx();
  saveNow();
  return { file: file.name, rows: rows.length };
}

// ─── Excel parsing ────────────────────────────────────────────────────────────

/**
 * Parse a single level Excel buffer.
 *
 * Returns:
 *   [{ rowNo, phoneRaw, name, idCode, groupRaw, regDate }, ...]
 *
 * Tolerant header matching: Arabic / English; first cell often empty.
 */
function parseLevelBuffer(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });

  if (!aoa.length) return { sheetName, rows: [] };

  // Find header row — try first 5 rows looking for at least 4 of the expected labels.
  const expected = [
    /\bclient\b|عميل|اسم/i,
    /phone|mobile|تواصل|موبيل|معلومات/i,
    /group|مجموع|جروب/i,
    /(reg|تسجيل|تاريخ)/i,
    /(id|معرف|كود)/i,
  ];

  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(5, aoa.length); i++) {
    const cells = (aoa[i] || []).map(c => String(c || '').toLowerCase());
    const matchCount = expected.filter(re => cells.some(c => re.test(c))).length;
    if (matchCount >= 3) { headerRowIdx = i; break; }
  }

  // Arabic diacritics (tashkeel) break substring matching — strip them.
  const stripDiacritics = (s) => String(s || '').replace(/[ً-ٰٟ]/g, '');
  const header = aoa[headerRowIdx].map(h => stripDiacritics(h).toLowerCase().trim());
  const findIdx = (re) => header.findIndex(h => re.test(h));

  const idxName    = findIdx(/client|عميل|اسم/);
  const idxId      = findIdx(/معرف|id\b|hq|كود/);
  const idxPhone   = findIdx(/phone|mobile|تواصل|موبيل|معلومات/);
  const idxGroup   = findIdx(/group|مجموع|جروب/);
  const idxRegDate = findIdx(/reg|تسجيل|تاريخ/);

  const out = [];
  for (let i = headerRowIdx + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    const name     = idxName    >= 0 ? String(r[idxName]    || '').trim() : '';
    const idCode   = idxId      >= 0 ? String(r[idxId]      || '').trim() : '';
    const phoneRaw = idxPhone   >= 0 ? String(r[idxPhone]   || '').trim() : '';
    const groupRaw = idxGroup   >= 0 ? String(r[idxGroup]   || '').trim() : '';
    const regDate  = idxRegDate >= 0 ? String(r[idxRegDate] || '').trim() : '';

    if (!name && !phoneRaw && !idCode) continue;
    out.push({ rowNo: i + 1, name, idCode, phoneRaw, groupRaw, regDate });
  }
  return { sheetName, rows: out };
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

// Identity is now the GROUP (group_key = canonKey), so a client who REPEATS a
// level in two different groups gets two rows (both counted). Rename-twins (same
// group, different coordinator suffix → same key) still collapse. Rows without a
// group name fall back to a track+level key so they dedupe as before.
const _upsertLevelStmt = () => db.prepare(`
  INSERT INTO cs_completed_levels (
    client_id, client_phone_norm, client_name_raw,
    track, level_number, level_order,
    drive_file_id, drive_file_name, drive_folder, dept,
    group_name_raw, group_key, registration_date, synced_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(client_phone_norm, track, level_number, group_key) DO UPDATE SET
    client_id         = excluded.client_id,
    client_name_raw   = COALESCE(excluded.client_name_raw, client_name_raw),
    level_order       = excluded.level_order,
    drive_file_id     = excluded.drive_file_id,
    drive_file_name   = excluded.drive_file_name,
    drive_folder      = excluded.drive_folder,
    dept              = excluded.dept,
    group_name_raw    = COALESCE(excluded.group_name_raw, group_name_raw),
    registration_date = COALESCE(excluded.registration_date, registration_date),
    synced_at         = excluded.synced_at
`);

function nowCairo() {
  return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Normalize a date cell into YYYY-MM-DD if possible. Handles:
 *   "2024-01-14"
 *   "14/01/2024"
 *   Excel serial (number)
 *   Falls back to original string if unparseable.
 */
function normalizeDate(v) {
  if (v == null || v === '') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) {
    const [d, m, y] = v.split('/').map(n => parseInt(n, 10));
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  // Excel serial number (days since 1900-01-01) — XLSX returns these as strings in cellDates:false mode
  if (/^\d+$/.test(String(v).trim())) {
    const n = parseInt(v, 10);
    if (n > 30000 && n < 60000) {
      const ms = (n - 25569) * 86400 * 1000;
      const d = new Date(ms);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    }
  }
  return String(v);
}

// ─── Main ingestion entry ─────────────────────────────────────────────────────

/**
 * Ingest one Drive level file. Returns { file, level, dept, inserted, skipped }.
 */
async function ingestOneFile({ file, folderName, dept }) {
  const parsed = parseFileName(file.name);
  if (!parsed) {
    return { file: file.name, level: null, dept, inserted: 0, skipped_no_level: true, error: 'Unrecognized level filename' };
  }

  const buf = await drive.downloadFile(file.id);
  const { rows } = parseLevelBuffer(buf);

  const stmt = _upsertLevelStmt();
  const now = nowCairo();
  let inserted = 0, skippedNoPhone = 0;

  for (const r of rows) {
    const phoneNorm = csPrimaryPhone(r.phoneRaw);
    if (!phoneNorm) { skippedNoPhone++; continue; }

    const clientId = matchClientByPhone(phoneNorm);
    const gKey = canonKey(r.groupRaw) || `${parsed.track}-${parsed.level}`.toLowerCase();
    stmt.run(
      clientId, phoneNorm, r.name || null,
      parsed.track, parsed.level, parsed.order,
      file.id, file.name, folderName, dept,
      r.groupRaw || null, gKey, normalizeDate(r.regDate),
      now,
    );
    inserted++;
  }

  return {
    file: file.name,
    level: `${parsed.track} ${parsed.level}`,
    level_order: parsed.order,
    dept,
    folder: folderName,
    rows_in_sheet: rows.length,
    inserted,
    skipped_no_phone: skippedNoPhone,
  };
}

/**
 * Walk all dept folders, all level files, ingest each.
 *
 * Options:
 *   - lineFolderName: 'Ahmed Hassan' (default)
 *   - onlyDept: 'General' | 'Private' | 'Semi' (optional)
 *   - dryRun: false (default)
 *
 * Returns a summary: { folders: [{ folderName, dept, files: [...] }], duration_ms }
 */
async function runIngestionAll({ lineFolderName = 'Ahmed Hassan', onlyDept = null, dryRun = false } = {}) {
  const t0 = Date.now();
  const deptFolders = await findDeptFolders({ lineFolderName });
  const result = { folders: [], total_files: 0, total_inserted: 0, total_skipped: 0, dry_run: dryRun };

  for (const df of deptFolders) {
    if (onlyDept && df.dept !== onlyDept) continue;

    // Files directly in the dept folder + one level of subfolders — some dept
    // folders nest everything in a same-named child (e.g. "Private 2 in 1/
    // Private 2 in 1/P General 4.xlsx"), which made the whole dept ingest 0 rows.
    const allFiles = await drive.listFilesInFolder(df.id);
    try {
      for (const sub of await drive.listSubfoldersInFolder(df.id)) {
        allFiles.push(...await drive.listFilesInFolder(sub.id));
      }
    } catch (e) {
      console.error(`cs-levels: subfolder listing failed for "${df.folderName}":`, e.message);
    }
    const xlsxFiles = allFiles.filter(f => /\.xlsx?$/i.test(f.name));

    const folderResult = { folderName: df.folderName, dept: df.dept, files: [] };

    for (const f of xlsxFiles) {
      try {
        if (dryRun) {
          const parsed = parseFileName(f.name);
          folderResult.files.push({
            file: f.name,
            level: parsed ? `${parsed.track} ${parsed.level}` : null,
            level_order: parsed?.order || null,
            recognized: !!parsed,
          });
        } else {
          const r = await ingestOneFile({ file: f, folderName: df.folderName, dept: df.dept });
          folderResult.files.push(r);
          result.total_files++;
          result.total_inserted += (r.inserted || 0);
          result.total_skipped  += (r.skipped_no_phone || 0);
        }
      } catch (e) {
        folderResult.files.push({ file: f.name, error: e.message });
      }
    }
    result.folders.push(folderResult);
  }

  // Refresh the All-Batches reference from the same Customer-subscription folder
  // (best-effort — a failure here must NOT fail the level ingest).
  if (!dryRun) {
    try {
      result.all_batches_ref = await ingestAllBatchesRef({ lineFolderName });
    } catch (e) {
      console.error('cs-levels: All Batches ref ingest failed:', e.message);
      result.all_batches_ref = { error: e.message };
    }
    // One-time membership-history backfill (local seed + Drive daily-files walk).
    // FIRE-AND-FORGET: the Drive walk can take several minutes and the browser
    // aborts at 60s (owner saw a scary ❌ although the server kept going —
    // 2026-07-15). The button returns immediately; progress lands in the logs.
    // No-op once done; ongoing coverage comes from the daily trainees sync hook.
    try {
      require('./csClientGroupHistory.service').ensureBackfilled()
        .then(r => console.log('[groupHistory] backfill:', JSON.stringify(r)))
        .catch(e => console.error('[groupHistory] backfill failed:', e.message));
      result.group_history = { started_in_background: true };
    } catch (e) {
      console.error('cs-levels: group-history backfill failed:', e.message);
      result.group_history = { error: e.message };
    }
  }

  if (!dryRun) saveNow();
  result.duration_ms = Date.now() - t0;
  return result;
}

module.exports = {
  runIngestionAll,
  ingestOneFile,
  parseLevelBuffer,
  findDeptFolders,
  normalizeDate,
  ingestAllBatchesRef,
  parseAllBatchesBuffer,
};
