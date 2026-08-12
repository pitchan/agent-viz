'use strict';
// Anthropic model pricing — the ENGINE's embedded table (netgain priceTable)
// prices the whole product since the 2026-08-05 unification: server.js fills
// the in-memory map from the engine at boot. The static FALLBACK below is its
// proven mirror (tests/unit/pricing-engine-mirror.test.js) and applies before
// the engine loads or when it is absent. LiteLLM never writes prices anymore:
// it is a daily drift WATCHDOG (see litellmDrift).
//
// SRP: this module's only job is `model id -> { input, output, cacheCreate,
// cacheRead, maxInput, label, history? }`. No I/O leakage to consumers — they
// call getPrice() and don't know the source.
//
// C4 (2026-08-11): the COST FORMULA and the model-id NORMALIZATION no longer
// live here. Both were twins of the engine's, and the differential probe found
// them diverged — this module's normalization knew regional routing prefixes
// and the bare `-vN` suffix while the engine's did not, so the engine reported
// "partial cost" on an id this side priced without reserve. One definition
// now, in TypeScript, reached through `pricing-engine.js`. What remains here
// is what only the server owns: the in-memory price map, the display metadata
// (`label`, `maxInput`) and the LiteLLM watchdog.

const https = require('https');
const { computeCost, normalizeModel } = require('./pricing-engine');

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

// Static fallback — covers the Claude 5 and 4.x families. Prices in USD per
// token. This is the proven offline mirror of the engine's embedded table
// (tests/unit/pricing-engine-mirror.test.js keeps the two in lockstep) — it
// covers the BOOT WINDOW only: `applyEnginePrices` is wired asynchronously in
// src/server/server.js, so a few messages can be priced before the engine table
// lands. It does NOT cover "the engine is absent": measured 2026-08-11, with
// `dist/engine` moved aside the server refuses to start at all — since C2,
// `src/server/jsonl.js` throws first. The previous wording claimed both, and
// half of it was false. Numbers
// must be kept aligned with Anthropic's public rate card. Each entry carries
// its CURRENT rates; a model whose tariff changed over time also carries its
// dated periods in its own `history` field (see claude-sonnet-5 below).
const FALLBACK = Object.freeze({
  'claude-fable-5':    { input: 1e-5, output: 5e-5,   cacheCreate: 1.25e-5, cacheRead: 1e-6, maxInput: 1_000_000, label: 'Fable 5' },
  'claude-mythos-5':   { input: 1e-5, output: 5e-5,   cacheCreate: 1.25e-5, cacheRead: 1e-6, maxInput: 1_000_000, label: 'Mythos 5' },
  'claude-opus-5':     { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7, maxInput: 1_000_000, label: 'Opus 5' },
  'claude-sonnet-5':   { input: 3e-6, output: 1.5e-5, cacheCreate: 3.75e-6, cacheRead: 3e-7, maxInput: 1_000_000, label: 'Sonnet 5',
    // Intro rate through 2026-08-31 (Anthropic announcement), sticker 3/15 after.
    history: Object.freeze([Object.freeze({
      until: '2026-09-01',
      prices: Object.freeze({ input: 2e-6, output: 1e-5, cacheCreate: 2.5e-6, cacheRead: 2e-7 }),
    })]) },
  'claude-opus-4-8':   { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7, maxInput: 1_000_000, label: 'Opus 4.8' },
  'claude-opus-4-7':   { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7, maxInput: 1_000_000, label: 'Opus 4.7' },
  'claude-opus-4-6':   { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7, maxInput: 1_000_000, label: 'Opus 4.6' },
  'claude-opus-4-5':   { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7, maxInput: 200_000,   label: 'Opus 4.5' },
  'claude-sonnet-4-6': { input: 3e-6, output: 1.5e-5, cacheCreate: 3.75e-6, cacheRead: 3e-7, maxInput: 1_000_000, label: 'Sonnet 4.6' },
  'claude-sonnet-4-5': { input: 3e-6, output: 1.5e-5, cacheCreate: 3.75e-6, cacheRead: 3e-7, maxInput: 200_000,   label: 'Sonnet 4.5' },
  'claude-haiku-4-5':  { input: 1e-6, output: 5e-6,   cacheCreate: 1.25e-6, cacheRead: 1e-7, maxInput: 200_000,   label: 'Haiku 4.5' },
});

// C4 (2026-08-11): the deliberate zero-cost list (`<synthetic>`, local Ollama
// models) used to be mirrored here too. It was DEAD CODE — measured, not
// guessed: it was only ever consulted inside this module's own computeCost,
// whose unknown-model branch no production path ever reached (proved by
// mutation: a `throw` in that branch failed 2 of 788 tests, both direct unit
// calls, no server or integration test). The single list now lives in
// src/engine/core/pricing.ts, and `known: true` on a $0 result is how a
// WANTED zero is told apart from a tariff we do not know.

