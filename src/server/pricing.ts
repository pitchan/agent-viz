'use strict';
// Anthropic model pricing: the server's current tariff (embedded table + adopted
// prices, see pricing-state.ts) prices the whole product. LiteLLM reports drift
// (see litellmDrift); one of its prices counts only once the user adopts it.
//
// SRP: this module's only job is `model id -> { input, output, cacheCreate,
// cacheRead, maxInput, label, history }`. No I/O leakage to consumers — they
// call getPrice() and don't know the source.
//
// The COST FORMULA and the model-id NORMALIZATION live in the engine and are
// imported from it: two copies diverge silently. What remains here is what only
// the server owns: the price map, display metadata and the LiteLLM watchdog.

import https from 'node:https';
import { normalizeModel } from '../engine/core/pricing.ts';
import type { ModelPrices, PricePeriod, Pricing } from '../engine/core/pricing.ts';
import { currentPricing } from './pricing-state.ts';

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

/** Une entrée de la carte de prix — les quatre tarifs (hérités du moteur,
 *  `ModelPrices`) plus les métadonnées d'affichage, et les barèmes antérieurs
 *  datés (liste vide pour un modèle dont le tarif n'a jamais changé). */
interface PriceEntry extends ModelPrices {
  readonly maxInput: number;
  readonly label: string;
  readonly history: readonly PricePeriod[];
}

// La liste des zéros voulus (`<synthetic>`, modèles locaux) vit dans `src/engine/core/pricing.ts`
// seulement ; `known: true` sur un résultat à 0 $ distingue un zéro VOULU d'un tarif inconnu.

// Rebuilt when the current tariff changes, not on every read: getPrice runs on
// every message of the pill. A Map, not an object: a model id read from a
// third-party transcript never matches an inherited property such as `constructor`.
const maps = new WeakMap<Pricing, ReadonlyMap<string, PriceEntry>>();
function priceMap(): ReadonlyMap<string, PriceEntry> {
  const pricing = currentPricing();
  let map = maps.get(pricing);
  if (!map) {
    map = new Map(pricing.priceTable().entries.map(e => [e.model, { ...e.current, maxInput: e.maxInput, label: e.label, history: e.history }]));
    maps.set(pricing, map);
  }
  return map;
}
let lastFetched = 0;
let refreshTimer: NodeJS.Timeout | null = null;

// `at` (optional, ISO UTC timestamp) selects the tariff in effect at that
// instant; omitted means "now". Dated periods travel WITH the entry; only the
// rates go back in time — label and maxInput stay from the current entry.
function getPrice(id: string | null | undefined, at?: string): PriceEntry | null {
  if (!id) return null;
  const current = priceMap().get(id) ?? priceMap().get(normalizeModel(id) ?? '');
  if (!current) return null;
  const ts = at || new Date().toISOString();
  for (const period of current.history) {
    if (ts < period.until) return { ...current, ...period.prices };
  }
  return current;
}

// No cost formula here: callers use the engine's `computeCost` contract
// `{ usd, known, model }`. `known: false` means the tariff is unknown and the
// total incomplete, and that fact travels to the real-time pill.

/** Famille et couple [majeur, mineur] (mineur absent = 0) — `null` hors forme. */
interface FamilyVersion {
  family: string;
  version: readonly [number, number];
}

// Parses a canonical id into its family and [major, minor] version tuple
// (minor absent = 0). Pure — no dependency on the live price map. Returns
// null for anything that doesn't match the strict "claude-<family>-N[-M]"
// shape (kept out of the new-model rule below rather than guessed at).
function familyVersionOf(canonical: string): FamilyVersion | null {
  const m = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?$/.exec(canonical);
  if (!m) return null;
  const family = m[1];
  if (family === undefined) return null;
  return { family, version: [Number(m[2]), m[3] === undefined ? 0 : Number(m[3])] };
}

// Highest [major, minor] tuple on file for a family, read from the price map —
// so the "new model" bar rises as the table grows or a model is adopted.
function familyMaxVersion(family: string): readonly [number, number] | null {
  let max: readonly [number, number] | null = null;
  for (const key of priceMap().keys()) {
    const fv = familyVersionOf(key);
    if (!fv || fv.family !== family) continue;
    if (!max || fv.version[0] > max[0] || (fv.version[0] === max[0] && fv.version[1] > max[1])) {
      max = fv.version;
    }
  }
  return max;
}

