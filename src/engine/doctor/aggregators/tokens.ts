import type { NormalizedEvent } from '../../core/events.ts';
import type { Pricing, PricingKind } from '../../core/pricing.ts';
import { addUsage, emptyUsageBucket, isDedupableMsgId, sumUsageInto } from '../../core/usage.ts';
import type { UsageBucket } from '../../core/usage.ts';

type AssistantEvent = Extract<NormalizedEvent, { kind: 'assistant' }>;

// L'accumulation des six champs bruts, la fusion de deux seaux et la règle de
// déduplication ont une seule définition, `core/usage.ts`, que le serveur importe
// aussi. Reste ici ce qui n'appartient qu'au moteur : ventilation par modèle, coût daté.
export type TokenBucket = UsageBucket;
export const emptyBucket = emptyUsageBucket;

/** Convention de mesure : input + cache_creation + output, cache_read EXCLU. */
export function netTokens(b: TokenBucket): number {
  return b.in + b.cacheCreate + b.out;
}

export interface ModelCost {
  /** Dollars cumulés au tarif en vigueur à la date de CHAQUE message.
   *  null = tarif inconnu, jamais un zéro silencieux. */
  usd: number | null;
  pricing: PricingKind;
}

export interface TokensResult {
  main: TokenBucket;
  perAgent: Record<string, TokenBucket>;
  perModel: Record<string, TokenBucket>;
  total: TokenBucket;
  /** Somme des messages dont le modèle est tarifé — la part CONNUE seulement. */
  costUsd: number;
  /** false dès qu'un modèle sans tarif a produit des jetons ou qu'un message porte un `usage`
   *  inexploitable : `costUsd` est alors une borne inférieure, et dans le second cas les seaux
   *  de jetons aussi. Le détail : `unknownModels` et `malformedUsageMessages`. */
  costComplete: boolean;
  unknownModels: string[];
  /** Messages, après déduplication, dont le `usage` est inexploitable. */
  malformedUsageMessages: number;
  /** Dollars par modèle. Mêmes clés que perModel. La somme des `usd` non nuls
   *  vaut costUsd, au centime. */
  costByModel: Record<string, ModelCost>;
}

/**
 * Métrique 1 : tokens et coût par session, main + sous-agents, par modèle.
 * Claude Code écrit une ligne JSONL par content block portant le MÊME usage :
 * la déduplication par message.id est obligatoire.
 */
export class TokensAggregator {
  // Le barème arrive de l'appelant : la CLI et le serveur y mettent les prix adoptés.
  private readonly pricing: Pricing;
  constructor(pricing: Pricing) { this.pricing = pricing; }

  private readonly seen = new Set<string>();
  private readonly main = emptyBucket();
  private readonly perAgent: Record<string, TokenBucket> = {};
  private readonly perModel: Record<string, TokenBucket> = {};
  private readonly costByModel: Record<string, ModelCost> = {};
  private cost = 0;
  private readonly unknown = new Set<string>();
  private malformed = 0;

  addAssistant(evt: AssistantEvent, agentKey: string): void {
    // Sans `usage`, aucune mesure : la ligne est ignorée et ne rend pas la session partielle.
    if (evt.usageVerdict === 'absent') return;
    // Un identifiant vide ne déduplique pas (`isDedupableMsgId`) : tester `msgId !== null`
    // fusionnait des messages distincts sans identifiant, et les sous-comptait.
    if (isDedupableMsgId(evt.msgId)) {
      const key = `${agentKey}:${evt.msgId}`;
      if (this.seen.has(key)) return;
      this.seen.add(key);
    }
    // Compté une fois par message, avant d'écarter un `usage` non objet : ce message n'apporte
    // aucun jeton, mais jetons et coût de la session deviennent des bornes inférieures.
    if (evt.usageVerdict === 'malforme') this.malformed += 1;
    if (evt.usage === null) return;
    const bucket = agentKey === 'main' ? this.main : (this.perAgent[agentKey] ??= emptyBucket());
    addUsage(bucket, evt.usage);

    // Le tarif appliqué est celui en vigueur à la date du message (les barèmes
    // changent — ex. Sonnet 5 lancement→catalogue au 2026-09-01).
    const { usd, known, model } = this.pricing.computeCost(evt.usage, evt.model, evt.timestamp);
    const modelKey = model ?? '(inconnu)';
    addUsage((this.perModel[modelKey] ??= emptyBucket()), evt.usage);
    // Dollars par modèle, cumulés au même instant et au même tarif que le coût
    // total — jamais recalculés depuis les seaux (le tarif daté et la part
    // cache 5 min / 1 h d'un message ne se reconstituent pas depuis un agrégat).
    const mc = (this.costByModel[modelKey] ??= { usd: null, pricing: this.pricing.pricingKindOf(evt.model, evt.timestamp) });
    if (known && usd !== null) {
      mc.usd = (mc.usd ?? 0) + usd;
      this.cost += usd;
    } else {
      this.unknown.add(modelKey);
    }
  }

  result(): TokensResult {
    const total = emptyBucket();
    sumUsageInto(total, this.main);
    for (const b of Object.values(this.perAgent)) sumUsageInto(total, b);
    return {
      main: this.main,
      perAgent: this.perAgent,
      perModel: this.perModel,
      total,
      costUsd: this.cost,
      costComplete: this.unknown.size === 0 && this.malformed === 0,
      unknownModels: [...this.unknown].sort(),
      malformedUsageMessages: this.malformed,
      costByModel: this.costByModel,
    };
  }
}
