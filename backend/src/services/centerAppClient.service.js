'use strict';

/**
 * Center App Finance API — HTTP client.
 *
 * Read-only client for the external Finance Transactions API exposed by
 * center-app-2 (separate app, same academy). This module is pure transport:
 * it speaks HTTP, retries, and returns parsed JSON. It does NOT touch the DB.
 *
 * The sync engine (services/financeSync.service.js) is the only consumer.
 *
 * Configuration (env vars):
 *   CENTER_APP_API_KEY   required to enable any call (see isConfigured())
 *   CENTER_APP_API_BASE  default 'https://center-app-2-production.up.railway.app/api/external'
 *   CENTER_APP_API_TIMEOUT_MS  default 30000
 *
 * Hard-coded defaults match the API brief — if the URL ever changes, only
 * CENTER_APP_API_BASE in Railway needs updating (no redeploy).
 */

const DEFAULT_BASE = 'https://center-app-2-production.up.railway.app/api/external';
const DEFAULT_TIMEOUT_MS = 30_000;

// Backoff schedule (ms) for transient errors (5xx, network). After the last
// entry we give up and the caller decides what to do (sync engine will log
// and try again on next poll tick).
const BACKOFF_MS = [500, 1500, 4000];

function baseUrl() {
  return (process.env.CENTER_APP_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
}

function apiKey() {
  return process.env.CENTER_APP_API_KEY || '';
}

function timeoutMs() {
  const n = parseInt(process.env.CENTER_APP_API_TIMEOUT_MS || '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

/**
 * Is the client able to make calls? Returns false when no API key is set —
 * the sync engine checks this on every tick and silently skips if false,
 * so the system stays safe to deploy before the key is wired up.
 */
function isConfigured() {
  return apiKey().length > 0;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Whether to retry on this HTTP status. 5xx = server hiccup, retry. 429 = rate
// limit, also retry with backoff. Everything else (4xx) is a hard failure.
function isRetryableStatus(status) {
  return status >= 500 || status === 429;
}

/**
 * Build the URL for a GET request. Filters out undefined/null/empty params so
 * the API doesn't see "?since=undefined".
 */
function buildUrl(path, params = {}) {
  const url = new URL(baseUrl() + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * Core GET. Returns parsed JSON on 2xx, throws a structured Error otherwise.
 * Retries on 5xx / 429 / network using BACKOFF_MS. Aborts each attempt at
 * timeoutMs(). NEVER logs the API key.
 */
async function getJson(path, params = {}) {
  if (!isConfigured()) {
    const err = new Error('Center App client not configured (CENTER_APP_API_KEY missing)');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const url = buildUrl(path, params);
  // Redacted URL for logging — strips api_key query param if a caller ever
  // passed it via params (we always use the header, but defense in depth).
  const safeUrl = url.replace(/api_key=[^&]+/i, 'api_key=***');

  let lastErr = null;
  const maxAttempts = BACKOFF_MS.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs());

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': apiKey(),
          'Accept': 'application/json',
          'User-Agent': 'academy-operation-system/1.0 (finance-sync)',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        // 200/204 — parse JSON. 204 No Content is possible on some APIs;
        // brief says JSON only, but we defend anyway.
        const text = await res.text();
        if (!text) return null;
        try {
          return JSON.parse(text);
        } catch (parseErr) {
          const err = new Error(`Center App: invalid JSON in 200 response: ${parseErr.message}`);
          err.code = 'INVALID_JSON';
          err.status = res.status;
          throw err;
        }
      }

      // Read body for the error message (helpful for 400/404 debugging).
      let body = '';
      try { body = await res.text(); } catch (_) {}
      const bodySnippet = body ? body.slice(0, 300) : '';

      if (isRetryableStatus(res.status) && attempt < maxAttempts) {
        const wait = BACKOFF_MS[attempt - 1];
        console.warn(`[CenterApp] ${res.status} on ${safeUrl} — retrying in ${wait}ms (attempt ${attempt}/${maxAttempts})`);
        await sleep(wait);
        continue;
      }

      const err = new Error(`Center App API ${res.status}: ${bodySnippet || res.statusText}`);
      err.code = 'HTTP_ERROR';
      err.status = res.status;
      err.body = bodySnippet;
      throw err;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;

      // Don't retry on our own structured errors.
      if (e.code === 'HTTP_ERROR' || e.code === 'INVALID_JSON' || e.code === 'NOT_CONFIGURED') {
        throw e;
      }

      // Network / abort / DNS — retry if we have attempts left.
      if (attempt < maxAttempts) {
        const wait = BACKOFF_MS[attempt - 1];
        const kind = e.name === 'AbortError' ? 'timeout' : (e.code || e.message || 'network');
        console.warn(`[CenterApp] ${kind} on ${safeUrl} — retrying in ${wait}ms (attempt ${attempt}/${maxAttempts})`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }

  // Unreachable in practice — loop either returns or throws.
  throw lastErr || new Error('Center App: exhausted retries with no result');
}

/**
 * GET /transactions — paginated list.
 *
 * Accepted params (all optional, see API brief):
 *   from, to            YYYY-MM-DD       date filters on transaction.date
 *   since               ISO timestamp    updated_at > since (for polling)
 *   status              string           pending | approved | paid | rejected
 *   type                string           new_enrollment | renewal | ...
 *   currency            string           EGP | USD | ...
 *   agent_id            uuid
 *   department_id       uuid
 *   department          string           case-insensitive name
 *   page                int              default 1
 *   limit               int              default 50, max 500
 *
 * Returns: { page, limit, total, transactions: [...] }
 */
async function listTransactions(params = {}) {
  return getJson('/transactions', params);
}

/**
 * GET /transactions/:id — single transaction with full installments[] and
 * audit[] (created / approved / rejected / paid / edits).
 *
 * Returns: full transaction object (shape per API brief).
 * Throws with err.status=404 if the ID does not exist.
 */
async function getTransaction(id) {
  if (!id || typeof id !== 'string') {
    const err = new Error('getTransaction: id must be a non-empty string');
    err.code = 'BAD_INPUT';
    throw err;
  }
  // Encode in case Center App ever issues IDs with characters that need it.
  // (UUIDs don't, but defense in depth.)
  return getJson(`/transactions/${encodeURIComponent(id)}`);
}

module.exports = {
  isConfigured,
  listTransactions,
  getTransaction,
  // Exposed for tests / diagnostics
  _internals: {
    baseUrl,
    buildUrl,
    timeoutMs,
  },
};
