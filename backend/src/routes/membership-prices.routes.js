'use strict';
/**
 * العضويات وأسعارها — Membership Prices (manual per-brand pricing).
 *
 * One row per membership/course code, with TWO manually-entered prices because
 * Ahmed Hassan and Dardasha charge differently. The code list is seeded from
 * the distinct `courses` already present in cs_sales_register (POST /seed),
 * then the admin fills the prices.
 *
 * Table (created in app.js): cs_membership_prices (code UNIQUE).
 * Admin-only. Separate from Center App / pricing sheets.
 */
const express = require('express');
const db = require('../config/database');
const { saveNow } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requirePageOrManagement } = require('../middleware/roles');

const router = express.Router();
// Any admin OR a user granted the 'sales-register' page (the العضويات tab lives
// inside كشف العملاء). requiredMgmt omitted → keeps the original any-admin gate
// while adding the page-grant path for scoped accounts users.
router.use(authenticate, requirePageOrManagement('sales-register'));

function nowTs() {
  return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
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

// ─── LIST ────────────────────────────────────────────────────────────────────
router.get('/list', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const where = q ? 'WHERE code LIKE ?' : '';
    const params = q ? [`%${q}%`] : [];
    const rows = db.prepare(`
      SELECT * FROM cs_membership_prices
      ${where}
      ORDER BY code ASC
    `).all(...params);
    return res.json({ rows, total: rows.length });
  } catch (err) {
    console.error('[membership-prices/list]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── SEED from existing sales-register course codes ──────────────────────────
// INSERT OR IGNORE on the UNIQUE code → only NEW codes are added, so deleting a
// membership and re-seeding will not resurrect it. Prices start NULL.
router.post('/seed', (req, res) => {
  try {
    const codes = db.prepare(`
      SELECT DISTINCT TRIM(courses) AS code
      FROM cs_sales_register
      WHERE courses IS NOT NULL AND TRIM(courses) <> ''
    `).all().map(r => r.code);

    const ins = db.prepare(`
      INSERT OR IGNORE INTO cs_membership_prices (code, created_at, updated_at)
      VALUES (?, ?, ?)
    `);
    const ts = nowTs();
    let added = 0;
    db.transaction(() => {
      for (const c of codes) {
        const info = ins.run(c, ts, ts);
        if (info.changes) added++;
      }
    })();
    saveNow();

    const total = db.prepare('SELECT COUNT(*) c FROM cs_membership_prices').get().c;
    return res.json({ ok: true, added, scanned: codes.length, total });
  } catch (err) {
    console.error('[membership-prices/seed]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── PRUNE (bulk delete memberships with no Ahmed Hassan price) ──────────────
// POST /api/membership-prices/prune-no-ah   body: { keep: ["Refund","Revision"] }
// Deletes every membership whose price_ahmed_hassan is empty, EXCEPT the codes
// in `keep`. IMPORTANT: this touches ONLY cs_membership_prices — the operations
// list (cs_sales_register) is a SEPARATE table and is never affected here.
router.post('/prune-no-ah', (req, res) => {
  try {
    const keep = Array.isArray(req.body?.keep)
      ? req.body.keep.map(c => String(c).trim()).filter(Boolean)
      : [];
    const keepClause = keep.length ? `AND code NOT IN (${keep.map(() => '?').join(',')})` : '';
    const whereSql = `WHERE (price_ahmed_hassan IS NULL OR price_ahmed_hassan = '') ${keepClause}`;

    const willDelete = db.prepare(`SELECT COUNT(*) c FROM cs_membership_prices ${whereSql}`).get(...keep).c;
    const info = db.prepare(`DELETE FROM cs_membership_prices ${whereSql}`).run(...keep);
    saveNow();

    const remaining = db.prepare('SELECT COUNT(*) c FROM cs_membership_prices').get().c;
    return res.json({ ok: true, deleted: info.changes, willDelete, remaining, kept: keep });
  } catch (err) {
    console.error('[membership-prices/prune-no-ah]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── CREATE ──────────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const code = str(req.body?.code);
    if (!code) return res.status(400).json({ error: 'كود العضوية مطلوب' });
    const dup = db.prepare('SELECT id FROM cs_membership_prices WHERE code = ?').get(code);
    if (dup) return res.status(409).json({ error: `الكود «${code}» موجود بالفعل` });

    const ts = nowTs();
    const info = db.prepare(`
      INSERT INTO cs_membership_prices (code, price_ahmed_hassan, price_dardasha, months, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(code, num(req.body.price_ahmed_hassan), num(req.body.price_dardasha), str(req.body.months), str(req.body.note), ts, ts);
    saveNow();
    return res.status(201).json(db.prepare('SELECT * FROM cs_membership_prices WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    console.error('[membership-prices/create]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── UPDATE ──────────────────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT * FROM cs_membership_prices WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'غير موجود' });

    const code = str(req.body?.code) || existing.code;
    // Guard the UNIQUE code against colliding with a different row.
    const clash = db.prepare('SELECT id FROM cs_membership_prices WHERE code = ? AND id <> ?').get(code, id);
    if (clash) return res.status(409).json({ error: `الكود «${code}» مستخدم في صف آخر` });

    db.prepare(`
      UPDATE cs_membership_prices
      SET code = ?, price_ahmed_hassan = ?, price_dardasha = ?, months = ?, note = ?, updated_at = ?
      WHERE id = ?
    `).run(code, num(req.body.price_ahmed_hassan), num(req.body.price_dardasha), str(req.body.months), str(req.body.note), nowTs(), id);
    saveNow();
    return res.json(db.prepare('SELECT * FROM cs_membership_prices WHERE id = ?').get(id));
  } catch (err) {
    console.error('[membership-prices/update]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── DELETE ──────────────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT id FROM cs_membership_prices WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'غير موجود' });
    db.prepare('DELETE FROM cs_membership_prices WHERE id = ?').run(id);
    saveNow();
    return res.json({ ok: true });
  } catch (err) {
    console.error('[membership-prices/delete]', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
