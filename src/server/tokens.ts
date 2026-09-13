'use strict';
// Per-session token tracking — buckets, accumulation, debounced broadcast.
//
// Each session accumulates token usage from its transcript (main thread +
// per-subagent). The transcript is the single source of truth — every
// assistant message and every agent_progress event flows through here.
//
// Bucket shape:
//   { in, out, cacheCreate, cacheRead } — cumulative sums (for detailed popup).
//   { lastIn, lastCacheCreate, lastCacheRead } — most recent message's usage
//     values (not summed). The sum of these three = current context window size
//     (matches Claude Code's /context output).
//   { lastModel, contextMax, costUsd } — pricing-derived: most recent model id
//     reported in transcripts, its context window size, and the cumulative
//     cost in USD computed at parse time (per-message, using the model that
//     produced that message — robust to mid-session model switches).

import { broadcastSSE } from './sse.ts';
import { getPrice } from './pricing.ts';
import { computeCost, normalizeModel, pricingKindOf } from '../engine/core/pricing.ts';
import { addUsage, emptyUsageBucket, finiteCount, isDedupableMsgId } from '../engine/core/usage.ts';
import type { UsageBucket } from '../engine/core/usage.ts';
import type { RawUsage } from '../engine/core/events.ts';

/** Le seau réel — six champs bruts du moteur (`UsageBucket`) plus ce que
 *  SEUL le serveur accumule : dernier message, dérivés tarifaires, dédup. */
interface Bucket extends UsageBucket {
  lastIn: number;
  lastCacheCreate: number;
  lastCacheRead: number;
  lastModel: string | null;
  contextMax: number;
  costUsd: number;
  costComplete: boolean;
  unknownModels: string[];
  _seenMsgIds: Set<string>;
}

/** La tranche `rec.tokens` telle que CE fichier la construit et la lit.
 *  `unsupported` et `transcriptMissing` ne sont jamais posés ICI — ils le
 *  sont par `transcript.ts` (hors lot) sur le même objet ; optionnels côté
 *  lecture, comme avant la migration (`!rec.tokens.unsupported` tolérait déjà
 *  leur absence). */
interface TokenState {
  main: Bucket;
  perAgent: Map<string, Bucket>;
  _broadcastTimer: NodeJS.Timeout | null;
  unsupported?: boolean;
  transcriptMissing?: boolean;
}

/** Le contrat minimal que `tokensSnapshot`/`tokensMessage`/`broadcastTokens`/
 *  `scheduleTokensBroadcast`/`clearTokensTimer` demandent à `rec` : posséder,
 *  éventuellement, une tranche `tokens` de la forme réelle ci-dessus. */
interface TokensCarrier {
  tokens?: TokenState;
}

function newBucket(): Bucket {
  return {
    // C3 : les six champs bruts viennent de la primitive du moteur. Le seau en
    // gagne DEUX au passage — `cacheCreate1h` et `cacheCreate5m`, la ventilation
    // par fenêtre de cache que seul le moteur suivait. L'enveloppe SSE est
    // additive : un navigateur qui ne les connaît pas les ignore.
    ...emptyUsageBucket(),
    lastIn: 0, lastCacheCreate: 0, lastCacheRead: 0,
    lastModel: null, contextMax: 0, costUsd: 0,
    // Complétude du coût, portée par le seau donc par l'enveloppe SSE : `costUsd` est une
    // BORNE INFÉRIEURE exacte, `costComplete: false` dit que le vrai coût est AU-DESSUS et
    // `unknownModels` dit lesquels manquent (un tableau : un Set sérialise en `{}`).
    costComplete: true, unknownModels: [],
    // Set of Anthropic message ids already accumulated. Claude Code writes one
    // JSONL line per content block (thinking, text, tool_use) but every line
    // carries the same `usage` — without dedup the bucket sums it N times.
    // JSON.stringify serializes a Set to `{}`, so this stays invisible in the
    // SSE snapshot envelope.
    _seenMsgIds: new Set(),
  };
}

