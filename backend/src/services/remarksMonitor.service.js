'use strict';
const XLSX = require('xlsx');
const db = require('../config/database');
const { parseNotes, hashNotes, noteKey } = require('../utils/remarkNotesParser');

const MIN_COLS = 13;

function normalizePhone(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function parseRemarksSheet(buffer) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer' });
  } catch (e) {
    throw new Error('ملف Excel غير صالح: ' + e.message);
  }

  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('الملف لا يحتوي على أي شيت');

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (rows.length === 0) throw new Error('الملف فارغ');

  const header = rows[0] || [];
  if (header.length < MIN_COLS) {
    throw new Error(
      `بنية الشيت غير صحيحة. عدد الأعمدة المتوقع ${MIN_COLS} على الأقل، وُجد ${header.length}. ` +
      `تأكد من ترتيب الأعمدة: # | المهمة | معينة لـ | التفاصيل | التصنيفات | الحالة | العميل | رقم الهاتف | الأهمية | قام بتعيينها | ملحوظات | وقت الإضافة | آخر تحديث`
    );
  }

  rows.shift();

  const seen = new Set();
  const parsed = [];

  for (const r of rows) {
    if (!r[0]) continue;
    const externalId = Number(r[0]);
    if (!Number.isFinite(externalId)) continue;
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const notesRaw = r[10] ? String(r[10]).trim() : null;
    const notesParsed = parseNotes(notesRaw);
    const lastNoteAt = notesParsed.length > 0
      ? notesParsed[notesParsed.length - 1].timestamp
      : null;

    parsed.push({
      external_id: externalId,
      task_type:    r[1] ? String(r[1]).trim() : null,
      assigned_to:  r[2] ? String(r[2]).trim() : null,
      details:      r[3] ? String(r[3]).trim() : null,
      category:     r[4] ? String(r[4]).trim() : null,
      status:       r[5] ? String(r[5]).trim() : null,
      client_name:  r[6] ? String(r[6]).trim() : null,
      client_phone: normalizePhone(r[7]),
      priority:     r[8] ? String(r[8]).trim() : null,
      assigned_by:  r[9] ? String(r[9]).trim() : null,
      notes_raw:    notesRaw,
      notes_parsed: notesParsed,
      notes_count:  notesParsed.length,
      notes_hash:   hashNotes(notesRaw),
      last_note_at: lastNoteAt,
      added_at:     r[11] ? String(r[11]).trim() : null,
      last_updated: r[12] ? String(r[12]).trim() : null,
    });
  }

  return parsed;
}

function getPrevSnapshotRows(line) {
  const lastSnap = db.prepare(
    `SELECT id FROM remark_snapshots WHERE line = ? ORDER BY id DESC LIMIT 1`
  ).get(line);
  if (!lastSnap) return { id: null, rowsByExternal: new Map() };

  const rows = db.prepare(
    `SELECT external_id, task_type, assigned_to, status, category, priority,
            notes_count, notes_hash, last_note_at, last_updated
       FROM remark_snapshot_rows
      WHERE snapshot_id = ? AND line = ?`
  ).all(lastSnap.id, line);

  const map = new Map();
  for (const r of rows) map.set(r.external_id, r);
  return { id: lastSnap.id, rowsByExternal: map };
}

function getKnownNoteKeys(externalId, line, beforeSnapshotId) {
  const rows = beforeSnapshotId
    ? db.prepare(
        `SELECT event_data FROM remark_activity_events
          WHERE external_id = ? AND line = ? AND event_type = 'note_added'
            AND to_snapshot_id <= ?`
      ).all(externalId, line, beforeSnapshotId)
    : [];

  const set = new Set();
  for (const r of rows) {
    try {
      const d = JSON.parse(r.event_data || '{}');
      set.add(`${d.timestamp || ''}||${(d.text || '').trim()}`);
    } catch (_) { /* ignore malformed */ }
  }
  return set;
}

