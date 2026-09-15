/** Surface publique du noyau : l'énumération des sessions, l'analyse de --since
 *  et le barème embarqué (exposé pour le produit — unification 2026-08-05). */
export { CLAUDE_DIR_ENV, resolveClaudeDir, resolveClaudeJsonPath } from './claude-dir.ts';
export {
  addUsage, countOrZero, emptyUsageBucket, isDedupableMsgId, isTokenCount, sumUsageInto, usageVerdict,
} from './usage.ts';
export type { UsageBucket, UsageVerdict } from './usage.ts';
export type { ResolveClaudeDirOptions } from './claude-dir.ts';
export { discoverSessions, parseSince } from './discovery.ts';
export type { DiscoveryFilters, SessionRef, SubagentRef } from './discovery.ts';
export { priceTable, pricingKindOf } from './pricing.ts';
export type { ModelPrices, PricePeriod, PriceTable, PriceTableEntry, PricingKind } from './pricing.ts';