let prices = { ...FALLBACK };
let lastFetched = 0;
let refreshTimer = null;

// `at` (optional, ISO UTC timestamp) selects the tariff in effect at that
// instant; omitted means "now". Dated periods travel WITH the entry (engine
// table or FALLBACK mirror); only the rates go back in time — label and
// maxInput stay from the current entry.
function getPrice(id, at) {
  if (!id) return null;
  const current = prices[id] || (() => {
    const norm = normalizeModel(id);
    return (norm && prices[norm]) || null;
  })();
  if (!current) return null;
  if (current.history) {
    const ts = at || new Date().toISOString();
    for (const period of current.history) {
      if (ts < period.until) return { ...current, ...period.prices };
    }
  }
  return current;
}

// C4 (2026-08-11): computeCost is GONE from this module. It was a twin of the
// engine's formula, and the two had already diverged (`cache_creation: null`
// threw on one side and not the other). Its unknown-model branch — the `0` and
// the `[pricing] unknown model …` warning that the audit sheet quoted as the
// server's behaviour — was never reached in production: the only caller,
// tokens.js, passed a resolved price OBJECT, and the branch was guarded by
// `typeof modelOrPrice === 'string'`. Callers now use the engine contract
// `{ usd, known, model }` from `pricing-engine.js`: `known: false` means the
// tariff is unknown and the total is incomplete, and that fact travels all the
// way to the real-time pill instead of dying in a log nobody reads.

// Derive a human label ("Opus 4.7", "Fable 5") from a canonical id when
// LiteLLM doesn't already provide one (it doesn't expose a "label" field).
// Claude 5 ids carry a single version digit (claude-fable-5), 4.x carry two.
function deriveLabel(id) {
  const m = id.match(/^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/);
  if (m) {
    const family = `${m[1][0].toUpperCase()}${m[1].slice(1)}`;
    return m[3] !== undefined ? `${family} ${m[2]}.${m[3]}` : `${family} ${m[2]}`;
  }
  return id;
}

// Parses a canonical id into its family and [major, minor] version tuple
// (minor absent = 0). Pure — no dependency on the live price map. Returns
// null for anything that doesn't match the strict "claude-<family>-N[-M]"
// shape (kept out of the new-model decision below rather than guessed at).
function familyVersionOf(canonical) {
  const m = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?$/.exec(canonical);
  if (!m) return null;
  return { family: m[1], version: [Number(m[2]), m[3] === undefined ? 0 : Number(m[3])] };
}

// Highest [major, minor] tuple currently on file for a family, read from the
// live price map (FALLBACK or the engine table, whichever is loaded) at call
// time — so the "new model" bar rises automatically as the table grows.
function familyMaxVersion(family) {
  let max = null;
  for (const key of Object.keys(prices)) {
    const fv = familyVersionOf(key);
    if (!fv || fv.family !== family) continue;
    if (!max || fv.version[0] > max[0] || (fv.version[0] === max[0] && fv.version[1] > max[1])) {
      max = fv.version;
    }
  }
  return max;
}

