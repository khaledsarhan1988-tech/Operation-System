'use strict';
/**
 * كشف العملاء — Client Sales Register (manual data-entry module).
 *
 * Mirrors the academy's standalone "كشف العملاء" Google-sheet tab inside the
 * system: one row per sale/subscription operation, plus an unbounded list of
 * installment payments per sale (the sheet's 3 repeating payment blocks).
 *
 * SEPARATE source from Center App finance (finance_transactions /
 * cs_subscriptions) — owner-confirmed no overlap, so nothing here reads or
 * writes those tables. Admin-only (entry feeds reporting, not payroll).
 *
 * Tables (created in app.js): cs_sales_register (parent) +
 * cs_sales_installments (child, ON DELETE CASCADE).
 */
const express = require('express');
const multer = require('multer');
const db = require('../config/database');
const { saveNow } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireManagement } = require('../middleware/roles');
const { importSalesCsv } = require('../services/salesRegisterImport.service');

const router = express.Router();

// Customer-Services admins only — entry + edit + delete of the CS sales register.
// 'All' (super) admins pass; admins of OTHER departments (e.g. Education) are
// blocked from this financial/PII data. Mirrors the frontend route guard.
router.use(authenticate, requireRole('admin'), requireManagement('Customer Services'));

// CSV upload (one-time historical import) — in-memory, .csv only, 30MB cap.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.csv$/i.test(file.originalname) ||
               file.mimetype.includes('csv') ||
               file.mimetype.includes('text') ||
               file.mimetype.includes('excel'); // some browsers send vnd.ms-excel for .csv
    cb(ok ? null : new Error('Only .csv files allowed'), ok);
  },
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function nowTs() {
  // Same +2h convention as the table DEFAULTs (Cairo).
  const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

// Coerce a possibly-empty/messy value to a number, else null. Keeps the raw
// string out of REAL columns without throwing (data quality in the sheet is
// uneven — the verbatim original is preserved in raw_json regardless).
function num(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(/,/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Trim a string field; empty → null.
function str(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// The editable parent columns, in a fixed order shared by INSERT/UPDATE.
const SALE_FIELDS = [
  'code', 'entry_date', 'discount', 'noted1', 'noted2', 'tamkeen', 'groups',
  'shift', 'pages', 'payment_way', 'paid_status', 'department', 'client_name',
  'mobile_no', 'agent_name', 'courses', 'price', 'chrismss_discount_ah',
  'chrismss_discount_dar', 'offer_individual', 'refund_deduction',
  'khaled_deduction', 'months', 'total_price', 'total_paid_same_month',
  'installment_date', 'note', 'new_courses', 'new_prices', 'balance',
  'op_type', 'transfer_consumed_levels', 'transfer_total_levels',
];
const NUMERIC_FIELDS = new Set([
  'price', 'chrismss_discount_ah', 'chrismss_discount_dar', 'refund_deduction',
  'khaled_deduction', 'total_price', 'total_paid_same_month', 'balance',
  'transfer_consumed_levels', 'transfer_total_levels',
]);

// Canonical fixed lists (mirror the frontend <select>s). We normalize on save
// so a stray API value can never re-introduce the case/spacing variants we
// cleaned up (Daradasha/daradasha → Dardasha; paid/Paid → Paid; …).
// NOTE: "Daradasha AUE" is intentionally a DISTINCT brand (owner decision).
const BRANDS = ['Ahmed Hassan', 'Dardasha', 'Go English', 'Work Shop Offline', 'Daradasha AUE'];
const PAID_STATUSES = ['Paid', 'Not Paid', 'Fake'];

function normPages(v) {
  const s = str(v);
  if (s === null) return null;
  const low = s.toLowerCase();
  if (low === 'daradasha aue' || low === 'dardasha aue') return 'Daradasha AUE';
  if (low === 'daradasha' || low === 'dardasha') return 'Dardasha';
  const hit = BRANDS.find(b => b.toLowerCase() === low);
  return hit || s; // unknown brand kept as-is (admin may add a new one)
}
function normPaid(v) {
  const s = str(v);
  if (s === null) return null;
  const low = s.toLowerCase();
  if (low === 'paid') return 'Paid';
  if (low === 'not paid') return 'Not Paid';
  if (low === 'fake') return 'Fake';
  return s;
}

// Build the bind values for SALE_FIELDS from a request body.
function saleValues(body) {
  return SALE_FIELDS.map(f => {
    if (f === 'pages')       return normPages(body[f]);
    if (f === 'paid_status') return normPaid(body[f]);
    return NUMERIC_FIELDS.has(f) ? num(body[f]) : str(body[f]);
  });
}

// Normalize one installment object from the request body. (Balance lives on the
// parent sale, not per-installment — it's the sale's remaining balance.)
function instValues(saleId, ins, seq) {
  return {
    sale_id: saleId,
    seq,
    sales_man: str(ins.sales_man),
    department: str(ins.department),
    months: str(ins.months),
    paid_or_not: str(ins.paid_or_not),
    amount: num(ins.amount),
    pay_date: str(ins.pay_date),
    note: str(ins.note),
  };
}

const INSERT_INST = `
  INSERT INTO cs_sales_installments
    (sale_id, seq, sales_man, department, months, paid_or_not, amount, pay_date, note)
  VALUES (@sale_id, @seq, @sales_man, @department, @months, @paid_or_not, @amount, @pay_date, @note)
`;

// ─── LIST ────────────────────────────────────────────────────────────────────

// GET /api/cs-sales-register/list
// Paginated + filtered. Single-pass total via COUNT(*) OVER().
router.get('/list', (req, res) => {
  try {
    const q          = (req.query.q || '').trim();
    const department = (req.query.department || '').trim();
    const paymentWay = (req.query.payment_way || '').trim();
    const paidStatus = (req.query.paid_status || '').trim();
    const pages      = (req.query.pages || '').trim();
    const courses    = (req.query.courses || '').trim();
    const agent      = (req.query.agent || '').trim();
    const source     = (req.query.source || '').trim();
    const from       = (req.query.from || '').trim();
    const to         = (req.query.to || '').trim();

    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const where = [];
    const p = [];
    if (q) {
      // Name = substring match; code + mobile = PREFIX match. Prefix avoids the
      // false positive where a short code (e.g. 22364) appears inside an
      // unrelated phone number (e.g. 1223643366 contains "22364").
      where.push('(client_name LIKE ? OR mobile_no LIKE ? OR code LIKE ?)');
      p.push(`%${q}%`, `${q}%`, `${q}%`);
    }
    if (department) { where.push('department = ?');  p.push(department); }
    if (paymentWay) { where.push('payment_way = ?'); p.push(paymentWay); }
    if (paidStatus) { where.push('paid_status = ?'); p.push(paidStatus); }
    if (pages)      { where.push('pages = ?');       p.push(pages); }
    if (courses)    { where.push('courses = ?');     p.push(courses); }
    if (agent)      { where.push('agent_name = ?');  p.push(agent); }
    if (source)     { where.push('source = ?');      p.push(source); }
    // entry_date is stored as the sheet's text (e.g. "7/1/2023"); date filters
    // compare on a best-effort parsed form below only when both are y-m-d.
    if (from)       { where.push("date(entry_date) >= date(?)"); p.push(from); }
    if (to)         { where.push("date(entry_date) <= date(?)"); p.push(to); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT *,
        (IFNULL(total_paid_same_month, 0)
         + (SELECT IFNULL(SUM(amount), 0) FROM cs_sales_installments WHERE sale_id = cs_sales_register.id)
         -- Model 2: a transfer's installments are the full payment ledger (old + new
         -- payments). The consumed level is a loss, so subtract it; the old price is
         -- NOT added back as credit (old payments are already in the installments).
         -- total paid = direct + installments - consumedValue (= new price when fully paid).
         + (CASE WHEN op_type = 'transfer'
              THEN - IFNULL(IFNULL(price, 0) * IFNULL(transfer_consumed_levels, 0) / NULLIF(transfer_total_levels, 0), 0)
              ELSE 0 END)
        ) AS total_paid_calc,
        COUNT(*) OVER() AS _total
      FROM cs_sales_register
      ${whereSql}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).all(...p, limit, offset);

    const total = rows.length ? rows[0]._total : 0;
    rows.forEach(r => { delete r._total; });

    return res.json({
      rows,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error('[cs-sales-register/list]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── OPTIONS (dropdown sources) ──────────────────────────────────────────────

// GET /api/cs-sales-register/options
// Distinct non-empty values for each dropdown field, ordered by frequency.
router.get('/options', (req, res) => {
  try {
    const distinct = (col) => db.prepare(`
      SELECT ${col} AS v, COUNT(*) AS n
      FROM cs_sales_register
      WHERE ${col} IS NOT NULL AND TRIM(${col}) <> ''
      GROUP BY ${col}
      ORDER BY n DESC, v ASC
    `).all().map(r => r.v);

    return res.json({
      departments:   distinct('department'),
      payment_ways:  distinct('payment_way'),
      paid_statuses: distinct('paid_status'),
      pages:         distinct('pages'),
      shifts:        distinct('shift'),
      agents:        distinct('agent_name'),
      courses:       distinct('courses'),
      noted:         distinct('noted2'),
      tamkeen:       distinct('tamkeen'),
      months:        distinct('months'),
      sources:       distinct('source'),
    });
  } catch (err) {
    console.error('[cs-sales-register/options]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── IMPORT (one-time historical CSV upload) ─────────────────────────────────

// POST /api/cs-sales-register/import   (multipart: file=<csv>, wipe=0|1)
// Loads the exported "كشف العملاء" tab. Guarded: refuses if sheet rows already
// exist unless wipe=1 (replaces them). source='sheet' marks migrated rows.
router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
  const wipe = req.body?.wipe === '1' || req.body?.wipe === 'true' || req.query.wipe === '1';
  try {
    const text = req.file.buffer.toString('utf8');
    const r = importSalesCsv(text, {
      source: 'sheet',
      wipe,
      createdBy: req.user.id || null,
      createdByName: req.user.full_name || null,
    });
    return res.json({ ok: true, ...r });
  } catch (e) {
    if (e.code === 'ALREADY_IMPORTED') {
      return res.status(409).json({ error: e.message, existing: e.existing, code: e.code });
    }
    if (e.code === 'HEADER_NOT_FOUND') {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    console.error('[cs-sales-register/import]', e);
    return res.status(500).json({ error: e.message });
  }
});

// ─── GET ONE (with installments) ─────────────────────────────────────────────

router.get('/:id', (req, res) => {
  try {
    const sale = db.prepare('SELECT * FROM cs_sales_register WHERE id = ?').get(req.params.id);
    if (!sale) return res.status(404).json({ error: 'Sale not found' });
    const installments = db.prepare(
      'SELECT * FROM cs_sales_installments WHERE sale_id = ? ORDER BY seq ASC, id ASC'
    ).all(sale.id);
    return res.json({ sale, installments });
  } catch (err) {
    console.error('[cs-sales-register/get]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── CREATE ──────────────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  try {
    const body = req.body || {};
    const installments = Array.isArray(body.installments) ? body.installments : [];
    const ts = nowTs();

    // NOTE: `code` is a CLIENT code, NOT a per-row id — one client legitimately
    // has many operation rows sharing the same code (course + refund + delay…).
    // So duplicate codes are EXPECTED and must not be blocked.

    const placeholders = SALE_FIELDS.map(() => '?').join(', ');
    const insertSale = db.prepare(`
      INSERT INTO cs_sales_register
        (${SALE_FIELDS.join(', ')}, source, created_by, created_by_name, created_at, updated_at)
      VALUES (${placeholders}, 'system', ?, ?, ?, ?)
    `);
    const insertInst = db.prepare(INSERT_INST);

    let newId;
    db.transaction(() => {
      const info = insertSale.run(
        ...saleValues(body),
        req.user.id || null,
        req.user.full_name || null,
        ts, ts
      );
      newId = info.lastInsertRowid;
      installments
        .filter(ins => ins && Object.values(ins).some(v => str(v) !== null))
        .forEach((ins, i) => insertInst.run(instValues(newId, ins, i + 1)));
    })();
    saveNow();

    const sale = db.prepare('SELECT * FROM cs_sales_register WHERE id = ?').get(newId);
    const insts = db.prepare(
      'SELECT * FROM cs_sales_installments WHERE sale_id = ? ORDER BY seq ASC'
    ).all(newId);
    return res.status(201).json({ sale, installments: insts });
  } catch (err) {
    console.error('[cs-sales-register/create]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── UPDATE ──────────────────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT id FROM cs_sales_register WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Sale not found' });

    const body = req.body || {};
    const ts = nowTs();

    // (No duplicate-code guard — `code` is a client id shared across a client's
    // operation rows; see POST handler note.)

    const setSql = SALE_FIELDS.map(f => `${f} = ?`).join(', ');
    const updateSale = db.prepare(`
      UPDATE cs_sales_register SET ${setSql}, updated_at = ? WHERE id = ?
    `);
    const insertInst = db.prepare(INSERT_INST);

    const installments = Array.isArray(body.installments) ? body.installments : null;

    db.transaction(() => {
      updateSale.run(...saleValues(body), ts, id);
      // Installments are replace-all (the form sends the full current list).
      if (installments !== null) {
        db.prepare('DELETE FROM cs_sales_installments WHERE sale_id = ?').run(id);
        installments
          .filter(ins => ins && Object.values(ins).some(v => str(v) !== null))
          .forEach((ins, i) => insertInst.run(instValues(id, ins, i + 1)));
      }
    })();
    saveNow();

    const sale = db.prepare('SELECT * FROM cs_sales_register WHERE id = ?').get(id);
    const insts = db.prepare(
      'SELECT * FROM cs_sales_installments WHERE sale_id = ? ORDER BY seq ASC'
    ).all(id);
    return res.json({ sale, installments: insts });
  } catch (err) {
    console.error('[cs-sales-register/update]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── DELETE ──────────────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT id FROM cs_sales_register WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Sale not found' });
    // foreign_keys=ON → ON DELETE CASCADE removes the installments too.
    db.prepare('DELETE FROM cs_sales_register WHERE id = ?').run(id);
    saveNow();
    return res.json({ ok: true });
  } catch (err) {
    console.error('[cs-sales-register/delete]', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
