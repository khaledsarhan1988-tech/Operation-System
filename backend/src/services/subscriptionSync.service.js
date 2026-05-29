'use strict';

/**
 * Customer Subscription archive sync.
 *
 * Pulls the historical customer roster from the "Customer subscription to
 * groups" folder on Drive (Ahmed Hassan side for now) and mirrors it into
 * the subscription_clients table. Used by the matcher as Tier 2 — a phone
 * fallback for customers whose group has ended and therefore dropped out
 * of the Active Batches Trainees primary source.
 *
 * Triggered manually from the matching page; no automatic cadence.
 *
 * Drive folder layout (Ahmed Hassan):
 *   Customer subscription to groups/
 *     A-H Genaral/         (12 Excel files — General/Starter/CON levels)
 *     A-H Private/         (13 Excel files — Private level variants)
 *     Private 2 in 1/
 *       Private 2 in 1/    (13 Excel files — P-level variants)
 *
 * Each Excel uses Arabic headers:
 *   # | العميل | المُعرف | معلومات التواصل | المجموعة | تاريخ التسجيل
 */

const XLSX = require('xlsx');
const db = require('../config/database');
const drive = require('./googleDrive.service');
const { normalizePhone } = require('../utils/phoneNormalize');

// Ahmed Hassan side root folder ID (the "Customer subscription to groups"
// folder lives under it; we resolve the IDs at runtime so we don't have to
// hard-code anything but the line-folder root).
const AHMED_HASSAN_LINE_FOLDER_ID = '1jAzdh8KmzWGvc4847KnhpzZ1JxF_qKxH';
const CS_FOLDER_NAME = 'Customer subscription to groups';

const MIME_FOLDER = 'application/vnd.google-apps.folder';

let _running = false;

// ─── DRIVE TRAVERSAL ──────────────────────────────────────────────────────────

