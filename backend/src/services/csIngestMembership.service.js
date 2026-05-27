'use strict';

/**
 * cs_* — Ingestion of "Membership From Finance Department.xlsx" from Drive.
 *
 * File location: Customer subscription to groups/Membership From Finance Department.xlsx
 *   (one level inside the "Ahmed Hassan" line folder).
 *
 * Excel columns:
 *   A: Client Name
 *   B: Mobile No
 *   C: Courses          ← Arabic product string
 *
 * Business rules (user-confirmed 2026-05-27):
 *   - Start from row 1058 (Lobna Maher — 1098934993). Earlier rows already
 *     exist in Center App / are out of scope.
 *   - "9 Courses" / "Your American Day" / "Bussines Course" rows are IGNORED.
 *   - Each row → one cs_subscriptions row, source='excel_membership'.
 *
 * Idempotent — UNIQUE(source, source_ref) means re-running upserts in place.
 */

const XLSX = require('xlsx');
const db = require('../config/database');
const { saveNow } = require('../config/database');
const drive = require('./googleDrive.service');
const { csPrimaryPhone, csExtractAllPhones } = require('../utils/csPhoneNormalize');
const { parseCourseString } = require('../utils/csArabicParser');

const CUSTOMER_SUBSCRIPTION_FOLDER = 'Customer subscription to groups';
const MEMBERSHIP_FILE_PREFIX       = 'Membership From Finance Department';

// First row of "in-scope" data per the user — earlier rows already in Center App.
// 1-indexed for human comprehension; converted to 0-indexed when slicing arrays.
const START_ROW_1BASED  = 1058;
const HEADER_ROW_1BASED = 1;

// ─── Drive lookup ─────────────────────────────────────────────────────────────

async function findMembershipFile({ lineFolderName = 'Ahmed Hassan' } = {}) {
  const rootId = drive.getRootFolderId();
  const lineFolder = await drive.findFolderByName(rootId, lineFolderName);
  if (!lineFolder) throw new Error(`Line folder "${lineFolderName}" not found in Drive root`);

  const subFolder = await drive.findFolderByName(lineFolder.id, CUSTOMER_SUBSCRIPTION_FOLDER);
  if (!subFolder) throw new Error(`Folder "${CUSTOMER_SUBSCRIPTION_FOLDER}" not found inside "${lineFolderName}"`);

  const files = await drive.listFilesInFolder(subFolder.id);
  const candidates = files.filter(f =>
    /\.xlsx?$/i.test(f.name) && f.name.includes(MEMBERSHIP_FILE_PREFIX)
  );
  if (!candidates.length) {
    throw new Error(`No "${MEMBERSHIP_FILE_PREFIX}*.xlsx" file found in "${CUSTOMER_SUBSCRIPTION_FOLDER}"`);
  }
  // Latest first (listFilesInFolder sorts desc by effectiveModifiedTime)
  return { file: candidates[0], folderId: subFolder.id };
}

// ─── Excel parsing ────────────────────────────────────────────────────────────

/**
 * Parse the membership workbook buffer. Returns:
 *   { sheetName, totalRows, headerRow, rows: [{ rowNo, name, phoneRaw, courses }] }
 *
 * Header row is normalized — we accept "Client Name", "Mobile No", "Courses"
 * in any order (matched by header text).
 */
function parseMembershipBuffer(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });

  if (!rows.length) return { sheetName, totalRows: 0, headerRow: null, rows: [] };

  // Header row = first row. Build a column index map.
  const header = rows[0].map(h => String(h || '').toLowerCase().trim());
  const idxName    = header.findIndex(h => /client.*name|name|اسم|العميل/.test(h));
  const idxPhone   = header.findIndex(h => /mobile|phone|tel|رقم|موبيل/.test(h));
  const idxCourses = header.findIndex(h => /course|product|باقة|كورس/.test(h));

  if (idxName === -1 || idxPhone === -1 || idxCourses === -1) {
    throw new Error(`Expected columns Name/Mobile/Courses not found. Header: ${JSON.stringify(rows[0])}`);
  }

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const name     = String(r[idxName]    || '').trim();
    const phoneRaw = String(r[idxPhone]   || '').trim();
    const courses  = String(r[idxCourses] || '').trim();
    if (!name && !phoneRaw && !courses) continue;
    out.push({ rowNo: i + 1, name, phoneRaw, courses });
  }
  return { sheetName, totalRows: rows.length, headerRow: rows[0], rows: out };
}

// ─── Client matching (read-only on clients table) ─────────────────────────────

/**
 * Try to match an Excel row to an existing clients.id by phone (preferred).
 * Returns the id or null. NEVER writes to clients table.
 */
