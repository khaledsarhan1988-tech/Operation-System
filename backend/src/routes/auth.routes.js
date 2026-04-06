'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const jwt = require('../config/jwt');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: jwt.REFRESH_EXPIRES_MS,
  path: '/',
};

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = db.prepare(
    'SELECT * FROM users WHERE username = ? COLLATE NOCASE AND is_active = 1'
  ).get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const payload = {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    department: user.department,
    management: user.management,
    language: user.language,
  };

  const accessToken = jwt.signAccess(payload);
  const rawRefresh  = jwt.generateRefreshToken();
  const hashRefresh = jwt.hashToken(rawRefresh);

  // Clean old refresh tokens for this user (keep last 3)
  const existing = db.prepare(
    "SELECT id FROM refresh_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 2"
  ).all(user.id);
  if (existing.length) {
    const ids = existing.map(r => r.id).join(',');
    db.exec(`DELETE FROM refresh_tokens WHERE id IN (${ids})`);
  }

  db.prepare(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
  ).run(user.id, hashRefresh, jwt.refreshExpiresAt());

  res.cookie('refreshToken', rawRefresh, COOKIE_OPTIONS);
  return res.json({
    accessToken,
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      department: user.department,
      management: user.management,
      language: user.language,
    },
  });
});

// POST /api/auth/refresh
router.post('/refresh', (req, res) => {
  const rawToken = req.cookies?.refreshToken;
  if (!rawToken) return res.status(401).json({ error: 'No refresh token' });

  const hash = jwt.hashToken(rawToken);
  const stored = db.prepare(
    "SELECT rt.*, u.* FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id WHERE rt.token_hash = ?"
  ).get(hash);

  if (!stored) return res.status(401).json({ error: 'Invalid refresh token' });
  if (new Date(stored.expires_at) < new Date()) {
    db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(hash);
    return res.status(401).json({ error: 'Refresh token expired' });
  }
  if (!stored.is_active) return res.status(401).json({ error: 'Account disabled' });

  const payload = {
    id: stored.user_id,
    username: stored.username,
    full_name: stored.full_name,
    role: stored.role,
    department: stored.department,
    management: stored.management,
    language: stored.language,
  };

  const newAccess  = jwt.signAccess(payload);
  const newRaw     = jwt.generateRefreshToken();
  const newHash    = jwt.hashToken(newRaw);

  db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(hash);
  db.prepare(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
  ).run(stored.user_id, newHash, jwt.refreshExpiresAt());

  res.cookie('refreshToken', newRaw, COOKIE_OPTIONS);
  return res.json({ accessToken: newAccess });
});

// POST /api/auth/logout
router.post('/logout', authenticate, (req, res) => {
  const rawToken = req.cookies?.refreshToken;
  if (rawToken) {
    db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(jwt.hashToken(rawToken));
  }
  res.clearCookie('refreshToken', { path: '/' });
  return res.json({ message: 'Logged out' });
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, full_name, role, department, management, language, is_active FROM users WHERE id = ?'
  ).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json(user);
});

// PUT /api/auth/me (update language preference)
router.put('/me', authenticate, (req, res) => {
  const { language } = req.body;
  if (language && !['ar', 'en'].includes(language)) {
    return res.status(400).json({ error: 'Invalid language. Use ar or en' });
  }
  if (language) {
    db.prepare('UPDATE users SET language = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(language, req.user.id);
  }
  const user = db.prepare(
    'SELECT id, username, full_name, role, department, management, language FROM users WHERE id = ?'
  ).get(req.user.id);
  return res.json(user);
});

module.exports = router;
