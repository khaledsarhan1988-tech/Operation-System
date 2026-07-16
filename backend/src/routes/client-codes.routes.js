'use strict';
/**
 * Clients Codes — registry of client codes (so new clients get a fresh code).
 *
 * Seeded from the distinct codes already in cs_sales_register (with the latest
 * name/phone per code), then the admin adds new clients. `code` is UNIQUE.
 * Admin-only. Separate table cs_client_codes (created in app.js).
 */
const express = require('express');
const db = require('../config/database');
const { saveNow } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireOwner } = require('../middleware/roles');

const router = express.Router();
// Clients Codes lives INSIDE كشف العملاء → same access as the parent module,
// which is now owner-only (username='admin') per owner decision.
router.use(authenticate, requireOwner);

function nowTs() {
  return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
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
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    // Mobiles are stored without the leading zero → strip a leading zero from both
    // sides so "01555…" and "1555…" both match.
    const qz = q.replace(/^0+/, '') || q;
    const where = q ? "WHERE code LIKE ? OR client_name LIKE ? OR LTRIM(IFNULL(mobile_no,''),'0') LIKE ?" : '';
    const params = q ? [`%${q}%`, `%${q}%`, `%${qz}%`] : [];
    const rows = db.prepare(`
      SELECT *, COUNT(*) OVER() AS _total FROM cs_client_codes
      ${where}
      ORDER BY CAST(code AS INTEGER) DESC, code DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    const total = rows.length ? rows[0]._total : 0;
    rows.forEach(r => { delete r._total; });
    return res.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    console.error('[client-codes/list]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── NEXT CODE (suggestion = highest numeric code + 1) ───────────────────────
// Real client codes are ~5 digits (…24793). We IGNORE outlier codes ≥ 1,000,000
// (e.g. a phone number mistakenly saved into the code column — 10 digits ≈ 1e9),
// otherwise one bad value poisons the suggestion and every new code cascades into
// the billions. 1,000,000 leaves huge headroom for the real sequence.
const MAX_REAL_CODE = 1000000;
router.get('/next-code', (req, res) => {
  try {
    const a = db.prepare(`SELECT MAX(CAST(code AS INTEGER)) m FROM cs_client_codes WHERE CAST(code AS INTEGER) < ?`).get(MAX_REAL_CODE).m || 0;
    const b = db.prepare(`SELECT MAX(CAST(code AS INTEGER)) m FROM cs_sales_register WHERE code IS NOT NULL AND CAST(code AS INTEGER) < ?`).get(MAX_REAL_CODE).m || 0;
    return res.json({ next: String(Math.max(a, b) + 1) });
  } catch (err) {
    console.error('[client-codes/next-code]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── SEED from existing sales-register codes (latest name/phone per code) ─────
router.post('/seed', (req, res) => {
  try {
    const ts = nowTs();
    const info = db.prepare(`
      INSERT OR IGNORE INTO cs_client_codes (code, client_name, mobile_no, created_at, updated_at)
      SELECT r.code, r.client_name, r.mobile_no, ?, ?
      FROM cs_sales_register r
      WHERE r.code IS NOT NULL AND TRIM(r.code) <> ''
        AND r.id = (SELECT MAX(r2.id) FROM cs_sales_register r2 WHERE r2.code = r.code)
    `).run(ts, ts);
    saveNow();
    const total = db.prepare('SELECT COUNT(*) c FROM cs_client_codes').get().c;
    return res.json({ ok: true, added: info.changes, total });
  } catch (err) {
    console.error('[client-codes/seed]', err);
    return res.status(500).json({ error: err.message });
  }
});

// Find an existing client code with the same phone (leading zeros ignored, so
// 01097… == 1097…). Optionally exclude a row id (for updates).
function phoneClash(mobile, excludeId) {
  const m = str(mobile);
  if (!m) return null;
  const sql = `SELECT code, client_name FROM cs_client_codes
               WHERE TRIM(IFNULL(mobile_no,'')) <> '' AND LTRIM(mobile_no,'0') = LTRIM(?,'0')
               ${excludeId ? 'AND id <> ?' : ''} LIMIT 1`;
  return excludeId ? db.prepare(sql).get(m, excludeId) : db.prepare(sql).get(m);
}

// ─── CREATE ──────────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const code = str(req.body?.code);
    if (!code) return res.status(400).json({ error: 'الكود مطلوب' });
    // Idempotency: a retry of a save that silently committed during a gateway 502
    // returns the already-created row (instead of a confusing "code exists" 409).
    const reqId = str(req.body?.client_request_id);
    if (reqId) {
      const prior = db.prepare('SELECT * FROM cs_client_codes WHERE client_request_id = ?').get(reqId);
      if (prior) return res.status(200).json(prior);
    }
    const dup = db.prepare('SELECT id FROM cs_client_codes WHERE code = ?').get(code);
    if (dup) return res.status(409).json({ error: `الكود «${code}» موجود بالفعل` });
    // Warn (not block) on a duplicate phone unless the caller confirms (force).
    const force = req.body?.force === true || req.body?.force === 'true';
    if (!force) {
      const ph = phoneClash(req.body?.mobile_no);
      if (ph) return res.status(409).json({
        code: 'DUP_PHONE',
        existingCode: ph.code, existingName: ph.client_name,
        error: `الموبايل ده موجود بالفعل في كود ${ph.code}${ph.client_name ? ' (' + ph.client_name + ')' : ''}`,
      });
    }
    const ts = nowTs();
    const info = db.prepare(`
      INSERT INTO cs_client_codes (code, client_name, mobile_no, note, client_request_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(code, str(req.body.client_name), str(req.body.mobile_no), str(req.body.note), reqId, ts, ts);
    saveNow();
    return res.status(201).json(db.prepare('SELECT * FROM cs_client_codes WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    console.error('[client-codes/create]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── UPDATE ──────────────────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT * FROM cs_client_codes WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'غير موجود' });
    const code = str(req.body?.code) || existing.code;
    const clash = db.prepare('SELECT id FROM cs_client_codes WHERE code = ? AND id <> ?').get(code, id);
    if (clash) return res.status(409).json({ error: `الكود «${code}» مستخدم في صف آخر` });
    const force = req.body?.force === true || req.body?.force === 'true';
    if (!force) {
      const ph = phoneClash(req.body?.mobile_no, id);
      if (ph) return res.status(409).json({
        code: 'DUP_PHONE',
        existingCode: ph.code, existingName: ph.client_name,
        error: `الموبايل ده موجود بالفعل في كود ${ph.code}${ph.client_name ? ' (' + ph.client_name + ')' : ''}`,
      });
    }
    db.prepare(`
      UPDATE cs_client_codes SET code = ?, client_name = ?, mobile_no = ?, note = ?, updated_at = ?
      WHERE id = ?
    `).run(code, str(req.body.client_name), str(req.body.mobile_no), str(req.body.note), nowTs(), id);
    saveNow();
    return res.json(db.prepare('SELECT * FROM cs_client_codes WHERE id = ?').get(id));
  } catch (err) {
    console.error('[client-codes/update]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── DELETE ──────────────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT id FROM cs_client_codes WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'غير موجود' });
    db.prepare('DELETE FROM cs_client_codes WHERE id = ?').run(id);
    saveNow();
    return res.json({ ok: true });
  } catch (err) {
    console.error('[client-codes/delete]', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