function matchClientByPhone(phoneNorm) {
  if (!phoneNorm) return null;
  // Try the normalized form against clients.phone using a flexible LIKE
  // that handles leading-zero variants ("01..." vs "1...").
  const stripped = phoneNorm.replace(/^0/, '');
  const row = db.prepare(`
    SELECT id FROM clients
     WHERE phone = ? OR phone = ? OR phone = ('0' || ?) OR phone LIKE ?
     LIMIT 1
  `).get(phoneNorm, stripped, stripped, `%${stripped}%`);
  return row ? row.id : null;
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

const _upsertSubStmt = () => db.prepare(`
  INSERT INTO cs_subscriptions (
    client_id, client_phone_raw, client_phone_norm, client_name_raw,
    source, source_ref, product_name_raw,
    dept, months, total_levels, is_installment,
    amount, currency, subscription_date,
    is_ignored, ignore_reason, notes,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source, source_ref) DO UPDATE SET
    client_id         = excluded.client_id,
    client_phone_raw  = excluded.client_phone_raw,
    client_phone_norm = excluded.client_phone_norm,
    client_name_raw   = excluded.client_name_raw,
    product_name_raw  = excluded.product_name_raw,
    dept              = excluded.dept,
    months            = excluded.months,
    total_levels      = excluded.total_levels,
    is_installment    = excluded.is_installment,
    is_ignored        = excluded.is_ignored,
    ignore_reason     = excluded.ignore_reason,
    updated_at        = excluded.updated_at
`);

function nowCairo() {
  return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Run the full ingestion pipeline.
 *
 * Options:
 *   - startRow: 1-based row number to begin processing (default 1058)
 *   - dryRun:   if true, parse & analyze but do NOT write to DB
 *   - lineFolderName: which line folder to look under (default 'Ahmed Hassan')
 *
 * Returns a structured summary.
 */
async function runIngestion({ startRow = START_ROW_1BASED, dryRun = false, lineFolderName = 'Ahmed Hassan' } = {}) {
  const t0 = Date.now();

  // 1) Locate and download the file from Drive
  const { file } = await findMembershipFile({ lineFolderName });
  const buf = await drive.downloadFile(file.id);

  // 2) Parse the workbook
  const parsed = parseMembershipBuffer(buf);

  // 3) Slice to the in-scope window (startRow .. end)
  const inScope = parsed.rows.filter(r => r.rowNo >= startRow);

  let inserted = 0, updated = 0, ignored = 0, unparsed = 0, matched = 0, unmatched = 0;
  const stmt = _upsertSubStmt();
  const now = nowCairo();

  for (const r of inScope) {
    const phoneNorm = csPrimaryPhone(r.phoneRaw);
    const parsedCourse = parseCourseString(r.courses);

    // Ignored products → write a row with is_ignored=1 so we have an audit
    // trail of what was skipped (rather than silently dropping).
    if (parsedCourse.isIgnored) {
      ignored++;
      if (!dryRun) {
        const clientId = phoneNorm ? matchClientByPhone(phoneNorm) : null;
        stmt.run(
          clientId, r.phoneRaw || null, phoneNorm, r.name || null,
          'excel_membership', `row:${r.rowNo}`, r.courses || null,
          null, null, null, 0,
          null, null, null,
          1, parsedCourse.reason || 'ignored_product', null,
          now, now,
        );
      }
      continue;
    }

    if (!parsedCourse.dept || !parsedCourse.months) {
      unparsed++;
      // Still upsert so the row is visible in the dashboard "needs review" tab.
      if (!dryRun) {
        const clientId = phoneNorm ? matchClientByPhone(phoneNorm) : null;
        stmt.run(
          clientId, r.phoneRaw || null, phoneNorm, r.name || null,
          'excel_membership', `row:${r.rowNo}`, r.courses || null,
          parsedCourse.dept, parsedCourse.months,
          parsedCourse.months, parsedCourse.isInstallment ? 1 : 0,
          null, null, null,
          0, parsedCourse.reason || null, null,
          now, now,
        );
      }
      continue;
    }

    const clientId = phoneNorm ? matchClientByPhone(phoneNorm) : null;
    if (clientId) matched++; else unmatched++;

    if (!dryRun) {
      stmt.run(
        clientId, r.phoneRaw || null, phoneNorm, r.name || null,
        'excel_membership', `row:${r.rowNo}`, r.courses || null,
        parsedCourse.dept, parsedCourse.months,
        parsedCourse.months, parsedCourse.isInstallment ? 1 : 0,
        null, null, null,
        0, null, null,
        now, now,
      );
      inserted++; // INSERT or UPDATE — both count toward "processed"
    }
  }

  if (!dryRun) saveNow();

  return {
    file: { id: file.id, name: file.name, modifiedTime: file.modifiedTime },
    sheet: parsed.sheetName,
    total_rows_in_sheet: parsed.totalRows,
    rows_in_scope: inScope.length,
    start_row: startRow,
    processed: inserted,
    ignored,
    unparsed,
    matched_to_client: matched,
    unmatched_to_client: unmatched,
    dry_run: dryRun,
    duration_ms: Date.now() - t0,
  };
}

module.exports = {
  runIngestion,
  parseMembershipBuffer,
  findMembershipFile,
  matchClientByPhone,
};
