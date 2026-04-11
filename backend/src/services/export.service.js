'use strict';
const ExcelJS = require('exceljs');
const db = require('../config/database');

const HEADER_STYLE = {
  font: { bold: true, color: { argb: 'FFFFFFFF' } },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } },
  alignment: { horizontal: 'center', vertical: 'middle' },
  border: { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } },
};

function applyHeaders(sheet, columns) {
  sheet.columns = columns;
  const headerRow = sheet.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell(cell => Object.assign(cell, HEADER_STYLE));
}

// ─── SIDE SESSION CHECKS REPORT ───────────────────────────────────────────────
async function exportSideSessions({ date, group }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Academy System';
  const ws = wb.addWorksheet('Side Session Checks');

  applyHeaders(ws, [
    { header: 'Group', key: 'group_name', width: 50 },
    { header: 'Date', key: 'session_date', width: 14 },
    { header: 'Trainer Present', key: 'trainer_present', width: 16 },
    { header: 'Student Present', key: 'student_present', width: 16 },
    { header: 'Lecture Start', key: 'lecture_start_time', width: 14 },
    { header: 'Recording Start', key: 'recording_start_time', width: 16 },
    { header: 'Duration (min)', key: 'actual_duration_min', width: 15 },
    { header: 'Notes', key: 'notes', width: 40 },
    { header: 'Checked By', key: 'checked_by_name', width: 20 },
    { header: 'Checked At', key: 'checked_at', width: 20 },
  ]);

  let query = `
    SELECT ssc.*, u.full_name AS checked_by_name
    FROM side_session_checks ssc
    LEFT JOIN users u ON u.id = ssc.checked_by
    WHERE 1=1
  `;
  const params = [];
  if (date) { query += ' AND ssc.session_date = ?'; params.push(date); }
  if (group) { query += ' AND ssc.group_name LIKE ?'; params.push(`%${group}%`); }
  query += ' ORDER BY ssc.session_date DESC, ssc.group_name';

  const rows = db.prepare(query).all(...params);
  rows.forEach(r => {
    const row = ws.addRow({
      ...r,
      trainer_present: r.trainer_present === 1 ? 'Yes' : r.trainer_present === 0 ? 'No' : '-',
      student_present: r.student_present === 1 ? 'Yes' : r.student_present === 0 ? 'No' : '-',
    });
    row.height = 20;
  });

  ws.autoFilter = { from: 'A1', to: 'J1' };
  return wb;
}

// ─── REMARKS REPORT ──────────────────────────────────────────────────────────
async function exportRemarks({ from, to, agent, status }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Academy System';
  const ws = wb.addWorksheet('Remarks Report');

  applyHeaders(ws, [
    { header: '#', key: 'external_id', width: 10 },
    { header: 'Task Type', key: 'task_type', width: 25 },
    { header: 'Assigned To', key: 'assigned_to', width: 20 },
    { header: 'Client', key: 'client_name', width: 25 },
    { header: 'Phone', key: 'client_phone', width: 15 },
    { header: 'Priority', key: 'priority', width: 12 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Details', key: 'details', width: 40 },
    { header: 'Agent Notes', key: 'agent_notes', width: 40 },
    { header: 'Added At', key: 'added_at', width: 20 },
    { header: 'SLA Deadline', key: 'sla_deadline', width: 20 },
    { header: 'Last Updated', key: 'last_updated', width: 20 },
  ]);

  let query = 'SELECT * FROM remarks WHERE 1=1';
  const params = [];
  if (from)   { query += ' AND added_at >= ?'; params.push(from); }
  if (to)     { query += ' AND added_at <= ?'; params.push(to); }
  if (agent)  { query += ' AND assigned_to LIKE ?'; params.push(`%${agent}%`); }
  if (status) { query += ' AND status = ?'; params.push(status); }
  query += ' ORDER BY added_at DESC';

  db.prepare(query).all(...params).forEach(r => ws.addRow(r));
  ws.autoFilter = { from: 'A1', to: 'L1' };
  return wb;
}

// ─── ABSENT STUDENTS REPORT ──────────────────────────────────────────────────
async function exportAbsent({ from, to, group }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Academy System';
  const ws = wb.addWorksheet('Absent Students');

  applyHeaders(ws, [
    { header: 'Group', key: 'group_name', width: 50 },
    { header: 'Student', key: 'student_name', width: 25 },
    { header: 'Phone', key: 'phone', width: 15 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Lecture #', key: 'lecture_no', width: 10 },
    { header: 'Follow-up Status', key: 'follow_up_status', width: 18 },
    { header: 'Follow-up Note', key: 'follow_up_note', width: 40 },
    { header: 'Follow-up By', key: 'follow_up_by', width: 18 },
    { header: 'Follow-up At', key: 'follow_up_at', width: 20 },
  ]);

  let query = 'SELECT * FROM absent_students WHERE 1=1';
  const params = [];
  if (from)  { query += ' AND date >= ?'; params.push(from); }
  if (to)    { query += ' AND date <= ?'; params.push(to); }
  if (group) { query += ' AND group_name LIKE ?'; params.push(`%${group}%`); }
  query += ' ORDER BY date DESC';

  db.prepare(query).all(...params).forEach(r => ws.addRow(r));
  ws.autoFilter = { from: 'A1', to: 'I1' };
  return wb;
}

// ─── TEAM PERFORMANCE REPORT ─────────────────────────────────────────────────
async function exportTeamPerformance({ from, to }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Academy System';
  const ws = wb.addWorksheet('Team Performance');

  applyHeaders(ws, [
    { header: 'Agent', key: 'assigned_to', width: 25 },
    { header: 'Total Tasks', key: 'total', width: 12 },
    { header: 'Completed', key: 'done', width: 12 },
    { header: 'Pending', key: 'pending', width: 12 },
    { header: 'Urgent', key: 'urgent', width: 12 },
    { header: 'Important', key: 'important', width: 12 },
    { header: 'Normal', key: 'normal', width: 12 },
    { header: 'SLA Breached', key: 'breached', width: 14 },
  ]);

  let query = `
    SELECT
      assigned_to,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'إنتهت' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status != 'إنتهت' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN priority = 'عاجلة' THEN 1 ELSE 0 END) AS urgent,
      SUM(CASE WHEN priority = 'هامة' THEN 1 ELSE 0 END) AS important,
      SUM(CASE WHEN priority = 'عادية' THEN 1 ELSE 0 END) AS normal,
      SUM(CASE WHEN status != 'إنتهت' AND sla_deadline < datetime('now', '+2 hours') THEN 1 ELSE 0 END) AS breached
    FROM remarks
    WHERE 1=1
  `;
  const params = [];
  if (from) { query += ' AND added_at >= ?'; params.push(from); }
  if (to)   { query += ' AND added_at <= ?'; params.push(to); }
  query += ' GROUP BY assigned_to ORDER BY total DESC';

  db.prepare(query).all(...params).forEach(r => ws.addRow(r));
  ws.autoFilter = { from: 'A1', to: 'H1' };
  return wb;
}

module.exports = {
  exportSideSessions,
  exportRemarks,
  exportAbsent,
  exportTeamPerformance,
};
