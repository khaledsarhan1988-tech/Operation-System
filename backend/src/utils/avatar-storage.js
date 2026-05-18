'use strict';
/**
 * Avatar storage — stores user profile pictures on the same persistent volume
 * as the SQLite DB (e.g. /data/avatars/ on Railway).
 *
 * Files are NOT stored as BLOBs in the DB because sql.js rewrites the entire
 * DB to disk on every save; large binaries would slow every write.
 *
 * File naming: <userId>-<timestamp>.<ext>  (no path traversal possible)
 * Allowed mime: image/jpeg, image/png, image/webp
 * Max size:    2 MB
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/academy.db');
const AVATARS_DIR = path.join(path.dirname(DB_PATH), 'avatars');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MIME_TO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

function ensureDir() {
  if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
}

function isAllowedMime(mime) {
  return ALLOWED_MIME.has(mime);
}

function extFor(mime) {
  return MIME_TO_EXT[mime] || 'bin';
}

function avatarPath(filename) {
  // Re-anchor under AVATARS_DIR to defeat any path-traversal attempt
  const safe = path.basename(filename);
  return path.join(AVATARS_DIR, safe);
}

function saveBuffer(userId, mime, buffer) {
  ensureDir();
  const filename = `${userId}-${Date.now()}.${extFor(mime)}`;
  const full = path.join(AVATARS_DIR, filename);
  fs.writeFileSync(full, buffer);
  return filename;
}

function deleteFile(filename) {
  if (!filename) return;
  try {
    const full = avatarPath(filename);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  } catch (e) {
    console.warn('[avatar-storage] delete failed:', e.message);
  }
}

function fileExists(filename) {
  if (!filename) return false;
  try { return fs.existsSync(avatarPath(filename)); }
  catch (_) { return false; }
}

module.exports = {
  AVATARS_DIR,
  MAX_BYTES,
  ALLOWED_MIME,
  isAllowedMime,
  avatarPath,
  saveBuffer,
  deleteFile,
  fileExists,
};
