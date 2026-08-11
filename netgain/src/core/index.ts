/** Surface publique du noyau : l'énumération des sessions, l'analyse de --since
 *  et le barème embarqué (exposé pour le produit — unification 2026-08-05). */
export { CLAUDE_DIR_ENV, resolveClaudeDir } from './claude-dir.js';
export type { ResolveClaudeDirOptions } from './claude-dir.js';
export { discoverSessions, parseSince } from './discovery.js';
export type { DiscoveryFilters, SessionRef, SubagentRef } from './discovery.js';
export { priceTable, pricingKindOf } from './pricing.js';
export type { ModelPrices, PricePeriod, PriceTable, PriceTableEntry, PricingKind } from './pricing.js';
