import type { NormalizedEvent, RawUsage } from '../../core/events.js';
import { computeCost, pricingKindOf } from '../../core/pricing.js';
import type { PricingKind } from '../../core/pricing.js';

type AssistantEvent = Extract<NormalizedEvent, { kind: 'assistant' }>;

export interface TokenBucket {
  in: number;
  out: number;
  cacheCreate: number;
  cacheRead: number;
  cacheCreate1h: number;
  cacheCreate5m: number;
}

export function emptyBucket(): TokenBucket {
  return { in: 0, out: 0, cacheCreate: 0, cacheRead: 0, cacheCreate1h: 0, cacheCreate5m: 0 };
}

function addUsage(b: TokenBucket, u: RawUsage): void {
  b.in += u.input_tokens ?? 0;
  b.out += u.output_tokens ?? 0;
  b.cacheCreate += u.cache_creation_input_tokens ?? 0;
  b.cacheRead += u.cache_read_input_tokens ?? 0;
  b.cacheCreate1h += u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  b.cacheCreate5m += u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
}

function sumInto(target: TokenBucket, src: TokenBucket): void {
  target.in += src.in;
  target.out += src.out;
  target.cacheCreate += src.cacheCreate;
  target.cacheRead += src.cacheRead;
  target.cacheCreate1h += src.cacheCreate1h;
  target.cacheCreate5m += src.cacheCreate5m;
}

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
  /** false dès qu'un modèle inconnu a produit des tokens (le coût affiché est alors partiel). */
  costComplete: boolean;
  unknownModels: string[];
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
  private readonly seen = new Set<string>();
  private readonly main = emptyBucket();
  private readonly perAgent: Record<string, TokenBucket> = {};
  private readonly perModel: Record<string, TokenBucket> = {};
  private readonly costByModel: Record<string, ModelCost> = {};
  private cost = 0;
  private readonly unknown = new Set<string>();

  addAssistant(evt: AssistantEvent, agentKey: string): void {
    if (evt.usage === null) return;
    if (evt.msgId !== null) {
      const key = `${agentKey}:${evt.msgId}`;
      if (this.seen.has(key)) return;
      this.seen.add(key);
    }
    const bucket = agentKey === 'main' ? this.main : (this.perAgent[agentKey] ??= emptyBucket());
    addUsage(bucket, evt.usage);

    // Le tarif appliqué est celui en vigueur à la date du message (les barèmes
    // changent — ex. Sonnet 5 lancement→catalogue au 2026-09-01).
    const { usd, known, model } = computeCost(evt.usage, evt.model, evt.timestamp);
    const modelKey = model ?? '(inconnu)';
    addUsage((this.perModel[modelKey] ??= emptyBucket()), evt.usage);
    // Dollars par modèle, cumulés au même instant et au même tarif que le coût
    // total — jamais recalculés depuis les seaux (le tarif daté et la part
    // cache 5 min / 1 h d'un message ne se reconstituent pas depuis un agrégat).
    const mc = (this.costByModel[modelKey] ??= { usd: null, pricing: pricingKindOf(evt.model, evt.timestamp) });
    if (known && usd !== null) {
      mc.usd = (mc.usd ?? 0) + usd;
      this.cost += usd;
    } else {
      this.unknown.add(modelKey);
    }
  }

  result(): TokensResult {
    const total = emptyBucket();
    sumInto(total, this.main);
    for (const b of Object.values(this.perAgent)) sumInto(total, b);
    return {
      main: this.main,
      perAgent: this.perAgent,
      perModel: this.perModel,
      total,
      costUsd: this.cost,
      costComplete: this.unknown.size === 0,
      unknownModels: [...this.unknown].sort(),
      costByModel: this.costByModel,
    };
  }
}