function computeDiff(prevRow, currentRow, knownNoteKeys, snapshotAt) {
  const events = [];
  const fallbackTime = currentRow.last_updated || currentRow.added_at || snapshotAt;

  if (!prevRow) {
    events.push({
      external_id: currentRow.external_id,
      event_type:  'created',
      event_data:  JSON.stringify({
        task_type:   currentRow.task_type,
        assigned_to: currentRow.assigned_to,
        status:      currentRow.status,
        priority:    currentRow.priority,
        category:    currentRow.category,
      }),
      occurred_at: currentRow.added_at || snapshotAt,
    });
    for (const n of currentRow.notes_parsed) {
      events.push({
        external_id: currentRow.external_id,
        event_type:  'note_added',
        event_data:  JSON.stringify({ text: n.text, timestamp: n.timestamp }),
        occurred_at: n.timestamp || fallbackTime,
      });
    }
    if (currentRow.status === 'منتهية') {
      events.push({
        external_id: currentRow.external_id,
        event_type:  'resolved',
        event_data:  JSON.stringify({ at: fallbackTime }),
        occurred_at: fallbackTime,
      });
    }
    return events;
  }

  if ((prevRow.status || '') !== (currentRow.status || '')) {
    events.push({
      external_id: currentRow.external_id,
      event_type:  'status_changed',
      event_data:  JSON.stringify({ from: prevRow.status, to: currentRow.status }),
      occurred_at: fallbackTime,
    });
    if (currentRow.status === 'منتهية' && prevRow.status !== 'منتهية') {
      events.push({
        external_id: currentRow.external_id,
        event_type:  'resolved',
        event_data:  JSON.stringify({ at: fallbackTime }),
        occurred_at: fallbackTime,
      });
    }
  }

  if ((prevRow.assigned_to || '') !== (currentRow.assigned_to || '')) {
    events.push({
      external_id: currentRow.external_id,
      event_type:  'reassigned',
      event_data:  JSON.stringify({ from: prevRow.assigned_to, to: currentRow.assigned_to }),
      occurred_at: fallbackTime,
    });
  }

  if ((prevRow.priority || '') !== (currentRow.priority || '')) {
    events.push({
      external_id: currentRow.external_id,
      event_type:  'priority_changed',
      event_data:  JSON.stringify({ from: prevRow.priority, to: currentRow.priority }),
      occurred_at: fallbackTime,
    });
  }

  if ((prevRow.category || '') !== (currentRow.category || '')) {
    events.push({
      external_id: currentRow.external_id,
      event_type:  'category_changed',
      event_data:  JSON.stringify({ from: prevRow.category, to: currentRow.category }),
      occurred_at: fallbackTime,
    });
  }

  if (prevRow.notes_hash !== currentRow.notes_hash) {
    for (const n of currentRow.notes_parsed) {
      const k = noteKey(n);
      if (!knownNoteKeys.has(k)) {
        events.push({
          external_id: currentRow.external_id,
          event_type:  'note_added',
          event_data:  JSON.stringify({ text: n.text, timestamp: n.timestamp }),
          occurred_at: n.timestamp || fallbackTime,
        });
      }
    }
  }

  return events;
}

function parseRemarksFromDb(line) {
  const rows = db.prepare(
    `SELECT external_id, task_type, assigned_to, details, category, status,
            client_name, client_phone, priority, assigned_by, notes,
            added_at, last_updated
       FROM remarks
      WHERE line = ?
        AND external_id IS NOT NULL`
  ).all(line);

  const seen = new Set();
  const parsed = [];

  for (const r of rows) {
    if (!Number.isFinite(r.external_id)) continue;
    if (seen.has(r.external_id)) continue;
    seen.add(r.external_id);

    const notesRaw = r.notes ? String(r.notes).trim() : null;
    const notesParsed = parseNotes(notesRaw);
    const lastNoteAt = notesParsed.length > 0
      ? notesParsed[notesParsed.length - 1].timestamp
      : null;

    parsed.push({
      external_id:  r.external_id,
      task_type:    r.task_type,
      assigned_to:  r.assigned_to,
      details:      r.details,
      category:     r.category,
      status:       r.status,
      client_name:  r.client_name,
      client_phone: r.client_phone,
      priority:     r.priority,
      assigned_by:  r.assigned_by,
      notes_raw:    notesRaw,
      notes_parsed: notesParsed,
      notes_count:  notesParsed.length,
      notes_hash:   hashNotes(notesRaw),
      last_note_at: lastNoteAt,
      added_at:     r.added_at,
      last_updated: r.last_updated,
    });
  }

  return parsed;
}

