import type { RawUsage } from './events.js';

export interface ModelPrices {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

// Table statique embarquée (local-only : jamais de fetch).
// Miroir de la table de repli d'agent-viz, contre-vérifié au centime sur des
// sessions réelles via son API /tokens. USD par token.
// PRICES = tarif COURANT ; les barèmes antérieurs vivent dans PRICE_HISTORY.
const PRICES: Record<string, ModelPrices> = {
  // Famille Claude 5 (2026).
  'claude-fable-5': { input: 1e-5, output: 5e-5, cacheCreate: 1.25e-5, cacheRead: 1e-6 },
  'claude-mythos-5': { input: 1e-5, output: 5e-5, cacheCreate: 1.25e-5, cacheRead: 1e-6 },
  'claude-opus-5': { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7 },
  'claude-sonnet-5': { input: 3e-6, output: 1.5e-5, cacheCreate: 3.75e-6, cacheRead: 3e-7 },
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
const PRICE_HISTORY: Record<string, PricePeriod[]> = {
  // Sonnet 5 : tarif de lancement 2/10 $ le MTok jusqu'au 2026-08-31 inclus
  // (annonce Anthropic), catalogue 3/15 ensuite.
  'claude-sonnet-5': [
    { until: '2026-09-01', prices: { input: 2e-6, output: 1e-5, cacheCreate: 2.5e-6, cacheRead: 2e-7 } },
  ],
};

// Zéro VOULU : modèles non facturables PAR NATURE — un 0 $ assumé et commenté,
// jamais un tarif qu'on ignore. La règle « jamais de zéro silencieux » porte
// sur les modèles INCONNUS ; ceux-ci sont connus, à 0 $. Un nouveau modèle
// local = une ligne ici (même philosophie que PRICE_HISTORY).
const ZERO_COST: Record<string, string> = {
  '<synthetic>': 'artefact du harnais Claude Code — aucun appel API',
  'ministral-3:latest': 'modèle local Ollama (essais S8) — inférence locale, 0 $ API',
};

// Descriptif produit par modèle (libellé lisible, fenêtre de contexte) —
// jamais lu par computeCost : la tarification reste dans PRICES. Valeurs
// alignées sur le repli d'agent-viz (lib/server/pricing.js FALLBACK), qui les
// portait déjà ; le test « libellés et fenêtres » garde les deux alignés.
const MODEL_INFO: Record<string, { label: string; maxInput: number }> = {
  'claude-fable-5': { label: 'Fable 5', maxInput: 1_000_000 },
  'claude-mythos-5': { label: 'Mythos 5', maxInput: 1_000_000 },
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

/** Tarif en vigueur pour `model` à l'instant `at` (ISO UTC). */
function priceAt(model: string, at: string): ModelPrices | undefined {
  const history = PRICE_HISTORY[model];
  if (history !== undefined) {
    for (const period of history) {
      if (at < period.until) return period.prices;
    }
  }
  return PRICES[model];
}

/**
 * Ramène un id modèle à sa forme canonique : retire suffixe [1m]/[200k],
 * préfixes transport (anthropic/, bedrock/, vertex/), versions -vN:M et dates.
 */
export function normalizeModel(mid: string | null | undefined): string | null {
  if (mid === null || mid === undefined) return null;
  let s = mid.trim();
  if (s === '') return null;
  s = s.replace(/\[[^\]]*\]$/, '');
  s = s.replace(/^(anthropic[./]|bedrock\/|vertex(_ai)?\/)/, '');
  s = s.replace(/-v\d+:\d+$/, '');
  s = s.replace(/[-@]\d{8}$/, '');
  return s;
}

export interface CostResult {
  usd: number | null;
  known: boolean;
  model: string | null;
}

/**
 * Reproduit la formule agent-viz (pricing.js) : cache 1h à 2× input, 5m au tarif
 * cacheCreate, le reste linéaire. Modèle inconnu → usd null, JAMAIS un zéro
 * silencieux (le tarif d'un modèle qu'on ne connaît pas ne s'invente pas).
 * `at` = horodatage ISO du message : le barème appliqué est celui en vigueur à
 * cette date (PRICE_HISTORY) ; sans date, le tarif courant.
 */
export function computeCost(
  usage: RawUsage,
  model: string | null | undefined,
  at?: string,
): CostResult {
  const norm = normalizeModel(model);
  if (norm !== null && ZERO_COST[norm] !== undefined) return { usd: 0, known: true, model: norm };
  const p = norm !== null ? priceAt(norm, at ?? new Date().toISOString()) : undefined;
  if (p === undefined) return { usd: null, known: false, model: norm };

  const cc = usage.cache_creation;
  const ccTotal = usage.cache_creation_input_tokens ?? 0;
  const cc1h = cc?.ephemeral_1h_input_tokens ?? 0;
  const cc5m = cc !== undefined ? (cc.ephemeral_5m_input_tokens ?? 0) : ccTotal; // sans split : tout en 5m
  const usd =
    (usage.input_tokens ?? 0) * p.input +
    (usage.output_tokens ?? 0) * p.output +
    cc5m * p.cacheCreate +
    cc1h * (p.input * 2) +
    (usage.cache_read_input_tokens ?? 0) * p.cacheRead;
  return { usd, known: true, model: norm };
}

export type PricingKind = 'tarife' | 'zero-voulu' | 'inconnu';

/** Comment `model` est tarifé à l'instant `at` — la contrepartie qualitative
 *  de computeCost, qui ne rend qu'un montant. Un 'zero-voulu' est un 0 $
 *  assumé (ZERO_COST) ; un 'inconnu' est un tarif qu'on ne connaît pas et
 *  qu'on n'invente pas. */
export function pricingKindOf(model: string | null | undefined, at?: string): PricingKind {
  const norm = normalizeModel(model);
  if (norm === null) return 'inconnu';
  if (ZERO_COST[norm] !== undefined) return 'zero-voulu';
  return priceAt(norm, at ?? new Date().toISOString()) === undefined ? 'inconnu' : 'tarife';
}

export interface PriceTableEntry {
  model: string;
  /** Libellé lisible (« Opus 5 ») et fenêtre de contexte — les deux champs que
   *  la pastille temps réel consomme : la table moteur les porte pour être
   *  l'autorité tarifaire de TOUT le produit (unification 2026-08-05). */
  label: string;
  maxInput: number;
  current: ModelPrices;
  history: PricePeriod[];
}

export interface PriceTable {
  source: 'netgain-table-embarquee';
  /** USD par jeton (3e-6 = 3 $ le million). */
  unit: 'usd-par-jeton';
  entries: PriceTableEntry[];
  zeroCost: { model: string; reason: string }[];
}

/** Le barème réellement appliqué par computeCost, exposé pour l'affichage et
 *  pour la pastille. Chaque appel rend des copies fraîches : la table de prix
 *  ne peut pas être altérée depuis l'extérieur. */
export function priceTable(): PriceTable {
  return {
    source: 'netgain-table-embarquee',
    unit: 'usd-par-jeton',
    entries: Object.entries(PRICES).map(([model, prices]) => {
      const info = MODEL_INFO[model];
      return {
        model,
        // Un modèle sans descriptif reste visible (libellé = identifiant) ;
        // le test « libellés et fenêtres » rend le cas impossible en pratique.
        label: info?.label ?? model,
        maxInput: info?.maxInput ?? 0,
        current: { ...prices },
        history: (PRICE_HISTORY[model] ?? []).map((p) => ({ until: p.until, prices: { ...p.prices } })),
      };
    }),
    zeroCost: Object.entries(ZERO_COST).map(([model, reason]) => ({ model, reason })),
  };
}
