'use strict';

/**
 * Monthly folder scaffolding for the «Customer transfer photos» Drive tree.
 *
 * The finance/CS team drops each client's transfer receipt into the folder for
 * the day it arrived, and files the month's other paperwork alongside it. Until
 * now every folder was made by hand, which meant a new month started with
 * nothing there and the naming drifted (`Administrative Exp` vs `Administrative
 * expenses` vs `Administrative expenses feb`, and a stray `1-06-2026` among the
 * zero-padded days). This builds the whole month in one shot, always the same
 * way:
 *
 *   Ahmed Hassan / Customer transfer photos / <YYYY> /
 *     Transfer Photo <MonthName> <YYYY> /
 *       01-08-2026 … 31-08-2026      ← one per day of that month
 *       Administrative Exp
 *       Refund
 *       Salary
 *
 * Every folder goes through getOrCreateFolder, so a re-run creates nothing and
 * anything the team made by hand is left untouched. Owner decision 2026-07-24:
 * full month names, past months left exactly as they are, start from next month.
 */

const drive = require('./googleDrive.service');

const LINE_FOLDER = 'Ahmed Hassan';
const ROOT_SUBFOLDER = 'Customer transfer photos';

// Full names — the team's own convention going forward (older folders mix
// "Jan"/"Feb" with "March"/"April"; those are deliberately not touched).
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// The three fixed folders every month gets, beside the day folders.
const FIXED_FOLDERS = ['Administrative Exp', 'Refund', 'Salary'];

function daysInMonth(year, month1to12) {
  return new Date(year, month1to12, 0).getDate();   // day 0 of next month
}

/** "now" in a timezone, as {year, month} with month 1-12. */
function monthInTimezone(tz = 'Africa/Cairo', offsetMonths = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find(p => p.type === 'year').value);
  const month = Number(parts.find(p => p.type === 'month').value);
  // Normalise across a year boundary (December + 1 → January of next year).
  const zero = (year * 12) + (month - 1) + offsetMonths;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

/**
 * Build (or complete) one month's folder tree.
 * Idempotent: returns what was created vs what was already there.
 */
async function prepareTransferMonth(year, month, { dryRun = false, daysOnly = false } = {}) {
  const y = Number(year), m = Number(month);
  if (!Number.isInteger(y) || y < 2020 || y > 2100) throw new Error(`Invalid year: ${year}`);
  if (!Number.isInteger(m) || m < 1 || m > 12) throw new Error(`Invalid month: ${month}`);

  const monthFolderName = `Transfer Photo ${MONTH_NAMES[m - 1]} ${y}`;

  // Walk down to the transfer-photos root. These two must already exist — if a
  // typo or a permission change hides them we want a loud error, not a stray
  // folder created at the wrong level.
  const rootId = drive.getRootFolderId();
  const lineFolder = await drive.findFolderByName(rootId, LINE_FOLDER);
  if (!lineFolder) throw new Error(`Line folder "${LINE_FOLDER}" not found`);
  const transferRoot = await drive.findFolderByName(lineFolder.id, ROOT_SUBFOLDER);
  if (!transferRoot) throw new Error(`Folder "${ROOT_SUBFOLDER}" not found inside "${LINE_FOLDER}"`);

  // daysOnly fills the gaps in a month that already exists without adding the
  // three fixed folders — used to top up an older month the team already
  // organised its own way (owner: "leave the old ones as they are").
  const wanted = [
    ...Array.from({ length: daysInMonth(y, m) }, (_, i) =>
      `${String(i + 1).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`),
    ...(daysOnly ? [] : FIXED_FOLDERS),
  ];

  if (dryRun) {
    return { month: monthFolderName, dryRun: true, wouldCreate: wanted.length, names: wanted };
  }

  const yearFolder = await drive.getOrCreateFolder(transferRoot.id, String(y));
  const monthFolder = await drive.getOrCreateFolder(yearFolder.id, monthFolderName);

  // A day already on Drive may be spelled WITHOUT the leading zero — July 2026
  // has "2-07-2026" … "9-07-2026" sitting next to zero-padded siblings. Creating
  // the padded twin would give one day two folders with the receipts split
  // between them, so an existing unpadded folder counts as that day being
  // present. Read the month's contents once instead of probing per name.
  const present = new Set((await drive.listSubfoldersInFolder(monthFolder.id)).map(f => f.name));
  const alias = (name) => name.replace(/^0(\d-)/, '$1');   // "02-07-2026" → "2-07-2026"

  // Sequential on purpose: Drive returns 403 rateLimitExceeded when a burst of
  // creates lands at once, and a half-built month is worse than a slow one.
  const created = [], existed = [], skippedUnpadded = [];
  for (const name of wanted) {
    if (present.has(name)) { existed.push(name); continue; }
    const legacy = alias(name);
    if (legacy !== name && present.has(legacy)) { skippedUnpadded.push(legacy); continue; }
    await drive.createFolder(monthFolder.id, name);
    created.push(name);
  }

  return {
    month: monthFolderName,
    monthFolderId: monthFolder.id,
    days: daysInMonth(y, m),
    created: created.length,
    existed: existed.length,
    createdNames: created,
    // Days that exist only in the old unpadded spelling — left alone, but
    // surfaced so the naming drift is visible rather than silent.
    skippedUnpadded,
  };
}

/** The month that is `offset` months from now in `tz` (0 = current, 1 = next). */
async function prepareRelativeMonth(offsetMonths = 0, tz = 'Africa/Cairo', opts = {}) {
  const { year, month } = monthInTimezone(tz, offsetMonths);
  return prepareTransferMonth(year, month, opts);
}

module.exports = {
  MONTH_NAMES,
  FIXED_FOLDERS,
  LINE_FOLDER,
  ROOT_SUBFOLDER,
  daysInMonth,
  monthInTimezone,
  prepareTransferMonth,
  prepareRelativeMonth,
};
