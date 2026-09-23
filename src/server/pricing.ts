'use strict';
// Anthropic model pricing: the server's current tariff (embedded table + adopted
// prices, see pricing-state.ts) prices the whole product. The watchdog (vigie)
// reads Anthropic's own pricing page and reports every gap with that tariff.
//
// SRP: this module's only job is `model id -> { input, output, cacheCreate,
// cacheRead, maxInput, label, history }` and the gaps with Anthropic's page. No
// I/O leakage to consumers — they call getPrice() and don't know the source.
//
// The COST FORMULA and the model-id NORMALIZATION live in the engine and are
// imported from it: two copies diverge silently. What remains here is what only
// the server owns: the price map, display metadata and the watchdog.

import https from 'node:https';
import { normalizeModel } from '../engine/core/pricing.ts';
import type { ModelPrices, PricePeriod, Pricing } from '../engine/core/pricing.ts';
import { currentPricing } from './pricing-state.ts';
import { parseModelsPage, parsePricingPage } from './official-pricing.ts';

// Les deux pages officielles, dans leur version Markdown : les tarifs, et la fenêtre
// de contexte que la page des tarifs ne porte pas.
const PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing.md';
const MODELS_URL = 'https://platform.claude.com/docs/en/models/overview.md';
// Hard cap on the response body size so a malicious mirror or MITM can't exhaust
// memory by streaming an unbounded payload. Each page weighs about 50 KB.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

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

/** Un écart entre le barème du serveur et la page des tarifs d'Anthropic — deux natures :
 *  un modèle jamais vu (`modele-nouveau`, `embedded` alors `null`), ou un tarif
 *  différent sur un modèle déjà connu (`tarif-different`). */
interface Drift {
  model: string;
  kind: 'modele-nouveau' | 'tarif-different';
  official: ModelPrices;
  embedded: ModelPrices | null;
  /** Fenêtre de contexte à retenir ; null quand la page des modèles ne porte pas ce
   *  modèle nouveau — il ne peut alors pas être adopté. */
  maxInput: number | null;
}

const FIELDS = ['input', 'output', 'cacheCreate', 'cacheRead'] as const;

// "New model" rule: a model ABSENT from the tariff is reported ONLY when its
// version is ABOVE its family's known max. The page also lists retired models
// (claude-opus-4-1, claude-haiku-3-5) that the table never carried: they are not
// news. `at` (tests) defaults to "now": a known model is compared against the
// rate in effect at that instant.
function officialDrift(
  official: ReadonlyMap<string, ModelPrices>, windows: ReadonlyMap<string, number>, at?: string,
): Drift[] {
  const drifts: Drift[] = [];
  for (const [model, upstream] of official) {
    const local = getPrice(model, at);
    if (!local) {
      const fv = familyVersionOf(model);
      const max = fv && familyMaxVersion(fv.family);
      const isNew = !!(fv && max
        && (fv.version[0] > max[0] || (fv.version[0] === max[0] && fv.version[1] > max[1])));
      if (isNew) drifts.push({ model, kind: 'modele-nouveau', official: upstream, embedded: null, maxInput: windows.get(model) ?? null });
      continue;
    }
    if (FIELDS.some(f => Math.abs(local[f] - upstream[f]) > Math.abs(local[f]) * 1e-9)) {
      drifts.push({
        model, kind: 'tarif-different', official: upstream, maxInput: local.maxInput,
        embedded: { input: local.input, output: local.output, cacheCreate: local.cacheCreate, cacheRead: local.cacheRead },
      });
    }
  }
  return drifts;
}

/** Le relevé d'un passage de la vigie. */
interface DriftReport {
  checkedAt: string;
  drifts: Drift[];
}

/** Une dérive vue par la vigie, datée de sa première détection. */
interface KnownDrift extends Drift { firstSeenAt: string }

// Le dernier rapport fait foi : une dérive qu'il ne porte plus est réglée.
// Une dérive revue à l'identique garde sa première date ; d'autres prix la redatent.
const knownDrifts = new Map<string, KnownDrift>();
let lastCheckedAt: string | null = null;

function recordDrifts(report: DriftReport): void {
  const next = new Map<string, KnownDrift>();
  for (const d of report.drifts) {
    const seen = knownDrifts.get(d.model);
    const same = seen !== undefined && seen.kind === d.kind
      && FIELDS.every(f => seen.official[f] === d.official[f]);
    next.set(d.model, { ...d, firstSeenAt: same ? seen.firstSeenAt : report.checkedAt });
  }
  knownDrifts.clear();
  for (const [m, d] of next) knownDrifts.set(m, d);
  lastCheckedAt = report.checkedAt;
}

function forgetDrift(model: string): void { knownDrifts.delete(model); }

/** Ce que la vigie sait à cet instant : son dernier passage (null avant le premier) et les dérives en cours. */
interface DriftSnapshot { checkedAt: string | null; drifts: KnownDrift[] }
function driftSnapshot(): DriftSnapshot { return { checkedAt: lastCheckedAt, drifts: [...knownDrifts.values()] }; }

// Body is buffered as a list of chunks then joined once at the end, which avoids
// the quadratic `body += chunk`. The MAX_BODY_BYTES cap aborts an unbounded response.
function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10_000 }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${url} a répondu ${res.statusCode}`)); }
      const chunks: string[] = [];
      let received = 0;
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        received += c.length;
        if (received > MAX_BODY_BYTES) { req.destroy(); reject(new Error(`${url} dépasse ${MAX_BODY_BYTES} octets`)); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(chunks.join('')));
    });
    req.on('error', err => reject(new Error(`${url} injoignable (${err.message})`)));
    req.on('timeout', () => { req.destroy(); reject(new Error(`${url} n'a pas répondu en 10 s`)); });
  });
}

// Un passage de la vigie, sans nouvelle tentative. Rend null quand il a abouti, sinon
// la cause : page injoignable, ou page dont la forme a changé et qui ne se lit plus.
// Un échec ne touche pas aux dérives déjà relevées.
async function loadPricing(): Promise<string | null> {
  try {
    const [pricingPage, modelsPage] = await Promise.all([fetchText(PRICING_URL), fetchText(MODELS_URL)]);
    const drifts = officialDrift(parsePricingPage(pricingPage), parseModelsPage(modelsPage));
    recordDrifts({ checkedAt: new Date().toISOString(), drifts });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

// Ni `computeCost` ni `normalizeModel` ne sortent d'ici : la formule et la
// normalisation ont UNE définition, dans le moteur, et qui en a besoin l'importe
// sous son nom du moteur.
// Exposed for tests:
const _internals = { officialDrift };

export {
  getPrice,
  loadPricing,
  recordDrifts, forgetDrift, driftSnapshot,
  _internals,
};

export type { Drift, KnownDrift, DriftSnapshot };
