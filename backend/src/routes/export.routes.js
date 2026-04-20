'use strict';
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const exporter = require('../services/export.service');
const { lineFilter } = require('../utils/lineFilter');

const router = express.Router();
router.use(authenticate, requireRole('agent'));

async function sendWorkbook(res, wb, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

// Inject line filter into query options before passing to exporter service
function withLine(req) {
  return { ...req.query, line: lineFilter(req) };
}

router.get('/side-sessions', async (req, res) => {
  try {
    const wb = await exporter.exportSideSessions(withLine(req));
    await sendWorkbook(res, wb, `side-sessions-${req.query.date || 'all'}.xlsx`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/remarks', requireRole('leader'), async (req, res) => {
  try {
    const wb = await exporter.exportRemarks(withLine(req));
    await sendWorkbook(res, wb, `remarks-report.xlsx`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/absent', async (req, res) => {
  try {
    const wb = await exporter.exportAbsent(withLine(req));
    await sendWorkbook(res, wb, `absent-students-report.xlsx`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/team-performance', requireRole('leader'), async (req, res) => {
  try {
    const wb = await exporter.exportTeamPerformance(withLine(req));
    await sendWorkbook(res, wb, `team-performance.xlsx`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