// Frontière avec `transcript-adapters/claude.ts` (lot 4, déjà typé et clos) :
// il y déclare sa PROPRE forme locale et minimale de `rec` — `{ tokens?: {
// main: unknown; perAgent: Map<string, unknown> } }` — parce qu'au moment de
// ce lot, `tokens.ts` n'exposait rien de plus précis. `ensureTokens` doit
// rester appelable avec CETTE forme, donc son paramètre ne peut pas exiger le
// `TokenState` réel : `unknown` est le seul type dont TOUT est assignable,
// c'est la frontière la plus large qui reste correcte. La forme réelle n'est
// connue qu'à l'INTÉRIEUR de cette fonction, qui seule sait ce qu'elle y pose.
function ensureTokens(rec: { tokens?: unknown }): void {
  if (!rec.tokens) {
    rec.tokens = {
      main: newBucket(),
      perAgent: new Map<string, Bucket>(),
      _broadcastTimer: null,
    };
  }
}

function tokenSum(b: UsageBucket | null | undefined): number {
  if (!b) return 0;
  return finiteCount(b.in) + finiteCount(b.out) + finiteCount(b.cacheCreate) + finiteCount(b.cacheRead);
}

/** Un seau réel, reconnu à ses champs propres — jamais un cast : la même
 *  frontière `unknown` que `ensureTokens`, côté lecture. `'in' in v` couvre le
 *  fond du moteur, `_seenMsgIds instanceof Set` couvre ce que seul CE fichier
 *  pose ; les deux ensemble ne matchent rien d'autre dans le produit. */
function isBucket(v: unknown): v is Bucket {
  if (typeof v !== 'object' || v === null) return false;
  if (!('_seenMsgIds' in v) || !('in' in v)) return false;
  return v._seenMsgIds instanceof Set;
}

function accumulateUsage(
  bucket: unknown,
  usage: unknown,
  model: string | null,
  msgId: string | null,
  at: string | null,
): void {
  if (!isBucket(bucket)) return;
  // Même frontière que `bucket` : `usage` vient d'un JSONL décodé par
  // `decodeJsonlLine`, qui ne promet qu'un JSON valide — pas un objet.
  // Un non-objet devient `{}`, ce que tous les champs optionnels de
  // `RawUsage` tolèrent déjà sans autre garde.
  const raw: RawUsage = (typeof usage === 'object' && usage !== null) ? usage as RawUsage : {};
  // Idempotence by Anthropic message id — see _seenMsgIds note in newBucket.
  // Opt-in: callers without a stable id (e.g. legacy hooks) keep cumulating
  // as before.
  // C3 : la règle de déduplication vient de la primitive commune — un
  // identifiant vide n'est pas un identifiant. `msgId !== null` en tête donne
  // à TypeScript la même certitude que `isDedupableMsgId` vérifie déjà par
  // `typeof msgId === 'string'` (elle ne rétrécit pas son paramètre `unknown` —
  // c'est la signature du moteur, hors lot).
  if (msgId !== null && isDedupableMsgId(msgId)) {
    if (bucket._seenMsgIds.has(msgId)) return;
    bucket._seenMsgIds.add(msgId);
  }
  // C3 : l'accumulation des six champs bruts, une seule définition.
  addUsage(bucket, raw);
  // Track the most recent message's values. Transcript/hook events are parsed
  // in chronological order, so "last wins" gives the current context size.
  // Même garde que la primitive : sans elle, un message malformé donnerait
  // `in: 0` mais `lastIn: "100"` — une incohérence à l'intérieur d'un seul seau.
  bucket.lastIn = finiteCount(raw.input_tokens);
  bucket.lastCacheCreate = finiteCount(raw.cache_creation_input_tokens);
  bucket.lastCacheRead = finiteCount(raw.cache_read_input_tokens);
  // Le coût s'accumule message par message, au barème en vigueur à la date `at` du message.
  // La nature du tarif vient de `pricingKindOf` : ni un montant nul (un modèle tarifé sans
  // jeton coûte 0 $) ni `getPrice`, réservé aux métadonnées d'affichage, ne la disent.
  if (model) {
    const canonique = normalizeModel(model);
    const nature = pricingKindOf(model, at ?? undefined);
    // Inconnu : on NOMME le modèle et marque le total incomplet ; `lastModel` garde la pastille.
    if (nature === 'inconnu') {
      if (canonique !== null) {
        bucket.lastModel = canonique;
        if (!bucket.unknownModels.includes(canonique)) bucket.unknownModels.push(canonique);
      }
      bucket.costComplete = false;
    } else {
      // Tarifé ou zéro voulu (`<synthetic>`, Ollama local) : le montant compte, le total reste complet.
      // `usd` est fini (chaque champ passe par `finiteCount`) et `null` seulement pour un tarif
      // inconnu, écarté ci-dessus : `?? 0` ne traite que ce cas.
      const cost = computeCost(raw, model, at ?? undefined).usd;
      bucket.costUsd += cost ?? 0;
      // Seul un modèle tarifé devient celui de la pastille : `<synthetic>` est un artefact du harnais.
      if (nature === 'tarife') {
        bucket.lastModel = canonique;
        const price = getPrice(model, at ?? undefined);
        if (price) bucket.contextMax = price.maxInput;
      }
    }
  }
}

