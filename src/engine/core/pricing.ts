import type { RawUsage } from './events.ts';
import { countOrZero } from './usage.ts';

export interface ModelPrices {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

// Table statique embarquée (local-only : jamais de fetch).
// Contre-vérifiée au centime sur des sessions réelles via l'API /tokens
// d'agent-viz. USD par token.
// PRICES = tarif COURANT ; les barèmes antérieurs vivent dans PRICE_HISTORY.
const PRICES: Record<string, ModelPrices> = {
  // Famille Claude 5 (2026).
  'claude-fable-5': { input: 1e-5, output: 5e-5, cacheCreate: 1.25e-5, cacheRead: 1e-6 },
  // Même palier que Fable 5, sauf la relecture de cache : 0,25 $/M, soit 0,025 × l'entrée.
  'claude-fable-5-1': { input: 1e-5, output: 5e-5, cacheCreate: 1.25e-5, cacheRead: 2.5e-7 },
  'claude-mythos-5-1': { input: 1e-5, output: 5e-5, cacheCreate: 1.25e-5, cacheRead: 2.5e-7 },
  'claude-mythos-5': { input: 1e-5, output: 5e-5, cacheCreate: 1.25e-5, cacheRead: 1e-6 },
  // Relecture de cache à 0,05 × l'entrée, et non 0,1 × comme les autres Opus.
  'claude-opus-5-5': { input: 4e-6, output: 2e-5, cacheCreate: 5e-6, cacheRead: 2e-7 },
  'claude-opus-5': { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7 },
  // Le tarif de lancement est devenu le tarif normal : la hausse à 3/15 annoncée
  // n'a pas eu lieu (page des tarifs d'Anthropic).
  'claude-sonnet-5': { input: 2e-6, output: 1e-5, cacheCreate: 2.5e-6, cacheRead: 2e-7 },
  'claude-opus-4-8': { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7 },
  'claude-opus-4-7': { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7 },
  'claude-opus-4-6': { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7 },
  'claude-opus-4-5': { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7 },
  'claude-sonnet-4-6': { input: 3e-6, output: 1.5e-5, cacheCreate: 3.75e-6, cacheRead: 3e-7 },
  'claude-sonnet-4-5': { input: 3e-6, output: 1.5e-5, cacheCreate: 3.75e-6, cacheRead: 3e-7 },
  'claude-haiku-4-5': { input: 1e-6, output: 5e-6, cacheCreate: 1.25e-6, cacheRead: 1e-7 },
};

// Mémoire des changements de tarif : périodes datées ANTÉRIEURES au tarif
// courant de PRICES, triées par `until` croissant. Une période s'applique aux
// messages horodatés STRICTEMENT avant son `until` (ISO UTC, comparaison
// lexicographique — les deux formats sont zéro-paddés). Un modèle absent d'ici
// n'a jamais changé de tarif.
export interface PricePeriod {
  until: string;
  prices: ModelPrices;
}
const PRICE_HISTORY: Record<string, PricePeriod[]> = {};

// Zéro VOULU : modèles non facturables PAR NATURE — un 0 $ inscrit ici et commenté,
// jamais un tarif qu'on ignore. La règle « jamais de zéro silencieux » porte
// sur les modèles INCONNUS ; ceux-ci sont connus, à 0 $. Un nouveau modèle
// local = une ligne ici (même philosophie que PRICE_HISTORY).
const ZERO_COST: Record<string, string> = {
  '<synthetic>': 'artefact du harnais Claude Code — aucun appel API',
  'ministral-3:latest': 'modèle local Ollama — inférence locale, 0 $ API',
};

// Descriptif produit par modèle (libellé lisible, fenêtre de contexte) —
// jamais lu par computeCost : la tarification reste dans PRICES. Le serveur
// les sert tels quels (src/server/pricing.ts).
const MODEL_INFO: Record<string, { label: string; maxInput: number }> = {
  'claude-fable-5': { label: 'Fable 5', maxInput: 1_000_000 },
  'claude-fable-5-1': { label: 'Fable 5.1', maxInput: 1_000_000 },
  'claude-mythos-5': { label: 'Mythos 5', maxInput: 1_000_000 },
  'claude-mythos-5-1': { label: 'Mythos 5.1', maxInput: 1_000_000 },
  'claude-opus-5-5': { label: 'Opus 5.5', maxInput: 1_000_000 },
  'claude-opus-5': { label: 'Opus 5', maxInput: 1_000_000 },
  'claude-sonnet-5': { label: 'Sonnet 5', maxInput: 1_000_000 },
  'claude-opus-4-8': { label: 'Opus 4.8', maxInput: 1_000_000 },
  'claude-opus-4-7': { label: 'Opus 4.7', maxInput: 1_000_000 },
  'claude-opus-4-6': { label: 'Opus 4.6', maxInput: 1_000_000 },
  'claude-opus-4-5': { label: 'Opus 4.5', maxInput: 200_000 },
  'claude-sonnet-4-6': { label: 'Sonnet 4.6', maxInput: 1_000_000 },
  'claude-sonnet-4-5': { label: 'Sonnet 4.5', maxInput: 200_000 },
  'claude-haiku-4-5': { label: 'Haiku 4.5', maxInput: 200_000 },
};

/**
 * Ramène un id modèle à sa forme canonique : retire suffixe [1m]/[200k],
 * préfixes de transport et de routage régional, versions -vN[:M] et dates.
 *
 * Définition UNIQUE de la normalisation du produit : le serveur
 * (`src/server/pricing.ts`) l'importe. Deux copies divergent en silence, et le
 * moteur annonce alors « coût partiel » sur un identifiant que le serveur tarife.
 *
 * Les préfixes s'EMPILENT (`bedrock/anthropic.…`) : une alternance appliquée
 * une seule fois n'en retirait qu'un et laissait l'identifiant inconnu. D'où
 * une substitution par préfixe, dans l'ordre du plus externe au plus interne.
 * Le routeur régional passe AVANT `anthropic.` nu, sinon `us.anthropic.X`
 * tomberait à travers et resterait un modèle au tarif inconnu.
 */
export function normalizeModel(mid: string | null | undefined): string | null {
  if (mid === null || mid === undefined) return null;
  let s = mid.trim();
  if (s === '') return null;
  s = s.replace(/\[[^\]]*\]$/, '');
  s = s.replace(/^bedrock\//, '');
  s = s.replace(/^vertex_ai\//, '');
  s = s.replace(/^vertex\//, '');
  s = s.replace(/^(global|us|eu|au)\.anthropic\./, '');
  s = s.replace(/^anthropic\./, '');
  s = s.replace(/^anthropic\//, '');
  s = s.replace(/-v\d+:\d+$/, '');
  s = s.replace(/-v\d+$/, '');
  s = s.replace(/[-@]\d{8}$/, '');
  return s;
}

export interface CostResult {
  usd: number | null;
  known: boolean;
  model: string | null;
}

/** Un prix repris de la page des tarifs d'Anthropic par la vigie, lu dans ~/.agent-viz/prices.json. */
export interface AdoptedPrice {
  prices: ModelPrices;
  maxInput: number;
  /** null : modèle absent de la table embarquée, le prix vaut pour tout message. */
  from: string | null;
  /** Le tarif courant que l'adoption remplace ; null pour un modèle nouveau. */
  replaces: ModelPrices | null;
  adoptedAt: string;
  source: 'anthropic';
}
export type AdoptedPrices = Readonly<Record<string, readonly AdoptedPrice[]>>;
export interface AdoptionMark { source: 'anthropic'; adoptedAt: string; from: string | null }

export interface Pricing {
  computeCost(usage: RawUsage, model: string | null | undefined, at?: string): CostResult;
  pricingKindOf(model: string | null | undefined, at?: string): PricingKind;
  priceTable(): PriceTable;
}

type PriceAt = (model: string, at: string) => ModelPrices | undefined;

const FIELDS = ['input', 'output', 'cacheCreate', 'cacheRead'] as const;
const samePrices = (a: ModelPrices, b: ModelPrices): boolean => FIELDS.every((f) => a[f] === b[f]);
// Un id lu dans un transcript tiers ne doit jamais tomber sur une propriété héritée (`constructor`).
const own = <T>(rec: Record<string, T>, key: string): T | undefined =>
  (Object.hasOwn(rec, key) ? rec[key] : undefined);

/** Libellé lisible (« Opus 5.5 ») d'un id canonique ; l'id tel quel hors forme. */
export function deriveLabel(id: string): string {
  const m = id.match(/^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/);
  if (!m) return id;
  const familyRaw = m[1] ?? '';
  const family = familyRaw.charAt(0).toUpperCase() + familyRaw.slice(1);
  return m[3] !== undefined ? `${family} ${m[2]}.${m[3]}` : `${family} ${m[2]}`;
}

/**
 * La formule de coût du produit : cache 1h à 2× input, 5m au tarif
 * cacheCreate, le reste linéaire. Modèle inconnu → usd null, JAMAIS un zéro
 * silencieux (le tarif d'un modèle qu'on ne connaît pas ne s'invente pas).
 * `at` = horodatage ISO du message : le barème appliqué est celui en vigueur à
 * cette date ; sans date, le tarif courant.
 */
function costWith(
  priceAt: PriceAt,
  usage: RawUsage,
  model: string | null | undefined,
  at?: string,
): CostResult {
  const norm = normalizeModel(model);
  if (norm !== null && own(ZERO_COST, norm) !== undefined) return { usd: 0, known: true, model: norm };
  const p = norm !== null ? priceAt(norm, at ?? new Date().toISOString()) : undefined;
  if (p === undefined) return { usd: null, known: false, model: norm };

  // `usage` vient d'un JSONL écrit par un tiers : `normalizeEvent` écarte un non-objet mais pas ses
  // champs, et `"cache_creation": null`, du JSON valide, faisait LEVER cette fonction. Le serveur
  // calcule son coût ici lui aussi : sans ces deux gardes, la panne le toucherait.
  const u: RawUsage = isRecord(usage) ? usage : {};
  const cc = isRecord(u.cache_creation) ? u.cache_creation : undefined;
  // Un champ brut qui n'est pas un compte (chaîne, Infinity, négatif, décimal)
  // coûte zéro, comme il compte zéro jeton dans usage.ts : le coût lit la MÊME
  // garde que les compteurs, jamais une conversion implicite qui facture un texte.
  const ccTotal = countOrZero(u.cache_creation_input_tokens);
  const cc1h = countOrZero(cc?.ephemeral_1h_input_tokens);
  const cc5m = cc !== undefined ? countOrZero(cc.ephemeral_5m_input_tokens) : ccTotal; // sans split : tout en 5m
  const usd =
    countOrZero(u.input_tokens) * p.input +
    countOrZero(u.output_tokens) * p.output +
    cc5m * p.cacheCreate +
    cc1h * (p.input * 2) +
    countOrZero(u.cache_read_input_tokens) * p.cacheRead;
  return { usd, known: true, model: norm };
}

/** Un objet exploitable par accès de champ — un tableau en est un, et se
 *  comporte comme un objet sans les champs attendus (donc zéro), ce qui est
 *  exactement le repli voulu. `null` n'en est pas un, malgré son `typeof`. */
function isRecord(v: unknown): v is RawUsage & Record<string, never> {
  return typeof v === 'object' && v !== null;
}

export type PricingKind = 'tarife' | 'zero-voulu' | 'inconnu';

/** Comment `model` est tarifé à l'instant `at` — la contrepartie qualitative
 *  de computeCost, qui ne rend qu'un montant. Un 'zero-voulu' est un 0 $
 *  inscrit dans ZERO_COST ; un 'inconnu' est un tarif qu'on ne connaît pas et
 *  qu'on n'invente pas. */
function kindWith(priceAt: PriceAt, model: string | null | undefined, at?: string): PricingKind {
  const norm = normalizeModel(model);
  if (norm === null) return 'inconnu';
  if (own(ZERO_COST, norm) !== undefined) return 'zero-voulu';
  return priceAt(norm, at ?? new Date().toISOString()) === undefined ? 'inconnu' : 'tarife';
}

export interface PriceTableEntry {
  model: string;
  /** Libellé lisible (« Opus 5 ») et fenêtre de contexte — les deux champs que
   *  la pastille temps réel consomme : la table moteur les porte pour être
   *  l'autorité tarifaire de TOUT le produit. */
  label: string;
  maxInput: number;
  current: ModelPrices;
  history: PricePeriod[];
  /** Présent quand le tarif courant vient de la page des tarifs d'Anthropic. */
  adopted: AdoptionMark | null;
}

export interface PriceTable {
  source: 'netgain-table-embarquee';
  /** USD par jeton (3e-6 = 3 $ le million). */
  unit: 'usd-par-jeton';
  entries: PriceTableEntry[];
  zeroCost: { model: string; reason: string }[];
}

interface Bareme {
  prices: Record<string, ModelPrices>;
  history: Record<string, PricePeriod[]>;
  info: Record<string, { label: string; maxInput: number }>;
  marks: Record<string, AdoptionMark>;
}

// La table embarquée garde le dernier mot : une adoption ne s'applique que tant
// qu'elle couvre un vide (modèle absent) ou le tarif exact qu'elle remplaçait.
function mergeAdopted(adopted: AdoptedPrices): Bareme {
  const prices: Record<string, ModelPrices> = { ...PRICES };
  const history: Record<string, PricePeriod[]> = {};
  for (const [m, h] of Object.entries(PRICE_HISTORY)) history[m] = [...h];
  const info = { ...MODEL_INFO };
  const marks: Record<string, AdoptionMark> = {};
  for (const [model, list] of Object.entries(adopted)) {
    const ordered = [...list].sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''));
    for (const a of ordered) {
      const current = own(prices, model);
      if (a.from === null) {
        if (own(PRICES, model) !== undefined) continue;
        info[model] = { label: deriveLabel(model), maxInput: a.maxInput };
      } else {
        if (current === undefined || a.replaces === null || !samePrices(current, a.replaces)) continue;
        history[model] = [...(own(history, model) ?? []), { until: a.from, prices: current }];
      }
      prices[model] = a.prices;
      marks[model] = { source: a.source, adoptedAt: a.adoptedAt, from: a.from };
    }
  }
  return { prices, history, info, marks };
}

// Chaque appel rend des copies fraîches : la table de prix ne peut pas être
// altérée depuis l'extérieur.
function tableOf(b: Bareme): PriceTable {
  return {
    source: 'netgain-table-embarquee',
    unit: 'usd-par-jeton',
    entries: Object.entries(b.prices).map(([model, prices]) => {
      const info = own(b.info, model);
      const mark = own(b.marks, model);
      return {
        model,
        // Un modèle sans descriptif reste visible (libellé = identifiant) ;
        // le test « libellés et fenêtres » rend le cas impossible en pratique.
        label: info?.label ?? model,
        maxInput: info?.maxInput ?? 0,
        current: { ...prices },
        history: (own(b.history, model) ?? []).map((p) => ({ until: p.until, prices: { ...p.prices } })),
        adopted: mark === undefined ? null : { ...mark },
      };
    }),
    zeroCost: Object.entries(ZERO_COST).map(([model, reason]) => ({ model, reason })),
  };
}

/** Le barème du produit : table embarquée + prix adoptés. Aucune I/O. */
export function createPricing(adopted: AdoptedPrices): Pricing {
  const b = mergeAdopted(adopted);
  const priceAt: PriceAt = (model, at) => {
    for (const period of own(b.history, model) ?? []) {
      if (at < period.until) return period.prices;
    }
    return own(b.prices, model);
  };
  return {
    computeCost: (usage, model, at) => costWith(priceAt, usage, model, at),
    pricingKindOf: (model, at) => kindWith(priceAt, model, at),
    priceTable: () => tableOf(b),
  };
}

/** Le barème de la table embarquée seule. */
export const embeddedPricing: Pricing = createPricing({});
/** La formule de coût, sur la table embarquée seule. */
export const computeCost = embeddedPricing.computeCost;
/** La nature du tarif, sur la table embarquée seule. */
export const pricingKindOf = embeddedPricing.pricingKindOf;
/** Le barème appliqué, exposé pour l'affichage et pour la pastille. */
export const priceTable = embeddedPricing.priceTable;
