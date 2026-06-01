'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../config/database');
const jwt = require('../config/jwt');
const { authenticate } = require('../middleware/auth');
const avatarStorage = require('../utils/avatar-storage');

const router = express.Router();

// ─── Rate limiter: max 5 login attempts per 15 minutes per IP ─────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'كثرة المحاولات الفاشلة، يرجى الانتظار 15 دقيقة قبل المحاولة مجدداً' },
  skip: () => process.env.NODE_ENV !== 'production',
});

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: jwt.REFRESH_EXPIRES_MS,
  path: '/',
};

// POST /api/auth/login
router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  let user;
  try {
    user = db.prepare(
      'SELECT * FROM users WHERE username = ? COLLATE NOCASE AND is_active = 1'
    ).get(username);
  } catch (e) {
    console.error('[auth/login] users lookup failed:', e.message, e.stack);
    return res.status(503).json({
      error: 'تعذر الوصول لقاعدة البيانات مؤقتاً. يرجى المحاولة بعد دقيقة',
      details: e.message,
    });
  }

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // ── Employment end_date guard ───────────────────────────────────────────
  // The user passed the is_active=1 filter, but if their employment end_date
  // has passed they're no longer on the job. Flip is_active=0 (so the table
  // reflects reality) and reject the login. NULL/empty end_date = still
  // employed → never blocked. This backstops the startup sweep for servers
  // that stay up for days without a restart.
  // admin/manager accounts (role='admin') are EXEMPT — never auto-deactivated.
  if (user.role !== 'admin' && user.end_date && String(user.end_date).trim()) {
    const today = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (String(user.end_date).trim().slice(0, 10) < today) {
      try {
        db.prepare(
          "UPDATE users SET is_active = 0, updated_at = datetime('now', '+2 hours') WHERE id = ?"
        ).run(user.id);
      } catch (e) {
        console.error('[auth/login] end_date deactivation failed:', e.message);
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }
  }

  const payload = {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    department: user.department,
    management: user.management,
    extra_managements: user.extra_managements || null,
    line: user.line,
    language: user.language,
    avatar_url: user.avatar_url || null,
  };

  let accessToken, rawRefresh, hashRefresh;
  try {
    accessToken = jwt.signAccess(payload);
    rawRefresh  = jwt.generateRefreshToken();
    hashRefresh = jwt.hashToken(rawRefresh);

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
  } catch (e) {
    console.error('[auth/login] token issue failed:', e.message, e.stack);
    return res.status(503).json({
      error: 'تعذر إنشاء جلسة جديدة مؤقتاً. يرجى المحاولة بعد دقيقة',
      details: e.message,
    });
  }

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
      line: user.line,
      language: user.language,
      avatar_url: user.avatar_url || null,
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
    extra_managements: stored.extra_managements || null,
    line: stored.line,
    language: stored.language,
    avatar_url: stored.avatar_url || null,
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

// POST /api/auth/change-password — user changes their OWN password.
// Verifies the current password, validates length, then rotates the bcrypt
// hash. Existing refresh tokens are revoked so the user is logged out from
// other devices (forces a fresh login with the new password).
router.post('/change-password', authenticate, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'كلمة السر الحالية والجديدة مطلوبتان' });
  }
  if (String(new_password).length < 6) {
    return res.status(400).json({ error: 'كلمة السر الجديدة يجب أن تكون 6 أحرف على الأقل' });
  }
  if (String(new_password) === String(current_password)) {
    return res.status(400).json({ error: 'كلمة السر الجديدة لا يمكن أن تكون نفس الحالية' });
  }

  const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!bcrypt.compareSync(String(current_password), user.password_hash)) {
    return res.status(401).json({ error: 'كلمة السر الحالية غير صحيحة' });
  }

  const newHash = bcrypt.hashSync(String(new_password), 12);
  db.prepare(
    "UPDATE users SET password_hash = ?, updated_at = datetime('now', '+2 hours') WHERE id = ?"
  ).run(newHash, user.id);

  // Revoke all refresh tokens for this user — other devices/sessions get
  // signed out and must log in again with the new password.
  db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(user.id);

  return res.json({ ok: true, message: 'تم تغيير كلمة السر بنجاح' });
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const user = db.prepare(
    `SELECT id, username, full_name, role,
            department, extra_departments,
            management, extra_managements,
            line, language, avatar_url, is_active
       FROM users WHERE id = ?`
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
    'SELECT id, username, full_name, role, department, management, line, language, avatar_url FROM users WHERE id = ?'
  ).get(req.user.id);
  return res.json(user);
});

// ─── AVATAR (profile picture) ────────────────────────────────────────────────
// Note: Upload/delete are admin-only — see /api/admin/users/:id/avatar.
// Only the READ endpoint lives here so the frontend can render images.

// GET /api/auth/avatars/:filename — serve avatar file (public, no auth — non-sensitive)
router.get('/avatars/:filename', (req, res) => {
  const { filename } = req.params;
  // Strict filename whitelist: <digits>-<digits>.(jpg|png|webp)
  if (!/^\d+-\d+\.(jpg|png|webp)$/i.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const full = avatarStorage.avatarPath(filename);
  if (!avatarStorage.fileExists(filename)) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.set('Cache-Control', 'private, max-age=300'); // 5 min cache
  return res.sendFile(full);
});

module.exports = router;