interface TokensSnapshot {
  main: Bucket;
  perAgent: Record<string, Bucket>;
  tokensSupported: boolean;
  transcriptMissing: boolean;
}

function tokensSnapshot(rec: TokensCarrier): TokensSnapshot | null {
  if (!rec.tokens) return null;
  const perAgent: Record<string, Bucket> = {};
  for (const [aid, bucket] of rec.tokens.perAgent) perAgent[aid] = bucket;
  return {
    main: rec.tokens.main,
    perAgent,
    tokensSupported: !rec.tokens.unsupported,
    // Claude session whose transcript file hasn't been located yet — lets the
    // UI show an explicit state instead of a blank pill. Always false once
    // discovery succeeds, and meaningless when tokensSupported is false.
    transcriptMissing: !!rec.tokens.transcriptMissing,
  };
}

interface TokensMessage extends TokensSnapshot {
  type: 'tokens';
  session: string;
}

// Build the SSE `tokens` message for a session, or null if it has no token
// state yet. Single source of truth for the wire shape — used both by the
// live broadcast and by the replay sent to freshly-connected SSE clients.
function tokensMessage(sid: string, rec: TokensCarrier): TokensMessage | null {
  const snap = tokensSnapshot(rec);
  if (!snap) return null;
  return { type: 'tokens', session: sid, ...snap };
}

function broadcastTokens(sid: string, rec: TokensCarrier): void {
  const msg = tokensMessage(sid, rec);
  if (msg) broadcastSSE(msg);
}

function scheduleTokensBroadcast(sid: string, rec: TokensCarrier): void {
  ensureTokens(rec);
  // `ensureTokens` pose `rec.tokens` inconditionnellement (voir sa note), mais
  // sa frontière `unknown` ne le fait pas SAVOIR à TypeScript ici : même garde
  // que `transcript-adapters/claude.ts` après le même appel.
  const tokens = rec.tokens;
  if (!tokens) return;
  if (tokens._broadcastTimer) return;
  tokens._broadcastTimer = setTimeout(() => {
    tokens._broadcastTimer = null;
    broadcastTokens(sid, rec);
  }, 250);
}

// Cancel any pending broadcast timer on this rec — used by deleteSession.
function clearTokensTimer(rec: TokensCarrier): void {
  if (rec.tokens && rec.tokens._broadcastTimer) {
    clearTimeout(rec.tokens._broadcastTimer);
    rec.tokens._broadcastTimer = null;
  }
}

export {
  newBucket, ensureTokens, tokenSum, accumulateUsage,
  tokensSnapshot, tokensMessage, broadcastTokens, scheduleTokensBroadcast,
  clearTokensTimer,
};
