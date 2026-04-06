'use strict';
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const ACCESS_SECRET  = process.env.JWT_SECRET         || 'dev_access_secret_change_in_prod';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_change_in_prod';
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
