'use strict';
const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { lineClause } = require('../utils/lineFilter');

const router = express.Router();
router.use(authenticate, requireRole('agent'));

// GET /api/clients/search?q=&by=name|phone&page=&limit=
router.get('/search', (req, res) => {
  const { q = '', by = 'name', page = 1, limit = 20 } = req.query;
  if (!q.trim()) return res.json({ total: 0, data: [] });

  let where, params;
  if (by === 'phone') {
    // Strip non-digits for phone matching
    const clean = q.replace(/\D/g, '');
    where = 'REPLACE(REPLACE(phone, \'-\', \'\'), \' \', \'\') LIKE ?';
    params = [`%${clean}%`];
  } else {
    where = 'name LIKE ? COLLATE NOCASE';
    params = [`%${q}%`];
  }

  // Apply line filter
  const lf = lineClause(req);
  where += lf.clause;
  params.push(...lf.params);

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM clients WHERE ${where}`).get(...params).cnt;
  const data  = db.prepare(`SELECT * FROM clients WHERE ${where} ORDER BY name LIMIT ? OFFSET ?`)
    .all(...params, parseInt(limit), offset);

  return res.json({ total, page: parseInt(page), data });
});

// GET /api/clients/:id
router.get('/:id', (req, res) => {
  const lf = lineClause(req);
  const client = db.prepare(`SELECT * FROM clients WHERE id = ?${lf.clause}`)
    .get(req.params.id, ...lf.params);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Get batch info — same line
  const bf = lineClause(req);
  const batch = db.prepare(
    `SELECT * FROM batches WHERE group_name = ?${bf.clause} LIMIT 1`
  ).get(client.group_name, ...bf.params);

  // Recent remarks — same line
  const rf = lineClause(req);
  const remarks = db.prepare(`
    SELECT * FROM remarks
    WHERE (client_phone = ? OR client_name LIKE ?)${rf.clause}
    ORDER BY added_at DESC LIMIT 20
  `).all(client.phone, `%${client.name}%`, ...rf.params);

  // Absences — same line
  const af = lineClause(req);
  const absences = db.prepare(`
    SELECT * FROM absent_students
    WHERE (student_name LIKE ? OR phone = ?)${af.clause}
    ORDER BY date DESC LIMIT 10
  `).all(`%${client.name}%`, client.phone, ...af.params);

  return res.json({ client, batch, remarks, absences });
});

module.exports = router;
