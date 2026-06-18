// ─── In-memory TTL cache for heavy READ-ONLY report endpoints ────────────────
// Why: better-sqlite3 is synchronous, so a 19–54s analytical query blocks the
// single Node event loop for ALL users + navigation while it runs. These report
// results barely change second-to-second, so caching them makes repeated opens /
// auto-refreshes / concurrent viewers return instantly instead of re-blocking.
//
// SAFETY:
//  • Key includes the user's scope (id / role / line) + path + sorted query, so
//    it NEVER serves one user's (or one line's) data to another.
//  • Busted on ANY data sync (see syncFile) → never serves stale numbers after an
//    upload / Drive sync; TTL only bounds staleness between syncs.
//  • Only applied to a curated allowlist of read-only analytics endpoints (NOT
//    interactive ones like code-problems status editing).
const DEFAULT_TTL_MS = 60 * 1000;
const MAX_ENTRIES    = 300;
const store = new Map(); // key -> { exp, body }

function _key(req) {
  const u = req.user || {};
  const q = req.query || {};
  const qs = Object.keys(q).sort().map(k => `${k}=${q[k]}`).join('&');
  return [req.method, req.baseUrl || '', req.path, qs, u.id, u.role, u.line].join('|');
}

// Express middleware factory. Caches successful (200) GET res.json bodies.
function cacheMiddleware(opts = {}) {
  const ttl = opts.ttlMs || DEFAULT_TTL_MS;
  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    const key = _key(req);
    const now = Date.now();
    const hit = store.get(key);
    if (hit && hit.exp > now) {
      res.set('X-Report-Cache', 'HIT');
      return res.json(hit.body);
    }
    if (hit) store.delete(key); // expired
    const origJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200) {
        if (store.size >= MAX_ENTRIES) {
          const oldest = store.keys().next().value; // Map preserves insertion order
          if (oldest !== undefined) store.delete(oldest);
        }
        store.set(key, { exp: Date.now() + ttl, body });
        res.set('X-Report-Cache', 'MISS');
      }
      return origJson(body);
    };
    next();
  };
}

// Clear everything — called after any data sync so reports reflect new data.
function bustReportCache() { store.clear(); }

module.exports = { cacheMiddleware, bustReportCache };