/** Un écart entre le barème embarqué et le flux LiteLLM — deux natures :
 *  un modèle canonique jamais vu (`modele-nouveau`, `embedded` alors `null`),
 *  ou un tarif différent sur un modèle déjà connu (`tarif-different`). */
interface Drift {
  model: string;
  kind: 'modele-nouveau' | 'tarif-different';
  litellm: ModelPrices;
  embedded: ModelPrices | null;
  /** Fenêtre de contexte que LiteLLM publie : un modèle adopté la reprend. */
  maxInput: number;
}

// LiteLLM is a WATCHDOG (vigie), not a price source: the daily fetch compares
// the public feed against the embedded table and reports drift — a different
// tariff on a known model, or a new canonical Claude model we do not carry.
// It never writes into the price map itself: a price enters only through the
// user's adoption (price-adoption.ts). `at` (tests) defaults to "now": the
// comparison is against the rate in effect at that instant, which is exactly
// why sonnet-5's intro-rate representation in LiteLLM is not a false alarm.
//
// "New model" rule: a canonical id ABSENT from the table is reported ONLY when
// its version is ABOVE the family's known max. Taken literally, "absent from
// the table" would drown the real signal — historical ids (claude-opus-4-1,
// claude-opus-4) and un-normalized regional routing variants are also
// "absent" but are not news. Known models keep the exact tariff comparison
// below.
//
// "Base tariff only" rule: the embedded table represents the BASE (direct-API)
// tariff. On the live feed, the us./eu./au.anthropic.* regional endpoints carry
// a uniform premium on all four fields over that base — a different SKU,
// not a drift of the canonical model. So tariff comparison is restricted to
// feed keys that are ALREADY canonical (normalizeModel(k) === k, i.e. the bare
// id LiteLLM also carries for every model) — every prefixed transport or
// regional variant (anthropic., vertex_ai/, bedrock/, global./us./eu./au.)
// is excluded from the tariff check. Those variants still feed the
// "new model" detection above (a new version can appear regional-first) but
// are deduplicated by canonical id — 3 variants of one new model is one
// alert, not three.
function litellmDrift(json: Record<string, unknown>, at?: string): Drift[] {
  const drifts: Drift[] = [];
  const reportedNewModels = new Set<string>();
  for (const [k, v] of Object.entries(json)) {
    if (!v || typeof v !== 'object') continue;
    const rec = v as Record<string, unknown>;
    if (typeof rec.input_cost_per_token !== 'number') continue;
    if (typeof rec.output_cost_per_token !== 'number') continue;
    if (typeof rec.cache_creation_input_token_cost !== 'number') continue;
    if (typeof rec.cache_read_input_token_cost !== 'number') continue;
    if (typeof rec.max_input_tokens !== 'number') continue;
    if (!/(^|\.|\/)claude-(opus|sonnet|haiku|fable|mythos)-/.test(k)) continue;
    const canonical = normalizeModel(k);
    if (!canonical || FORBIDDEN_KEYS.has(canonical)) continue;
    const upstream: ModelPrices = {
      input: rec.input_cost_per_token, output: rec.output_cost_per_token,
      cacheCreate: rec.cache_creation_input_token_cost, cacheRead: rec.cache_read_input_token_cost,
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
        drifts.push({ model: canonical, kind: 'modele-nouveau', litellm: upstream, embedded: null, maxInput: rec.max_input_tokens });
      }
      continue;
    }
    if (k !== canonical) continue; // regional/transport variant — different SKU, not compared
    const differs = (['input', 'output', 'cacheCreate', 'cacheRead'] as const)
      .some(f => Math.abs(local[f] - upstream[f]) > Math.abs(local[f]) * 1e-9);
    if (differs) {
      drifts.push({
        model: canonical, kind: 'tarif-different', litellm: upstream, maxInput: rec.max_input_tokens,
        embedded: { input: local.input, output: local.output, cacheCreate: local.cacheCreate, cacheRead: local.cacheRead },
      });
    }
  }
  return drifts;
}

