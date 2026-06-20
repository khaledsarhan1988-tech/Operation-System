'use strict';
// ─── COLD ARCHIVE (super-admin only) ─────────────────────────────────────────
// Ships dead-weight, never-read tables (lectures_history, absent_*_history, the
// one-time group_renames backup) to Google Drive and removes them from the live
// DB. Upload is verified (sha256 + row count) BEFORE any delete; everything is
// reversible via /restore and logged in cold_archive_log. See coldArchive.service.
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/roles');
const svc = require('../services/coldArchive.service');

const router = express.Router();
router.use(authenticate, requireSuperAdmin);

function clampDays(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) return 30;
  return Math.min(n, 3650);
}

// Read-only dry-run: how many rows / which tables WOULD be archived.
router.get('/preview', (req, res) => {
  try { res.json(svc.preview(clampDays(req.query.cutoff_days))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Run the archive (upload → verify → delete) for the chosen tables.
router.post('/run', async (req, res) => {
  try {
    const days = clampDays((req.body && req.body.cutoff_days) ?? 30);
    const tables = (req.body && Array.isArray(req.body.tables)) ? req.body.tables : null;
    const user = req.user && (req.user.username || req.user.full_name || String(req.user.id));
    res.json(await svc.archive(tables, days, user));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Audit log of archived files.
router.get('/log', (req, res) => {
  try { res.json({ rows: svc.listLog() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Pull a logged archive file back from Drive into its table.
router.post('/restore', async (req, res) => {
  try {
    const id = parseInt(req.body && req.body.log_id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'log_id is required' });
    const user = req.user && (req.user.username || req.user.full_name || String(req.user.id));
    res.json(await svc.restore(id, user));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reclaim freed pages to the OS (guarded: refuses if free space is too low).
router.post('/vacuum', (req, res) => {
  try { res.json(svc.vacuum()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