function _ingestRows({ parsedRows, uploadedBy, line, notesField }) {
  if (parsedRows.length === 0) {
    throw new Error('لا توجد بيانات صالحة لإنشاء Snapshot');
  }

  return db.transaction(() => {
    const snapInsert = db.prepare(
      `INSERT INTO remark_snapshots (snapshot_at, line, uploaded_by, total_remarks, notes)
       VALUES (datetime('now', '+2 hours'), ?, ?, ?, ?)`
    ).run(line, uploadedBy || null, parsedRows.length, notesField || null);

    const snapshotId = snapInsert.lastInsertRowid;
    const snapAtRow = db.prepare(`SELECT snapshot_at FROM remark_snapshots WHERE id = ?`).get(snapshotId);
    const snapshotAt = snapAtRow ? snapAtRow.snapshot_at : null;

    const prev = getPrevSnapshotRows(line);

    const insertRow = db.prepare(
      `INSERT INTO remark_snapshot_rows
        (snapshot_id, external_id, task_type, assigned_to, details, category, status,
         client_name, client_phone, priority, assigned_by, notes_count, notes_hash,
         last_note_at, added_at, last_updated, line)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );

    const insertEvent = db.prepare(
      `INSERT INTO remark_activity_events
        (external_id, from_snapshot_id, to_snapshot_id, event_type, event_data, occurred_at, line)
       VALUES (?,?,?,?,?,?,?)`
    );

    let eventCount = 0;

    for (const row of parsedRows) {
      insertRow.run(
        snapshotId, row.external_id, row.task_type, row.assigned_to, row.details,
        row.category, row.status, row.client_name, row.client_phone, row.priority,
        row.assigned_by, row.notes_count, row.notes_hash, row.last_note_at,
        row.added_at, row.last_updated, line
      );

      const prevRow = prev.rowsByExternal.get(row.external_id);
      const knownKeys = prevRow ? getKnownNoteKeys(row.external_id, line, prev.id) : new Set();
      const events = computeDiff(prevRow, row, knownKeys, snapshotAt);

      for (const e of events) {
        insertEvent.run(
          e.external_id, prev.id, snapshotId, e.event_type, e.event_data, e.occurred_at, line
        );
        eventCount++;
      }
    }

    return {
      snapshot_id: snapshotId,
      snapshot_at: snapshotAt,
      total_remarks: parsedRows.length,
      events_generated: eventCount,
      prev_snapshot_id: prev.id,
    };
  })();
}

function ingestSnapshot({ buffer, uploadedBy, line, notesField }) {
  const parsedRows = parseRemarksSheet(buffer);
  return _ingestRows({ parsedRows, uploadedBy, line, notesField });
}

function ingestSnapshotFromDb({ uploadedBy, line, notesField }) {
  const parsedRows = parseRemarksFromDb(line);
  if (parsedRows.length === 0) {
    throw new Error(`لا توجد Remarks في قاعدة البيانات للـ Line: ${line}. ارفع Remarks.xlsx أولاً من صفحة "رفع Excel"`);
  }
  return _ingestRows({ parsedRows, uploadedBy, line, notesField });
}

function purgeOldSnapshotRows(monthsToKeep = 3) {
  const result = db.prepare(
    `DELETE FROM remark_snapshot_rows
      WHERE snapshot_id IN (
        SELECT id FROM remark_snapshots
         WHERE snapshot_at < datetime('now', '+2 hours', ?)
      )`
  ).run(`-${monthsToKeep} months`);
  return { deleted: result.changes };
}

module.exports = {
  parseRemarksSheet,
  parseRemarksFromDb,
  ingestSnapshot,
  ingestSnapshotFromDb,
  purgeOldSnapshotRows,
};