/** Enveloppe portée à l'abonné, une seule fois par cycle de rafraîchissement. */
interface DriftReport {
  checkedAt: string;
  drifts: Drift[];
}

/** Une dérive vue par la vigie, datée de sa première détection. */
interface KnownDrift extends Drift { firstSeenAt: string }

// Le dernier rapport fait foi : une dérive qu'il ne porte plus est réglée.
// Une dérive revue à l'identique garde sa première date ; d'autres prix la redatent.
const knownDrifts = new Map<string, KnownDrift>();

function recordDrifts(report: DriftReport): void {
  const next = new Map<string, KnownDrift>();
  for (const d of report.drifts) {
    const seen = knownDrifts.get(d.model);
    const same = seen !== undefined && seen.kind === d.kind
      && (['input', 'output', 'cacheCreate', 'cacheRead'] as const).every(f => seen.litellm[f] === d.litellm[f]);
    next.set(d.model, { ...d, firstSeenAt: same ? seen.firstSeenAt : report.checkedAt });
  }
  knownDrifts.clear();
  for (const [m, d] of next) knownDrifts.set(m, d);
}

function driftFor(model: string): KnownDrift | null { return knownDrifts.get(model) ?? null; }
function forgetDrift(model: string): void { knownDrifts.delete(model); }

// Drift consumer registration — server.ts plugs the SSE broadcast in here, so
// this module keeps zero I/O of its own.
let _onDrift: ((report: DriftReport) => void) | null = null;
function onPricingDrift(fn: (report: DriftReport) => void): void { _onDrift = fn; }

// One-shot fetch with no retries: a failure only means no drift report this
// cycle. Resolves to a boolean for callers who want to log success.
//
// Body is buffered as a list of chunks then joined once at the end; this
// avoids the quadratic string concat that `body += chunk` would produce on
// large payloads. A hard MAX_BODY_BYTES cap aborts the stream if the server
// tries to feed us an unbounded response.
function loadPricing(): Promise<boolean> {
  return new Promise(resolve => {
    const req = https.get(LITELLM_URL, { timeout: 10_000 }, res => {
      if (res.statusCode !== 200) { res.resume(); return resolve(false); }
      const chunks: string[] = [];
      let received = 0;
      let aborted = false;
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
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
          const report = { checkedAt: new Date().toISOString(), drifts: litellmDrift(JSON.parse(chunks.join(''))) };
          lastFetched = Date.now();
          recordDrifts(report);
          if (report.drifts.length && _onDrift) _onDrift(report);
          resolve(true);
        } catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// Fire-and-forget kickoff used at server boot: one fetch now, then one every 24h
// whatever the outcome. Idempotent — the timer guard short-circuits BEFORE the
// initial fetch so a second call doesn't trigger a duplicate HTTPS round-trip.
function startPricingRefresh(): void {
  if (refreshTimer) return;
  loadPricing().then(ok => {
    if (ok) console.log('[pricing] vigie: LiteLLM feed compared against the embedded table');
    else console.log('[pricing] vigie: LiteLLM unreachable — silence (offline is a normal state)');
  });
  refreshTimer = setInterval(() => loadPricing().catch((err: unknown) => console.error('[pricing] refresh failed:', err instanceof Error ? err.message : String(err))), REFRESH_MS);
  refreshTimer.unref();
}

// Ni `computeCost` ni `normalizeModel` ne sortent d'ici : la formule et la
// normalisation ont UNE définition, dans le moteur, et qui en a besoin l'importe
// sous son nom du moteur.
// Exposed for tests:
const _internals = { litellmDrift, FORBIDDEN_KEYS, MAX_BODY_BYTES };

export {
  getPrice,
  loadPricing, startPricingRefresh,
  onPricingDrift,
  recordDrifts, driftFor, forgetDrift,
  _internals,
};

// L'onglet fabrique l'alerte de la vigie sur cette forme
// (src/web/viz-pricing-drift-alert.ts), par un import de type que le service efface.
export type { Drift, KnownDrift };