async function listChildren(driveClient, parentId) {
  const res = await driveClient.files.list({
    q: `'${parentId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: 200,
  });
  return res.data.files || [];
}

async function findFolder(driveClient, parentId, name) {
  const res = await driveClient.files.list({
    q: `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = '${MIME_FOLDER}' and trashed = false`,
    fields: 'files(id, name)',
    pageSize: 1,
  });
  return res.data.files?.[0] || null;
}

// Walk a subscription folder and collect every Excel under it (1 level deep
// is enough — only "Private 2 in 1" has a nested folder with the same name).
async function collectExcels(driveClient, folderId) {
  const out = [];
  const queue = [folderId];
  while (queue.length) {
    const id = queue.shift();
    const children = await listChildren(driveClient, id);
    for (const f of children) {
      if (f.mimeType === MIME_FOLDER) { queue.push(f.id); continue; }
      const lower = (f.name || '').toLowerCase();
      if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        out.push(f);
      }
    }
  }
  return out;
}

async function downloadExcel(driveClient, fileId) {
  const res = await driveClient.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data);
}

// ─── PARSER ───────────────────────────────────────────────────────────────────

// Each Excel has a name cell that may carry a trailing note line (e.g.
// "Mohamed Ali\nمهندس"). Strip everything after the first newline.
function cleanName(raw) {
  if (!raw) return null;
  const first = String(raw).split('\n')[0].trim();
  return first || null;
}

// Contact column can hold a phone + email separated by newline. We pull the
// first plausibly-numeric line for the phone and ignore the rest.
function extractPhone(raw) {
  if (!raw) return { phone: null, phoneRaw: null };
  const phoneRaw = String(raw).split('\n')[0].trim();
  if (!phoneRaw) return { phone: null, phoneRaw: null };
  const norm = normalizePhone(phoneRaw);
  return { phone: norm || phoneRaw, phoneRaw };
}

// Group cell often appends a status (e.g. "Apr_20_..._Genral-1\nإنتهت").
// Split on newline → name + status.
function parseGroup(raw) {
  if (!raw) return { groupName: null, groupStatus: null };
  const parts = String(raw).split('\n').map(s => s.trim()).filter(Boolean);
  return {
    groupName: parts[0] || null,
    groupStatus: parts[1] || null,
  };
}

function parseSheet(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const out = [];
  for (const r of rows) {
    const name = cleanName(r['العميل']);
    const { phone, phoneRaw } = extractPhone(r['معلومات التواصل']);
    const { groupName, groupStatus } = parseGroup(r['المجموعة']);
    if (!phoneRaw) continue; // skip rows with no contact info
    out.push({
      name,
      phone,
      phoneRaw,
      groupName,
      groupStatus,
      clientCode: r['المُعرف'] ? String(r['المُعرف']).trim() : null,
      regDate: r['تاريخ التسجيل'] ? String(r['تاريخ التسجيل']).trim() : null,
    });
  }
  return out;
}

// ─── DB ───────────────────────────────────────────────────────────────────────

function upsertRows(rows, line, sourceFile, nowIso) {
  const ins = db.prepare(`
    INSERT INTO subscription_clients
      (name, phone, phone_raw, group_name, group_status, line, source_file, client_code, reg_date, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(phone_raw, source_file, line) DO UPDATE SET
      name         = excluded.name,
      phone        = excluded.phone,
      group_name   = excluded.group_name,
      group_status = excluded.group_status,
      client_code  = excluded.client_code,
      reg_date     = excluded.reg_date,
      synced_at    = excluded.synced_at
  `);
  const tx = db.transaction(() => {
    for (const r of rows) {
      ins.run(r.name, r.phone, r.phoneRaw, r.groupName, r.groupStatus, line, sourceFile, r.clientCode, r.regDate, nowIso);
    }
  });
  tx();
}

function updateState(patch) {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const sets = fields.map(f => `${f} = ?`).join(', ');
  const vals = fields.map(f => patch[f]);
  db.prepare(`UPDATE subscription_sync_state SET ${sets} WHERE id = 1`).run(...vals);
}

function getStatus() {
  const row = db.prepare(`SELECT * FROM subscription_sync_state WHERE id = 1`).get();
  const total = db.prepare(`SELECT COUNT(*) AS n FROM subscription_clients`).get()?.n || 0;
  return { ...row, rows_total_current: total, running: _running };
}

// ─── PUBLIC: sync ─────────────────────────────────────────────────────────────

async function syncAll({ triggeredBy = 'manual' } = {}) {
  if (_running) {
    return { skipped: true, reason: 'already_running' };
  }
  _running = true;
  const startedAt = new Date().toISOString();
  updateState({
    last_started_at: startedAt,
    last_status: 'running',
    last_error: null,
    files_processed: 0,
    rows_total: 0,
    triggered_by: triggeredBy,
  });

  try {
    const driveClient = await drive.getDriveClient();
    const csFolder = await findFolder(driveClient, AHMED_HASSAN_LINE_FOLDER_ID, CS_FOLDER_NAME);
    if (!csFolder) {
      throw new Error(`"${CS_FOLDER_NAME}" folder not found under Ahmed Hassan`);
    }

    const topLevelFolders = (await listChildren(driveClient, csFolder.id))
      .filter(f => f.mimeType === MIME_FOLDER);

    let filesProcessed = 0;
    let rowsTotal = 0;
    const nowIso = new Date().toISOString();

    for (const topFolder of topLevelFolders) {
      const excels = await collectExcels(driveClient, topFolder.id);
      for (const file of excels) {
        try {
          const buf = await downloadExcel(driveClient, file.id);
          const rows = parseSheet(buf);
          const sourceLabel = `${topFolder.name}/${file.name}`;
          upsertRows(rows, 'Ahmed Hassan', sourceLabel, nowIso);
          rowsTotal += rows.length;
          filesProcessed += 1;
          updateState({ files_processed: filesProcessed, rows_total: rowsTotal });
        } catch (fileErr) {
          console.error(`[subscriptionSync] ${file.name} error:`, fileErr.message);
        }
      }
    }

    const finishedAt = new Date().toISOString();
    updateState({
      last_finished_at: finishedAt,
      last_status: 'success',
    });

    return {
      status: 'success',
      files_processed: filesProcessed,
      rows_total: rowsTotal,
      started_at: startedAt,
      finished_at: finishedAt,
    };
  } catch (e) {
    updateState({
      last_finished_at: new Date().toISOString(),
      last_status: 'error',
      last_error: e.message,
    });
    throw e;
  } finally {
    _running = false;
  }
}

module.exports = {
  syncAll,
  getStatus,
};
