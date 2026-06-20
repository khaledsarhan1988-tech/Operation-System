'use strict';
/**
 * Shared import core for the "كشف العملاء" Client Sales Register.
 *
 * Used by BOTH the one-time CLI script (scripts/import-sales-register.js) and
 * the admin CSV-upload endpoint (routes/cs-sales-register.routes.js) so the
 * parsing + column mapping + insert logic lives in exactly one place.
 *
 * The CSV is the export of the sheet's "كشف العملاء" tab — 49 columns, header
 * on the 4th line (the row containing both "Code" and "Client Name").
 */
const db = require('../config/database');
const { saveNow } = require('../config/database');

// ─── minimal RFC-4180 CSV parser (handles quotes, embedded commas/newlines) ───
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', i = 0, inQ = false;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function num(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(/,/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function str(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// Parent column → CSV index map. (Balance = col 48 = remaining balance of the
// SALE — it lives on the parent, NOT as a per-installment field.)
const MAP = {
  entry_date: 0, code: 1, discount: 2, noted1: 3, noted2: 4, tamkeen: 5,
  groups: 6, shift: 7, pages: 8, payment_way: 9, paid_status: 10, department: 11,
  client_name: 12, mobile_no: 13, agent_name: 14, courses: 15, price: 16,
  chrismss_discount_ah: 17, chrismss_discount_dar: 18, offer_individual: 19,
  refund_deduction: 20, khaled_deduction: 21, months: 22, total_price: 23,
  total_paid_same_month: 24, installment_date: 25, note: 26, new_courses: 27,
  new_prices: 28, balance: 48,
};
const NUMERIC = new Set([
  'price', 'chrismss_discount_ah', 'chrismss_discount_dar', 'refund_deduction',
  'khaled_deduction', 'total_price', 'total_paid_same_month', 'balance',
]);
const SALE_COLS = Object.keys(MAP);

// Installment blocks: [sales_man, department, months, paid_or_not, amount, pay_date, note].
// block3 (cols 43-47) has no Date/Note; col 48 (Balance) is the parent's balance.
const INST_BLOCKS = [
  { sales_man: 29, department: 30, months: 31, paid_or_not: 32, amount: 33, pay_date: 34, note: 35 },
  { sales_man: 36, department: 37, months: 38, paid_or_not: 39, amount: 40, pay_date: 41, note: 42 },
  { sales_man: 43, department: 44, months: 45, paid_or_not: 46, amount: 47, pay_date: null, note: null },
];

