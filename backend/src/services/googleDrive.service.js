'use strict';

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/drive'];

const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Maps backend fileType → Drive folder name used by the Quality team
const FILE_TYPE_FOLDERS = {
  trainees:      'Active Batches Trainees',
  batches:       'Batches',
  remarks:       'Remarks',
  lectures:      'Lecture Main Session',
  side_sessions: 'Lecture Side Session',
  absent:        'Absent Student Main Session',
  absent_zoom:   'Absent Student Side Session',
};

const ALL_FILE_TYPES = Object.keys(FILE_TYPE_FOLDERS);

let driveClient = null;
let cachedRootFolderId = null;

function loadCredentials() {
  // Production: read JSON from env variable (set in Railway as GOOGLE_CREDENTIALS_JSON)
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try {
      return JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    } catch (err) {
      throw new Error('GOOGLE_CREDENTIALS_JSON env variable is not valid JSON: ' + err.message);
    }
  }

  // Development: read from local file
  const candidates = [
    path.join(__dirname, '..', '..', 'credentials.json'),         // backend/credentials.json
    path.join(__dirname, '..', '..', '..', 'credentials.json'),   // academy-system/credentials.json
    path.join(__dirname, '..', '..', '..', '..', 'credentials.json'), // Website/credentials.json
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  }

  throw new Error(
    'Google credentials not found. Set GOOGLE_CREDENTIALS_JSON env variable or place credentials.json in backend/ folder.'
  );
}

function getDriveClient() {
  if (driveClient) return driveClient;

  const credentials = loadCredentials();
  const auth = new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    SCOPES
  );
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

function getRootFolderId() {
  if (cachedRootFolderId) return cachedRootFolderId;

  // Try env variable first (recommended for production)
  if (process.env.DRIVE_ROOT_FOLDER_ID) {
    cachedRootFolderId = process.env.DRIVE_ROOT_FOLDER_ID;
    return cachedRootFolderId;
  }

  // Fall back to drive-folders.json (written by setup-drive.js)
  const cfgPath = path.join(__dirname, '..', 'config', 'drive-folders.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (cfg.rootFolderId) {
      cachedRootFolderId = cfg.rootFolderId;
      return cachedRootFolderId;
    }
  }

  throw new Error(
    'Drive root folder ID not configured. Run "node src/scripts/setup-drive.js" or set DRIVE_ROOT_FOLDER_ID env variable.'
  );
}

async function findFolderByName(parentId, name) {
  const drive = getDriveClient();
  const safeName = String(name).replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `mimeType='${FOLDER_MIME}' and '${parentId}' in parents and name='${safeName}' and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files && res.data.files.length > 0 ? res.data.files[0] : null;
}

async function createFolder(parentId, name) {
  const drive = getDriveClient();
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
    },
    fields: 'id, name',
    supportsAllDrives: true,
  });
  return res.data;
}

async function getOrCreateFolder(parentId, name) {
  const existing = await findFolderByName(parentId, name);
  if (existing) return existing;
  return await createFolder(parentId, name);
}

/**
 * Resolves Line/YYYY/MM/DD/FileTypeFolder path. Creates intermediate folders as needed.
 * date: 'YYYY-MM-DD' string or Date object
 * fileType: one of ALL_FILE_TYPES
 * Returns folder ID of the leaf (file-type) folder.
 */
async function getOrCreateDatePath(line, date, fileType, options = {}) {
  if (!FILE_TYPE_FOLDERS[fileType]) {
    throw new Error(`Unknown fileType: ${fileType}`);
  }
  const d = (date instanceof Date) ? date : new Date(date);
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');

  const rootId = options.rootFolderId || getRootFolderId();
  const create = options.createIfMissing !== false; // default true

  const findOrCreate = async (parent, name) => {
    if (create) return await getOrCreateFolder(parent, name);
    return await findFolderByName(parent, name);
  };

  const lineFolder = await findOrCreate(rootId, line);
  if (!lineFolder) return null;
  const yearFolder = await findOrCreate(lineFolder.id, yyyy);
  if (!yearFolder) return null;
  const monthFolder = await findOrCreate(yearFolder.id, mm);
  if (!monthFolder) return null;
  const dayFolder = await findOrCreate(monthFolder.id, dd);
  if (!dayFolder) return null;
  const typeFolder = await findOrCreate(dayFolder.id, FILE_TYPE_FOLDERS[fileType]);
  return typeFolder ? typeFolder.id : null;
}

async function listFilesInFolder(folderId) {
  const drive = getDriveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and mimeType != '${FOLDER_MIME}'`,
    fields: 'files(id, name, mimeType, modifiedTime, size)',
    orderBy: 'modifiedTime desc',
    pageSize: 50,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files || [];
}

