'use strict';
// Anthropic model pricing — fetched from LiteLLM's public price feed at boot,
// cached in memory, refreshed every 24h. Falls back to a static map so the
// server boots and computes costs even with no network.
//
// SRP: this module's only job is `model id -> { input, output, cacheCreate,
// cacheRead, maxInput, label }`. No I/O leakage to consumers — they call
// getPrice() / computeCost() and don't know the source.

const https = require('https');

const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const REFRESH_MS = 24 * 60 * 60 * 1000;
// Hard cap on the response body size so a malicious mirror or MITM can't
// exhaust memory by streaming an unbounded payload. The real file is ~1.5 MB
// at time of writing; 5 MB leaves headroom for growth.
const MAX_BODY_BYTES = 5 * 1024 * 1024;
// Reserved property names — set on a plain object literal would mutate the
// prototype chain or shadow built-ins. Skipped during ingest as defence in
// depth; the regex filter above already excludes anything not matching
// claude-(opus|sonnet|haiku)-X-Y.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Static fallback — covers Claude 4.x family. Prices in USD per token.
// Used at boot before the first fetch resolves and as a permanent safety net
// if the LiteLLM URL is unreachable. Numbers must be kept aligned with
// Anthropic's public rate card.
const FALLBACK = Object.freeze({
  'claude-opus-4-7':   { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7, maxInput: 1_000_000, label: 'Opus 4.7' },
  'claude-opus-4-6':   { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7, maxInput: 1_000_000, label: 'Opus 4.6' },
  'claude-opus-4-5':   { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7, maxInput: 200_000,   label: 'Opus 4.5' },
  'claude-sonnet-4-6': { input: 3e-6, output: 1.5e-5, cacheCreate: 3.75e-6, cacheRead: 3e-7, maxInput: 1_000_000, label: 'Sonnet 4.6' },
  'claude-sonnet-4-5': { input: 3e-6, output: 1.5e-5, cacheCreate: 3.75e-6, cacheRead: 3e-7, maxInput: 200_000,   label: 'Sonnet 4.5' },
  'claude-haiku-4-5':  { input: 1e-6, output: 5e-6,   cacheCreate: 1.25e-6, cacheRead: 1e-7, maxInput: 200_000,   label: 'Haiku 4.5' },
});

let prices = { ...FALLBACK };
let lastFetched = 0;
let refreshTimer = null;