// Idempotent — same DDL as app.js so the import can run standalone.
function ensureTables() {
  db._raw.run(`
    CREATE TABLE IF NOT EXISTS cs_sales_register (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, entry_date TEXT, discount TEXT,
      noted1 TEXT, noted2 TEXT, tamkeen TEXT, groups TEXT, shift TEXT, pages TEXT,
      payment_way TEXT, paid_status TEXT, department TEXT, client_name TEXT, mobile_no TEXT,
      agent_name TEXT, courses TEXT, price REAL, chrismss_discount_ah REAL,
      chrismss_discount_dar REAL, offer_individual TEXT, refund_deduction REAL,
      khaled_deduction REAL, months TEXT, total_price REAL, total_paid_same_month REAL,
      installment_date TEXT, note TEXT, new_courses TEXT, new_prices TEXT, balance REAL,
      source TEXT NOT NULL DEFAULT 'system', raw_json TEXT, created_by INTEGER,
      created_by_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
    )`);
  db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_sales_code ON cs_sales_register(code)`);
  db._raw.run(`
    CREATE TABLE IF NOT EXISTS cs_sales_installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL, seq INTEGER NOT NULL DEFAULT 1,
      sales_man TEXT, department TEXT, months TEXT, paid_or_not TEXT, amount REAL,
      pay_date TEXT, note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
      FOREIGN KEY (sale_id) REFERENCES cs_sales_register(id) ON DELETE CASCADE
    )`);
  db._raw.run(`CREATE INDEX IF NOT EXISTS idx_cs_sales_inst_sale ON cs_sales_installments(sale_id)`);
}

/**
 * Import the "كشف العملاء" CSV text into cs_sales_register (+ installments).
 *
 * @param {string} csvText  raw CSV (utf-8)
 * @param {object} opts
 *   - source   tag for migrated rows (default 'sheet')
 *   - wipe     if true, delete existing rows of `source` first (idempotent re-run)
 *   - createdBy / createdByName  optional audit fields
 * @returns {object} summary { dataRows, inserted, skippedEmpty, instCount,
 *                             totalParent, totalInst, wiped }
 * @throws if the header row can't be found, or if existing `source` rows exist
 *         and wipe is false (guards against accidental double-load).
 */
function importSalesCsv(csvText, opts = {}) {
  const source = opts.source || 'sheet';
  const wipe = !!opts.wipe;
  const createdBy = opts.createdBy ?? null;
  const createdByName = opts.createdByName ?? null;

  ensureTables();

  const rows = parseCSV(csvText);
  const hi = rows.findIndex(r => r.includes('Code') && r.includes('Client Name'));
  if (hi < 0) {
    const e = new Error('صف العناوين غير موجود — تأكد أنه ملف «كشف العملاء» الصحيح');
    e.code = 'HEADER_NOT_FOUND';
    throw e;
  }
  const data = rows.slice(hi + 1);

  const existing = db.prepare(`SELECT COUNT(*) c FROM cs_sales_register WHERE source = ?`).get(source).c;
  if (existing > 0 && !wipe) {
    const e = new Error(`يوجد بالفعل ${existing} صف من المصدر «${source}». فعّل «استبدال» لإعادة الرفع.`);
    e.code = 'ALREADY_IMPORTED';
    e.existing = existing;
    throw e;
  }

  const insertSale = db.prepare(`
    INSERT INTO cs_sales_register
      (${SALE_COLS.join(', ')}, source, raw_json, created_by, created_by_name, created_at, updated_at)
    VALUES (${SALE_COLS.map(() => '?').join(', ')}, ?, ?, ?, ?, ?, ?)
  `);
  const insertInst = db.prepare(`
    INSERT INTO cs_sales_installments
      (sale_id, seq, sales_man, department, months, paid_or_not, amount, pay_date, note)
    VALUES (@sale_id, @seq, @sales_man, @department, @months, @paid_or_not, @amount, @pay_date, @note)
  `);

  const ts = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  let inserted = 0, skippedEmpty = 0, instCount = 0;

  const run = db.transaction(() => {
    if (existing > 0 && wipe) {
      db.prepare(`DELETE FROM cs_sales_register WHERE source = ?`).run(source);
    }
    for (const r of data) {
      const code = str(r[MAP.code]);
      const clientName = str(r[MAP.client_name]);
      if (!code && !clientName) { skippedEmpty++; continue; } // empty / spacer row

      const vals = SALE_COLS.map(c => (NUMERIC.has(c) ? num(r[MAP[c]]) : str(r[MAP[c]])));
      const info = insertSale.run(...vals, source, JSON.stringify(r), createdBy, createdByName, ts, ts);
      const saleId = info.lastInsertRowid;
      inserted++;

      let seq = 0;
      for (const b of INST_BLOCKS) {
        const get = (idx) => (idx == null ? null : r[idx]);
        // present = a real payment signal (excludes `department` + `balance`).
        const present = ['sales_man', 'months', 'paid_or_not', 'amount', 'pay_date', 'note']
          .some(k => str(get(b[k])) !== null);
        if (!present) continue;
        seq++;
        insertInst.run({
          sale_id: saleId, seq,
          sales_man: str(get(b.sales_man)), department: str(get(b.department)),
          months: str(get(b.months)), paid_or_not: str(get(b.paid_or_not)),
          amount: num(get(b.amount)), pay_date: str(get(b.pay_date)),
          note: str(get(b.note)),
        });
        instCount++;
      }
    }
  });
  run();
  saveNow();

  return {
    dataRows: data.length,
    inserted,
    skippedEmpty,
    instCount,
    wiped: existing > 0 && wipe ? existing : 0,
    totalParent: db.prepare('SELECT COUNT(*) c FROM cs_sales_register').get().c,
    totalInst: db.prepare('SELECT COUNT(*) c FROM cs_sales_installments').get().c,
  };
}

module.exports = { parseCSV, importSalesCsv, ensureTables, MAP, SALE_COLS, NUMERIC, INST_BLOCKS };