// LiteLLM is a WATCHDOG (vigie), not a price source: the daily fetch compares
// the public feed against the embedded table and reports drift — a different
// tariff on a known model, or a new canonical Claude model we do not carry.
// It NEVER writes into the price map. `at` (tests) defaults to "now": the
// comparison is against the rate in effect at that instant, which is exactly
// why sonnet-5's intro-rate representation in LiteLLM is not a false alarm.
//
// "New model" decision (Vincent, 2026-08-05): a canonical id ABSENT from the
// table is reported ONLY when its version is ABOVE the family's known max.
// Taken literally, "absent from the table" drowned the real signal under 109
// false alerts against the live feed — historical ids (claude-opus-4-1,
// claude-opus-4) and un-normalized regional routing variants are also
// "absent" but are not news. Known models keep the exact tariff comparison
// below unchanged.
//
// "Base tariff only" decision (Vincent, 2026-08-05, round 2): the embedded
// table represents the BASE (direct-API) tariff. Measured on the real feed
// the same day, the us./eu./au.anthropic.* regional endpoints carry a
// uniform +10% premium on all four fields over that base — a different SKU,
// not a drift of the canonical model. So tariff comparison is restricted to
// feed keys that are ALREADY canonical (normalizeModel(k) === k, i.e. the bare
// id LiteLLM also carries for every model) — every prefixed transport or
// regional variant (anthropic., vertex_ai/, bedrock/, global./us./eu./au.)
// is excluded from the tariff check. Those variants still feed the
// "new model" detection above (a new version can appear regional-first) but
// are deduplicated by canonical id — 3 variants of one new model is one
// alert, not three.
function litellmDrift(json, at) {
  const drifts = [];
  const reportedNewModels = new Set();
  for (const [k, v] of Object.entries(json)) {
    if (!v || typeof v !== 'object') continue;
    if (typeof v.input_cost_per_token !== 'number') continue;
    if (typeof v.output_cost_per_token !== 'number') continue;
    if (typeof v.cache_creation_input_token_cost !== 'number') continue;
    if (typeof v.cache_read_input_token_cost !== 'number') continue;
    if (typeof v.max_input_tokens !== 'number') continue;
    if (!/(^|\.|\/)claude-(opus|sonnet|haiku|fable|mythos)-/.test(k)) continue;
    const canonical = normalizeModel(k);
    if (!canonical || FORBIDDEN_KEYS.has(canonical)) continue;
    const upstream = {
      input: v.input_cost_per_token, output: v.output_cost_per_token,
      cacheCreate: v.cache_creation_input_token_cost, cacheRead: v.cache_read_input_token_cost,
    };
    const local = getPrice(canonical, at);
    if (!local) {
      if (reportedNewModels.has(canonical)) continue;
      const fv = familyVersionOf(canonical);
      const max = fv && familyMaxVersion(fv.family);
      const isNew = !!(fv && max
        && (fv.version[0] > max[0] || (fv.version[0] === max[0] && fv.version[1] > max[1])));
      if (isNew) {
        reportedNewModels.add(canonical);
        drifts.push({ model: canonical, kind: 'modele-nouveau', litellm: upstream, embedded: null });
      }
      continue;
    }
    if (k !== canonical) continue; // regional/transport variant — different SKU, not compared
    const differs = ['input', 'output', 'cacheCreate', 'cacheRead']
      .some(f => Math.abs(local[f] - upstream[f]) > Math.abs(local[f]) * 1e-9);
    if (differs) {
      drifts.push({
        model: canonical, kind: 'tarif-different', litellm: upstream,
        embedded: { input: local.input, output: local.output, cacheCreate: local.cacheCreate, cacheRead: local.cacheRead },
      });
    }
  }
  return drifts;
}

// Drift consumer registration — server.js plugs the SSE broadcast in here, so
// this module keeps zero I/O of its own.
let _onDrift = null;
function onPricingDrift(fn) { _onDrift = fn; }

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
          const drifts = litellmDrift(JSON.parse(chunks.join('')));
          lastFetched = Date.now();
          if (drifts.length && _onDrift) _onDrift({ checkedAt: new Date().toISOString(), drifts });
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
    if (ok) console.log('[pricing] vigie: LiteLLM feed compared against the embedded table');
    else console.log('[pricing] vigie: LiteLLM unreachable — silence (offline is a normal state)');
  });
  refreshTimer = setInterval(() => loadPricing().catch(err => console.error('[pricing] refresh failed:', err.message)), REFRESH_MS);
  refreshTimer.unref();
}

// Test hook — lets unit tests stub the price map without going through https.
function _setPricesForTest(map) {
  prices = { ...FALLBACK, ...map };
}

// UNIFICATION (2026-08-05): fill the price map from the engine's embedded
// table — the ONE tariff authority of the product, real-time pill included.
// Called at boot by server.js once the engine resolves; a missing engine is
// normal and leaves the FALLBACK mirror in place. Dated periods included.
function applyEnginePrices(table) {
  const next = Object.create(null);
  Object.assign(next, FALLBACK);
  for (const e of table.entries) {
    if (!e.model || FORBIDDEN_KEYS.has(e.model)) continue;
    next[e.model] = { ...e.current, maxInput: e.maxInput, label: e.label, history: e.history };
  }
  prices = next;
}

// C4 : ni `computeCost` ni `normalizeId` ne sortent plus d'ici. La formule et
// la normalisation ont UNE définition, dans le moteur ; qui en a besoin passe
// par `pricing-engine.js` et l'appelle par son nom du moteur,
// `normalizeModel` — un seul nom dans le produit, comme `CLAUDE_CONFIG_DIR`
// après C5.
module.exports = {
  getPrice,
  loadPricing, startPricingRefresh,
  applyEnginePrices,
  onPricingDrift,
  _FALLBACK: FALLBACK,
  _setPricesForTest,
  // Exposed for tests:
  _internals: { litellmDrift, FORBIDDEN_KEYS, MAX_BODY_BYTES },
};
