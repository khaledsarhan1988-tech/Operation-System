'use strict';
// ─── READ-ONLY DATA EXPORT (API-key gated) ───────────────────────────────────
// Lets a trusted local tool pull live data for analysis WITHOUT a user login.
// Completely DISABLED unless the env var DATA_EXPORT_API_KEY is set. All routes
// are strictly read-only (SELECT), with a fixed whitelist of tables/columns —
// no user-supplied SQL. Intended for internal reporting/verification only.
const express = require('express');
const db = require('../config/database');

const router = express.Router();

// Gate: requires the secret key (header X-Export-Key or ?key=). If the env var
// is not configured, the whole feature 404s as if it doesn't exist.
router.use((req, res, next) => {
  const expected = process.env.DATA_EXPORT_API_KEY;
  if (!expected) return res.status(404).json({ error: 'not_found' });
  const got = req.header('X-Export-Key') || req.query.key;
  if (!got || String(got) !== String(expected)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

// Trainers (Educational Administration) + their extra shifts + official holidays.
// Everything needed to reconstruct availability. Small & fast.
router.get('/trainers', (req, res) => {
  try {
    const trainers = db.prepare(
      `SELECT * FROM team_members WHERE department='education' ORDER BY section, name`
    ).all();
    let extra_shifts = [];
    try {
      extra_shifts = db.prepare(
        `SELECT team_member_id, date, start_time, end_time, duration_min, notes
           FROM team_member_extra_shifts ORDER BY team_member_id, date`
      ).all();
    } catch (_) { /* table may not exist */ }
    let holidays = [];
    try {
      holidays = db.prepare(
        `SELECT name, start_date, end_date FROM official_holidays ORDER BY start_date`
      ).all();
    } catch (_) { /* table may not exist */ }
    res.json({ generated_at: new Date().toISOString(), trainers, extra_shifts, holidays });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Lectures within a bounded date range (required) — the booked-hours source.
router.get('/lectures', (req, res) => {
  const from = String(req.query.from || '');
  const to   = String(req.query.to   || '');
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!ok(from) || !ok(to)) {
    return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)' });
  }
  try {
    const lectures = db.prepare(
      `SELECT DISTINCT group_name, date, time, duration, trainer, session_type,
              side_session_category, status, line
         FROM lectures
        WHERE date BETWEEN ? AND ?`
    ).all(from, to);
    res.json({ generated_at: new Date().toISOString(), from, to, count: lectures.length, lectures });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DIAGNOSTIC LOOKUPS (read-only, bounded) ─────────────────────────────────
// Small targeted lookups by name/phone/group for investigating specific data
// issues (missing remark, empty section column). LIKE-matched, capped at 50.
function likeArg(q) { return '%' + String(q || '').trim() + '%'; }

router.get('/remarks', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    const rows = db.prepare(
      `SELECT id, external_id, client_name, client_phone, assigned_to, task_type,
              category, status, priority, line, details, added_at, last_updated
         FROM remarks
        WHERE client_phone LIKE ? OR client_name LIKE ? OR REPLACE(client_phone,' ','') LIKE ?
        ORDER BY added_at DESC LIMIT 50`
    ).all(likeArg(q), likeArg(q), likeArg(q));
    res.json({ generated_at: new Date().toISOString(), q, count: rows.length, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/absent', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    let main = [], zoom = [];
    try {
      main = db.prepare(
        `SELECT id, student_name, phone, group_name, line, date, time, lecture_no,
                follow_up_status, auto_generated
           FROM absent_students
          WHERE phone LIKE ? OR student_name LIKE ? ORDER BY date DESC LIMIT 50`
      ).all(likeArg(q), likeArg(q));
    } catch (_) {}
    try {
      zoom = db.prepare(
        `SELECT id, student_name, phone, group_name, line, date, time, lecture_no,
                follow_up_status
           FROM absent_zoom_students
          WHERE phone LIKE ? OR student_name LIKE ? ORDER BY date DESC LIMIT 50`
      ).all(likeArg(q), likeArg(q));
    } catch (_) {}
    res.json({ generated_at: new Date().toISOString(), q, absent_main: main, absent_zoom: zoom });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/batches', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    const rows = db.prepare(
      `SELECT group_name, line, status, dept_type, coordinators
         FROM batches WHERE group_name LIKE ? ORDER BY group_name LIMIT 50`
    ).all(likeArg(q));
    let coordHist = [];
    try {
      coordHist = db.prepare(
        `SELECT group_name, line, coordinator, effective_from, effective_to
           FROM coordinator_history WHERE group_name LIKE ?
          ORDER BY group_name, effective_from LIMIT 100`
      ).all(likeArg(q));
    } catch (_) {}
    res.json({ generated_at: new Date().toISOString(), q, count: rows.length, rows, coordinator_history: coordHist });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    const users = db.prepare(
      `SELECT id, full_name, username, department, role FROM users
        WHERE full_name LIKE ? OR username LIKE ? ORDER BY full_name LIMIT 50`
    ).all(likeArg(q), likeArg(q));
    let team = [];
    try {
      team = db.prepare(
        `SELECT id, name, department, section, job_title, coordinator_type, user_id
           FROM team_members WHERE name LIKE ? ORDER BY name LIMIT 50`
      ).all(likeArg(q));
    } catch (_) {}
    res.json({ generated_at: new Date().toISOString(), q, users, team_members: team });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── FULL CONSISTENT SNAPSHOT (read-only) ────────────────────────────────────
// Streams a consistent point-in-time copy of the LIVE database (all tables) so a
// trusted local tool can run the real report endpoints against today's data
// without a manual backup download. Uses SQLite `VACUUM INTO` → a clean snapshot
// (not a torn copy of a file being written). Key-gated like everything here.
router.get('/db', (req, res) => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const dest = path.join(os.tmpdir(), `export_snapshot_${process.pid}_${Date.now()}.db`);
  try { try { fs.unlinkSync(dest); } catch (_) {} } catch (_) {}
  try {
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } catch (e) {
    return res.status(500).json({ error: 'snapshot_failed', detail: e.message });
  }
  res.download(dest, 'live-snapshot.db', (err) => {
    try { fs.unlinkSync(dest); } catch (_) {}
  });
});

// ─── DISK USAGE DIAGNOSTIC (read-only) ───────────────────────────────────────
// Reports the REAL on-volume footprint so we can decide whether a VACUUM (reclaim
// DB fragmentation) is worth it vs the data being genuinely large. Pure read-only:
// stats files on the persistent volume + the SQLite freelist. No data is changed.
//  - db_file       : live academy.db size on disk (≥ compacted size; gap = fragmentation)
//  - wal / shm     : WAL sidecar files
//  - avatars       : user profile pictures (stored as files on the SAME volume)
//  - freelist      : internal free pages inside the DB (× page_size = VACUUM-reclaimable)
//  - volume        : total/free/used from statfs (what Railway's "92%" is measured on)
//  - backup_tables : row counts of one-time *_backup safety nets (drop candidates)
router.get('/disk-usage', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const DB_PATH = process.env.DB_PATH ||
    path.join(__dirname, '../../data/academy.db');
  const dataDir = path.dirname(DB_PATH);

  const sizeOf = (p) => { try { return fs.statSync(p).size; } catch (_) { return 0; } };
  const dirUsage = (dir) => {
    let bytes = 0, files = 0;
    try {
      for (const f of fs.readdirSync(dir)) {
        try { const st = fs.statSync(path.join(dir, f)); if (st.isFile()) { bytes += st.size; files++; } }
        catch (_) {}
      }
    } catch (_) {}
    return { bytes, files };
  };

  try {
    const dbFile = sizeOf(DB_PATH);
    const wal = sizeOf(DB_PATH + '-wal');
    const shm = sizeOf(DB_PATH + '-shm');
    const avatars = dirUsage(path.join(dataDir, 'avatars'));

    // internal free pages = VACUUM-reclaimable space inside the DB file.
    // The DB wrapper's pragma() ignores { simple } and returns better-sqlite3's
    // raw shape: [{ page_size: 4096 }]. Normalize to the scalar ourselves.
    const pv = (name) => {
      try {
        const r = db.pragma(name);
        if (Array.isArray(r)) return Number(Object.values(r[0] || {})[0]) || 0;
        return Number(r) || 0;
      } catch (_) { return 0; }
    };
    const pageSize  = pv('page_size');
    const freelist  = pv('freelist_count');
    const pageCount = pv('page_count');
    const reclaimable = pageSize * freelist;

    // volume total/free (Linux/Railway). statfsSync may be unavailable on some OSes.
    let volume = null;
    try {
      const s = fs.statfsSync(dataDir);
      const total = s.blocks * s.bsize, free = s.bfree * s.bsize, avail = s.bavail * s.bsize;
      volume = {
        total_mb: +(total / 1e6).toFixed(1),
        free_mb: +(free / 1e6).toFixed(1),
        avail_mb: +(avail / 1e6).toFixed(1),
        used_mb: +((total - free) / 1e6).toFixed(1),
        used_pct: total ? +(((total - free) / total) * 100).toFixed(1) : null,
      };
    } catch (e) { volume = { error: String(e && e.message || e) }; }

    // one-time *_backup safety nets (candidates for cleanup)
    const backups = {};
    try {
      const tbls = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table'
           AND (name LIKE '%backup%' OR name LIKE '%misclassified%' OR name LIKE '%_history')`
      ).all();
      for (const { name } of tbls) {
        try { backups[name] = db.prepare(`SELECT COUNT(*) c FROM "${name}"`).get().c; }
        catch (_) { backups[name] = null; }
      }
    } catch (_) {}

    const mb = (b) => +(b / 1e6).toFixed(1);
    res.json({
      generated_at: new Date().toISOString(),
      db_path: DB_PATH,
      files: {
        db_file_mb: mb(dbFile),
        wal_mb: mb(wal),
        shm_mb: mb(shm),
        avatars_mb: mb(avatars.bytes),
        avatars_files: avatars.files,
        total_db_footprint_mb: mb(dbFile + wal + shm),
      },
      sqlite: {
        page_size: pageSize,
        page_count: pageCount,
        freelist_pages: freelist,
        reclaimable_by_vacuum_mb: mb(reclaimable),
      },
      volume,
      backup_tables: backups,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DUP-CHECK DIAGNOSTIC (read-only, small JSON) ────────────────────────────
// Returns just the duplicate-detection result as compact JSON so it can be
// fetched WITHOUT downloading the whole 376 MB snapshot (which truncates under a
// flaky network). Pure read-only. `code` is intentionally non-unique on
// cs_sales_register, so duplicate MONEY rows can only be told apart by an
// identical content signature (code+client+price+courses+entry_date).
router.get('/sales-dups', (req, res) => {
  try {
    const salesCols = db.prepare("PRAGMA table_info(cs_sales_register)").all().map(c => c.name);
    const codeCols  = db.prepare("PRAGMA table_info(cs_client_codes)").all().map(c => c.name);
    const dupOps = db.prepare(`
      SELECT code, client_name, price, courses, entry_date,
             COUNT(*) AS n, GROUP_CONCAT(id) AS ids,
             GROUP_CONCAT(substr(created_at,1,19)) AS created_at
        FROM cs_sales_register
       WHERE source = 'system'
       GROUP BY IFNULL(code,''), IFNULL(client_name,''), IFNULL(price,''),
                IFNULL(courses,''), IFNULL(entry_date,'')
      HAVING n > 1
       ORDER BY n DESC LIMIT 200
    `).all();
    const dupCodes = db.prepare(`
      SELECT code, COUNT(*) AS n, GROUP_CONCAT(id) AS ids
        FROM cs_client_codes GROUP BY code HAVING n > 1 ORDER BY n DESC LIMIT 200
    `).all();
    res.json({
      generated_at: new Date().toISOString(),
      guard: {
        sales_has_client_request_id: salesCols.includes('client_request_id'),
        codes_has_client_request_id: codeCols.includes('client_request_id'),
      },
      system_rows_total: db.prepare("SELECT COUNT(*) c FROM cs_sales_register WHERE source='system'").get().c,
      system_rows_today: db.prepare("SELECT COUNT(*) c FROM cs_sales_register WHERE source='system' AND substr(created_at,1,10)=?").get(new Date().toISOString().slice(0,10)).c,
      duplicate_operation_groups: dupOps,
      duplicate_code_groups: dupCodes,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── CODE AUDIT DIAGNOSTIC (read-only, small JSON) ───────────────────────────
// Surfaces outlier client codes (≥ 1,000,000 — phone-sized values wrongly saved
// as a code) that poison the next-code auto-suggestion, plus what the corrected
// next code should be. Read-only.
router.get('/code-audit', (req, res) => {
  try {
    const MAX_REAL = 1000000;
    const maxCC = db.prepare(`SELECT MAX(CAST(code AS INTEGER)) m FROM cs_client_codes WHERE CAST(code AS INTEGER) < ?`).get(MAX_REAL).m || 0;
    const maxSR = db.prepare(`SELECT MAX(CAST(code AS INTEGER)) m FROM cs_sales_register WHERE code IS NOT NULL AND CAST(code AS INTEGER) < ?`).get(MAX_REAL).m || 0;
    const outlierCodes = db.prepare(`
      SELECT id, code, client_name, mobile_no, substr(created_at,1,19) AS created_at
        FROM cs_client_codes WHERE CAST(code AS INTEGER) >= ?
       ORDER BY CAST(code AS INTEGER) DESC LIMIT 200`).all(MAX_REAL);
    const outlierSales = db.prepare(`
      SELECT id, code, client_name, courses, price, source, substr(created_at,1,19) AS created_at
        FROM cs_sales_register WHERE code IS NOT NULL AND CAST(code AS INTEGER) >= ?
       ORDER BY CAST(code AS INTEGER) DESC LIMIT 200`).all(MAX_REAL);
    res.json({
      generated_at: new Date().toISOString(),
      max_real_code: Math.max(maxCC, maxSR),
      corrected_next_code: String(Math.max(maxCC, maxSR) + 1),
      outlier_client_codes: outlierCodes,
      outlier_sales_codes: outlierSales,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
