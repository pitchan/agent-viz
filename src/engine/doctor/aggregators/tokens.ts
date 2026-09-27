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
  /** Dollars des messages servis en mode rapide, DÉJÀ inclus dans `usd`. */
  fastUsd: number;
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
 * Un message s'écrit sur plusieurs lignes JSONL et une seule compte, la dernière saine
 * (règle et raison : `isDedupableMsgId`) : le calcul attend donc la fin de la lecture.
 */
export class TokensAggregator {
  // Le barème arrive de l'appelant : la CLI et le serveur y mettent les prix adoptés.
  private readonly pricing: Pricing;
  constructor(pricing: Pricing) { this.pricing = pricing; }

  // Une entrée par message, dans l'ordre de première apparition ; un message sans
  // identifiant exploitable a la sienne, jamais fusionnée avec une autre.
  private readonly retenus = new Map<string, { evt: AssistantEvent; agentKey: string }>();
  private sansId = 0;

  addAssistant(evt: AssistantEvent, agentKey: string): void {
    // Sans `usage`, aucune mesure : la ligne est ignorée et ne rend pas la session partielle.
    if (evt.usageVerdict === 'absent') return;
    // Un identifiant vide ne déduplique pas (`isDedupableMsgId`) : tester `msgId !== null`
    // fusionnait des messages distincts sans identifiant, et les sous-comptait.
    if (!isDedupableMsgId(evt.msgId)) {
      this.retenus.set(`#${this.sansId++}`, { evt, agentKey });
      return;
    }
    const key = `${agentKey}:${evt.msgId}`;
    const prec = this.retenus.get(key);
    // Une ligne malformée ne remplace pas la mesure saine du même message.
    if (prec === undefined || evt.usageVerdict === 'sain' || prec.evt.usageVerdict !== 'sain') {
      this.retenus.set(key, { evt, agentKey });
    }
  }

  result(): TokensResult {
    const main = emptyBucket();
    const perAgent: Record<string, TokenBucket> = {};
    const perModel: Record<string, TokenBucket> = {};
    const costByModel: Record<string, ModelCost> = {};
    const unknown = new Set<string>();
    let cost = 0;
    let malformed = 0;
    for (const { evt, agentKey } of this.retenus.values()) {
      // Compté une fois par message, avant d'écarter un `usage` non objet : ce message n'apporte
      // aucun jeton, mais jetons et coût de la session deviennent des bornes inférieures.
      if (evt.usageVerdict === 'malforme') malformed += 1;
      if (evt.usage === null) continue;
      const bucket = agentKey === 'main' ? main : (perAgent[agentKey] ??= emptyBucket());
      addUsage(bucket, evt.usage);

      // Le tarif appliqué est celui en vigueur à la date du message : un changement
      // de prix adopté ne réécrit pas les messages d'avant.
      const { usd, known, model } = this.pricing.computeCost(evt.usage, evt.model, evt.timestamp);
      const modelKey = model ?? '(inconnu)';
      addUsage((perModel[modelKey] ??= emptyBucket()), evt.usage);
      // Dollars par modèle, cumulés au même instant et au même tarif que le coût
      // total — jamais recalculés depuis les seaux (le tarif daté et la part
      // cache 5 min / 1 h d'un message ne se reconstituent pas depuis un agrégat).
      const kind = this.pricing.pricingKindOf(evt.model, evt.timestamp, evt.usage.speed);
      const mc = (costByModel[modelKey] ??= { usd: null, fastUsd: 0, pricing: kind });
      // Un seul message au tarif inconnu fait du montant de la ligne une borne basse :
      // la ligne se déclare inconnue plutôt que d'afficher un coût partiel comme complet.
      if (kind === 'inconnu') mc.pricing = 'inconnu';
      if (known && usd !== null) {
        mc.usd = (mc.usd ?? 0) + usd;
        if (evt.usage.speed === 'fast') mc.fastUsd += usd;
        cost += usd;
      } else {
        unknown.add(modelKey);
      }
    }
    const total = emptyBucket();
    sumUsageInto(total, main);
    for (const b of Object.values(perAgent)) sumUsageInto(total, b);
    return {
      main,
      perAgent,
      perModel,
      total,
      costUsd: cost,
      costComplete: unknown.size === 0 && malformed === 0,
      unknownModels: [...unknown].sort(),
      malformedUsageMessages: malformed,
      costByModel,
    };
  }
}
