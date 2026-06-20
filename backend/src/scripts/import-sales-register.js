'use strict';
/**
 * One-time historical import for "كشف العملاء" (Client Sales Register) — CLI.
 *
 * Thin wrapper around services/salesRegisterImport.service.js (the same core
 * the admin upload endpoint uses). Reads the exported CSV of the sheet's
 * "كشف العملاء" tab and loads every row into cs_sales_register (+ installments).
 *
 * USAGE:
 *   DB_PATH=/path/to/academy.db node src/scripts/import-sales-register.js "<csv path>" [--wipe]
 *   # default CSV → ~/Downloads/Operation Sheets Final - كشف العملاء.csv
 *   # --wipe replaces any existing source='sheet' rows (idempotent re-run)
 */
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { importSalesCsv } = require('../services/salesRegisterImport.service');

function main() {
  const csvPath = process.argv[2]
    || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'Operation Sheets Final - كشف العملاء.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found:', csvPath);
    process.exit(1);
  }
  const wipe = process.argv.includes('--wipe');

  db.initDb();
  let r;
  try {
    r = importSalesCsv(fs.readFileSync(csvPath, 'utf8'), { source: 'sheet', wipe });
  } catch (e) {
    console.error(e.message);
    db.close();
    process.exit(e.code === 'ALREADY_IMPORTED' ? 2 : 1);
  }

  console.log('─────────────────────────────────────────────');
  if (r.wiped) console.log('Wiped existing sheet :', r.wiped);
  console.log('CSV data rows scanned :', r.dataRows);
  console.log('Inserted (parent)     :', r.inserted);
  console.log('Skipped (empty row)   :', r.skippedEmpty);
  console.log('Installments inserted :', r.instCount);
  console.log('TOTAL parent in table :', r.totalParent);
  console.log('TOTAL installments    :', r.totalInst);
  console.log('─────────────────────────────────────────────');
  db.close();
}

main();
