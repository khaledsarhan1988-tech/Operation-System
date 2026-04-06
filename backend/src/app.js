'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const { initDb } = require('./config/database');

const PORT = process.env.PORT || 3001;

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',').map(o => o.trim());

// ─── INITIALIZE DB THEN START SERVER ─────────────────────────────────────────
initDb().then(db => {
  // Run schema if tables don't exist
  const schemaPath = path.join(__dirname, 'db/schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    // Execute each statement separately
    schema.split(';').forEach(stmt => {
      const trimmed = stmt.trim();
      if (trimmed) {
        try { db._raw.run(trimmed); } catch (e) { /* ignore IF NOT EXISTS */ }
      }
    });
  }

  const app = express();

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: ${origin} not allowed`));
    },
    credentials: true,
  }));

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Static assets
  app.use('/assets', express.static(path.join(__dirname, '../assets')));

  // Health check
  app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  // Routes
  app.use('/api/auth',    require('./routes/auth.routes'));
  app.use('/api/upload',  require('./routes/upload.routes'));
  app.use('/api/agent',   require('./routes/agent.routes'));
  app.use('/api/clients', require('./routes/clients.routes'));
  app.use('/api/remarks', require('./routes/remarks.routes'));
  app.use('/api/leader',  require('./routes/leader.routes'));
  app.use('/api/admin',   require('./routes/admin.routes'));
  app.use('/api/export',  require('./routes/export.routes'));

  // 404
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // Error handler
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error(err.stack);
    res.status(500).json({
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
    });
  });

  app.listen(PORT, () => {
    console.log(`🚀 Academy System backend running on port ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => { db.close(); process.exit(0); });
  process.on('SIGINT',  () => { db.close(); process.exit(0); });

}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