/**
 * Returns the most-recently-modified file in a folder (or null if empty).
 */
async function getLatestFileInFolder(folderId) {
  const files = await listFilesInFolder(folderId);
  return files.length > 0 ? files[0] : null;
}

/**
 * Downloads a Drive file's binary content as a Buffer.
 */
async function downloadFile(fileId) {
  const drive = getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data);
}

/**
 * For a given line + date, returns a map of fileType → latest file (or null if none).
 * Does NOT create folders that don't exist — only reads.
 */
async function getLatestFilesForDay(line, date) {
  const result = {};
  for (const fileType of ALL_FILE_TYPES) {
    try {
      const folderId = await getOrCreateDatePath(line, date, fileType, { createIfMissing: false });
      if (!folderId) {
        result[fileType] = null;
        continue;
      }
      const latest = await getLatestFileInFolder(folderId);
      result[fileType] = latest;
    } catch (err) {
      result[fileType] = { error: err.message };
    }
  }
  return result;
}

/**
 * Pre-creates the full date path + all 7 File Type subfolders for a (line, date).
 * Idempotent — existing folders are reused, not duplicated.
 *
 * Returns: { line, date, folders: [{ fileType, name, id, created }] }
 *   created = true  → folder was newly made
 *   created = false → folder already existed
 */
async function prepareDayFolders(line, date) {
  const d = (date instanceof Date) ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date');

  const rootId = getRootFolderId();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');

  // Build up the path: Line → Year → Month → Day
  const lineFolder  = await getOrCreateFolder(rootId,         line);
  const yearFolder  = await getOrCreateFolder(lineFolder.id,  yyyy);
  const monthFolder = await getOrCreateFolder(yearFolder.id,  mm);
  const dayFolder   = await getOrCreateFolder(monthFolder.id, dd);

  // Then create each of the 7 File Type folders inside the day folder
  const folders = [];
  for (const [fileType, folderName] of Object.entries(FILE_TYPE_FOLDERS)) {
    const existing = await findFolderByName(dayFolder.id, folderName);
    if (existing) {
      folders.push({ fileType, name: folderName, id: existing.id, created: false });
    } else {
      const made = await createFolder(dayFolder.id, folderName);
      folders.push({ fileType, name: folderName, id: made.id, created: true });
    }
  }

  return {
    line,
    date: `${yyyy}-${mm}-${dd}`,
    dayFolderId: dayFolder.id,
    folders,
  };
}

/**
 * Verifies Drive connectivity by fetching the root folder's metadata.
 * Throws with a clear message if anything is misconfigured.
 */
async function verifyConnection() {
  const drive = getDriveClient();
  const rootId = getRootFolderId();
  const res = await drive.files.get({
    fileId: rootId,
    fields: 'id, name, mimeType',
    supportsAllDrives: true,
  });
  if (res.data.mimeType !== FOLDER_MIME) {
    throw new Error(`Root ID ${rootId} is not a folder (it is ${res.data.mimeType}).`);
  }
  return res.data;
}

module.exports = {
  FILE_TYPE_FOLDERS,
  ALL_FILE_TYPES,
  getDriveClient,
  getRootFolderId,
  findFolderByName,
  createFolder,
  getOrCreateFolder,
  getOrCreateDatePath,
  prepareDayFolders,
  listFilesInFolder,
  getLatestFileInFolder,
  getLatestFilesForDay,
  downloadFile,
  verifyConnection,
};
