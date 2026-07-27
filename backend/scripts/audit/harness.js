/* Reusable READ-ONLY audit harness for the Academy system.
 *
 * - Downloads a live snapshot via the read-only data-export API (key from the
 *   DATA_EXPORT_API_KEY env var — NEVER hard-coded, per the constitution).
 * - Boots an in-process Express server with the SAME routers as app.js, with an
 *   auth stub injecting an admin (line='All') so any real endpoint can be hit on
 *   the snapshot — no manual backup, no hand-mirrored logic.
 * - Provides call(path) to run any endpoint and a read-only better-sqlite3 handle.
 *
 * Usage: required by run.js / individual check modules. Snapshot + run copies are
 * written here and git-ignored; they are cleaned by close().
 */
const path = require('path');
const fs = require('fs');
const https = require('https');

const BACKEND = path.resolve(__dirname, '../..');           // .../backend
const SNAP = path.join(__dirname, '.snapshot.db');          // cached live snapshot
const RUN = path.join(__dirname, '.run.db');                // per-boot working copy
const EXPORT_URL = 'https://operation-system-production.up.railway.app/api/data-export/db';

function _rm(p) { for (const s of ['', '-wal', '-shm']) { try { fs.rmSync(p + s); } catch (_) {} } }

// Download a fresh snapshot (reuse a recent one unless force / AUDIT_REUSE unset).
async function downloadSnapshot({ force = false, maxAgeMin = 20 } = {}) {
  const key = process.env.DATA_EXPORT_API_KEY;
  if (!key) throw new Error('Set DATA_EXPORT_API_KEY (read-only export key) before running the audit.');
  if (!force && fs.existsSync(SNAP)) {
    const ageMin = (Date.now() - fs.statSync(SNAP).mtimeMs) / 60000;
    if (ageMin <= maxAgeMin) { console.log(`[harness] reusing snapshot (${ageMin.toFixed(0)}m old, ${(fs.statSync(SNAP).size/1e6).toFixed(0)}MB)`); return SNAP; }
  }
  console.log('[harness] downloading live snapshot…');
  await new Promise((res, rej) => {
    const f = fs.createWriteStream(SNAP);
    https.get(EXPORT_URL, { headers: { 'X-Export-Key': key } }, r => {
      if (r.statusCode !== 200) { rej(new Error('data-export HTTP ' + r.statusCode)); return; }
      r.pipe(f); f.on('finish', () => f.close(res));
    }).on('error', rej);
  });
  console.log(`[harness] snapshot ${(fs.statSync(SNAP).size/1e6).toFixed(0)}MB`);
  return SNAP;
}

// Boot the in-process server on a snapshot copy. Returns { call, db, close }.
async function bootServer(snapshotPath = SNAP) {
  _rm(RUN);
  fs.copyFileSync(snapshotPath, RUN);
  process.env.DB_PATH = RUN;

  // ── auth stub (inject admin, pass all role guards) via require-cache ──
  const ap = require.resolve(path.join(BACKEND, 'src/middleware/auth'));
  require.cache[ap] = { id: ap, filename: ap, loaded: true, exports: {
    // management:'All' = super-admin. Without it userScope() yields management:null
    // and buildListWhere() narrows to `management IS NULL OR 'All'`, which matches
    // NO real row (everything is 'Customer Services'/'Education'/…) — endpoints
    // then return empty sets and checks fail for a reason that does not exist in
    // production. The audit actor must be the widest-scoped admin.
    authenticate: (q, _r, n) => { q.user = { id: 1, role: 'admin', line: 'All', management: 'All', full_name: 'Audit', username: 'audit' }; n(); },
  } };
  const rp = require.resolve(path.join(BACKEND, 'src/middleware/roles'));
  // Must mirror EVERY export of src/middleware/roles.js — a missing one makes
  // require() throw inside a router, the harness silently skips that router, and
  // its endpoints then 404 in the audit as if the feature were broken.
  const pass = (_q, _r, n) => n();
  const passFactory = () => pass;
  require.cache[rp] = { id: rp, filename: rp, loaded: true, exports: {
    requireRole: passFactory,
    requireAnyRole: passFactory,
    requireSuperAdmin: pass,
    requireManagement: passFactory,
    requirePageOrManagement: passFactory,
    requireOwner: pass,
    requireOwnerOrManagement: passFactory,
    requireSuperAdminOrPage: passFactory,
  } };

  require(path.join(BACKEND, 'src/config/database')).initDb();

  const express = require('express');
  const app = express();
  app.use(express.json());
  // Mount the read-report routers at the SAME prefixes as app.js so endpoint
  // paths match the real system exactly.
  const mount = (prefix, mod) => { try { app.use(prefix, require(path.join(BACKEND, 'src/routes', mod))); } catch (e) { console.warn(`[harness] skip ${mod}: ${e.message}`); } };
  mount('/api/reports', 'reports.routes');
  mount('/api/team', 'team.routes');
  mount('/api/org-chart', 'org-chart.routes');
  mount('/api/trainer-salaries', 'trainer-salaries.routes');
  mount('/api/reschedules', 'reschedules.routes');
  mount('/api/cs', 'cs.routes');
  mount('/api/cs-sales-register', 'cs-sales-register.routes');
  mount('/api/membership-prices', 'membership-prices.routes');
  mount('/api/enrollment', 'enrollment.routes');
  mount('/api/distribution', 'distribution.routes');
  mount('/api/finance', 'finance.routes');
  mount('/api/clients-finance', 'clients-finance.routes');
  mount('/api/remarks', 'remarks.routes');
  mount('/api/holidays', 'holidays.routes');
  mount('/api/todos', 'todos.routes');
  mount('/api/drive', 'drive.routes');
  mount('/api/admin', 'admin.routes');
  mount('/api/remarks-monitor', 'remarks-monitor.routes');

  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const port = srv.address().port;
  const Database = require('better-sqlite3');
  const db = new Database(RUN, { readonly: true });

  const call = async (p) => {
    const r = await fetch(`http://127.0.0.1:${port}${p.startsWith('/api') ? '' : '/api'}${p}`);
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (_) {}
    return { status: r.status, json, text };
  };
  const close = () => { try { db.close(); } catch (_) {} try { srv.close(); } catch (_) {} _rm(RUN); };

  return { call, db, port, close };
}

module.exports = { downloadSnapshot, bootServer, SNAP, BACKEND };
