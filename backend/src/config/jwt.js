'use strict';
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Secrets MUST come from the environment. In production we fail fast rather
// than silently signing tokens with a publicly-known fallback string (which
// would let anyone forge an admin JWT). In dev, if unset, we generate an
// ephemeral random secret at boot (tokens won't survive a restart — fine for dev).
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET)) {
  throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be set in production');
}
const ACCESS_SECRET  = process.env.JWT_SECRET         || crypto.randomBytes(32).toString('hex');
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
  console.warn('[jwt] JWT secrets not set in env — using ephemeral dev secrets (tokens invalid across restarts).');
}
const ACCESS_EXPIRES  = '15m';
const REFRESH_EXPIRES = '7d';
const REFRESH_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000;

function signAccess(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES });
}

function verifyAccess(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

function signRefresh(payload) {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
}

function verifyRefresh(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function refreshExpiresAt() {
  return new Date(Date.now() + REFRESH_EXPIRES_MS).toISOString();
}

module.exports = {
  signAccess,
  verifyAccess,
  signRefresh,
  verifyRefresh,
  generateRefreshToken,
  hashToken,
  refreshExpiresAt,
  REFRESH_EXPIRES_MS,
};