// Strip provider-specific prefixes/suffixes ("anthropic.", "bedrock/",
// "-v1:0", "-20251101", "@20250929") so a single canonical id resolves prices
// regardless of which transport the model was called through.
function normalizeId(id) {
  if (!id || typeof id !== 'string') return null;
  let s = id.trim();
  s = s.replace(/^bedrock\//, '');
  s = s.replace(/^vertex_ai\//, '');
  s = s.replace(/^vertex\//, '');
  s = s.replace(/^anthropic\./, '');
  s = s.replace(/^anthropic\//, '');
  s = s.replace(/-v\d+:\d+$/, '');
  s = s.replace(/[-@]\d{8}$/, '');
  return s;
}

function getPrice(id) {
  if (!id) return null;
  if (prices[id]) return prices[id];
  const norm = normalizeId(id);
  return (norm && prices[norm]) || null;
}

// Cost (USD) for a single message's usage object. Two call shapes:
//   computeCost(usage, 'claude-sonnet-4-5') — convenience, looks up the price
//   computeCost(usage, priceObj)            — hot-path, caller has already
//                                             resolved the price
// Returns 0 when the model/price is unknown — better to under-report than
// crash, but a one-shot warning per unknown model is logged so silent zero
// costs aren't invisible. Cache pricing uses the 5min rate (default Anthropic
// tier); 1h cache and >200k tiered pricing are not modeled here.
const _loggedUnknownModels = new Set();
function computeCost(usage, modelOrPrice) {
  if (!usage) return 0;
  const p = (modelOrPrice && typeof modelOrPrice === 'object')
    ? modelOrPrice
    : getPrice(modelOrPrice);
  if (!p) {
    if (typeof modelOrPrice === 'string' && modelOrPrice && !_loggedUnknownModels.has(modelOrPrice)) {
      _loggedUnknownModels.add(modelOrPrice);
      console.error(`[pricing] unknown model "${modelOrPrice}" — cost reported as 0`);
    }
    return 0;
  }
  return (
    (usage.input_tokens || 0) * p.input +
    (usage.output_tokens || 0) * p.output +
    (usage.cache_creation_input_tokens || 0) * p.cacheCreate +
    (usage.cache_read_input_tokens || 0) * p.cacheRead
  );
}

// Derive a human label ("Opus 4.7") from a canonical id when LiteLLM
// doesn't already provide one (it doesn't expose a "label" field).
function deriveLabel(id) {
  const m = id.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
  return id;
}

function ingestLitellm(json) {
  // Object.create(null) so a `__proto__` key in the JSON can't escape the
  // regex/forbidden-keys filter and mutate the prototype chain — every assign
  // to next.__proto__ on a null-proto object becomes a plain property.
  const next = Object.create(null);
  Object.assign(next, FALLBACK);
  for (const [k, v] of Object.entries(json)) {
    if (!v || typeof v !== 'object') continue;
    // Reject incomplete entries: a partial price (missing output cost, missing
    // cache rates, or missing context window) would silently under-report cost
    // or display a wrong context bar. The static FALLBACK already covers the
    // canonical id, so skipping leaves the correct value in place.
    if (typeof v.input_cost_per_token !== 'number') continue;
    if (typeof v.output_cost_per_token !== 'number') continue;
    if (typeof v.cache_creation_input_token_cost !== 'number') continue;
    if (typeof v.cache_read_input_token_cost !== 'number') continue;
    if (typeof v.max_input_tokens !== 'number') continue;
    // Match Claude entries across all transports.
    if (!/(^|\.|\/)claude-(opus|sonnet|haiku)-/.test(k)) continue;
    const canonical = normalizeId(k);
    if (!canonical || FORBIDDEN_KEYS.has(canonical)) continue;
    next[canonical] = {
      input: v.input_cost_per_token,
      output: v.output_cost_per_token,
      cacheCreate: v.cache_creation_input_token_cost,
      cacheRead: v.cache_read_input_token_cost,
      maxInput: v.max_input_tokens,
      label: deriveLabel(canonical),
    };
  }
  prices = next;
}

// One-shot fetch with no retries — the in-memory map keeps the previous
// value (or FALLBACK) if this fails. Resolves to a boolean for callers who
// want to log success.
//
// Body is buffered as a list of chunks then joined once at the end; this
// avoids the quadratic string concat that `body += chunk` would produce on
// large payloads. A hard MAX_BODY_BYTES cap aborts the stream if the server
// tries to feed us an unbounded response.
function loadPricing() {
  return new Promise(resolve => {
    const req = https.get(LITELLM_URL, { timeout: 10_000 }, res => {
      if (res.statusCode !== 200) { res.resume(); return resolve(false); }
      const chunks = [];
      let received = 0;
      let aborted = false;
      res.setEncoding('utf8');
      res.on('data', c => {
        if (aborted) return;
        received += c.length;
        if (received > MAX_BODY_BYTES) {
          aborted = true;
          req.destroy();
          console.error(`[pricing] response exceeded ${MAX_BODY_BYTES} bytes — aborted`);
          return resolve(false);
        }
        chunks.push(c);
      });
      res.on('end', () => {
        if (aborted) return;
        try {
          ingestLitellm(JSON.parse(chunks.join('')));
          lastFetched = Date.now();
          resolve(true);
        } catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// Fire-and-forget kickoff used at server boot. Schedules a 24h refresh on
// first success. Idempotent — the timer guard short-circuits BEFORE the
// initial fetch so a second call doesn't trigger a duplicate HTTPS round-trip.
function startPricingRefresh() {
  if (refreshTimer) return;
  loadPricing().then(ok => {
    if (ok) console.log('[pricing] loaded from LiteLLM');
    else console.log('[pricing] using fallback rate card (LiteLLM unreachable)');
  });
  refreshTimer = setInterval(() => loadPricing().catch(err => console.error('[pricing] refresh failed:', err.message)), REFRESH_MS);
  refreshTimer.unref();
}

// Test hook — lets unit tests stub the price map without going through https.
function _setPricesForTest(map) {
  prices = { ...FALLBACK, ...map };
}

module.exports = {
  getPrice, computeCost,
  loadPricing, startPricingRefresh,
  normalizeId,
  _FALLBACK: FALLBACK,
  _setPricesForTest,
  // Exposed for tests:
  _internals: { ingestLitellm, FORBIDDEN_KEYS, MAX_BODY_BYTES },
};
