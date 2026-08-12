import { statSync } from 'node:fs';
import path from 'node:path';
import type { NormalizedEvent } from '../../core/events.js';
import { isNoisePrompt } from './prompts.js';

type AssistantEvent = Extract<NormalizedEvent, { kind: 'assistant' }>;
type CompactEvent = Extract<NormalizedEvent, { kind: 'compact' }>;
type UserPromptEvent = Extract<NormalizedEvent, { kind: 'user_prompt' }>;

/** Re-création de cache « anormale » après le 1er tour : seuil en tokens. */
const CHURN_THRESHOLD = 10_000;
/** En-deçà de cette perte, le préfixe caché est considéré relu en entier (bruit d'arrondi). */
const HELD_TOLERANCE = 1_000;
/** Durées de vie du cache côté API : 5 min par défaut, 1 h si le tour précédent en écrivait. */
const TTL_5M_MS = 5 * 60_000;
const TTL_1H_MS = 60 * 60_000;

/**
 * Cause probable d'une grosse re-création :
 * - growth : fausse alerte — le cache a bien resservi, le montant est un gros AJOUT (ex. grosse lecture) ;
 * - compaction : la conversation a été résumée depuis la réponse précédente, refacturation inévitable ;
 * - expiration : pause plus longue que la durée de vie du cache ;
 * - prefixChange : le début du contexte a changé (règles rechargées, réglages…) — la case actionnable ;
 * - unknown : horodatage/compteurs absents du journal — affiché, jamais deviné.
 */
export type ChurnCause = 'growth' | 'compaction' | 'expiration' | 'prefixChange' | 'unknown';

export interface ChurnCauseStat {
  events: number;
  tokens: number;
}

export function emptyChurnCauses(): Record<ChurnCause, ChurnCauseStat> {
  return {
    growth: { events: 0, tokens: 0 },
    compaction: { events: 0, tokens: 0 },
    expiration: { events: 0, tokens: 0 },
    prefixChange: { events: 0, tokens: 0 },
    unknown: { events: 0, tokens: 0 },
  };
}

/** Ventilation du seau noMarker par position — un FAIT, jamais une cause.
 * earlyMcp : cassure de l'agent principal au tour ≤ EARLY_TURN_MAX dans une
 * session où au moins un outil mcp__* est appelé. Somme toujours égale au
 * seau parent markers.noMarker (règle d'homogénéité). */
export interface NoMarkerDetail {
  earlyMcp: ChurnCauseStat;
  other: ChurnCauseStat;
}

/** Étude des 1 700 sessions (2026-07-27) : la sur-cassure des sessions à
 * serveurs MCP (×6,3, répliquée ×6,7) disparaît après le tour 5. */
export const EARLY_TURN_MAX = 5;

const MCP_TOOL_PREFIX = 'mcp__';

/**
 * Marqueur journalisé attribuable à une re-création « prefixChange » (une seule case, par priorité) :
 * - modelSwitch : le modèle a changé depuis le tour précédent — deux espaces de cache, mécanique ;
 * - toolsAppeared : un chargement d'outils différés (ToolSearch) depuis le tour précédent —
 *   coïncidence temporelle observée, PAS un mécanisme (correctif 2026-08-05 : la doc officielle
 *   établit que le chargement différé via tool search ajoute la définition à l'historique et
 *   préserve le cache ; notre test contrôlé l'avait innocenté, +265 tk plein relu) ;
 * - noMarker : rien de journalisé n'explique la cassure — affiché tel quel, jamais deviné.
 */
export type PrefixMarker = 'modelSwitch' | 'toolsAppeared' | 'noMarker';

/**
 * Profondeur de cassure = ratio relu/attendu (cacheRead / cachéTotal précédent) : où le préfixe a
 * cassé. façade ≤ 10 % (bloc outils/système), queue > 90 % (réécriture en fin d'historique).
 */
export type BreakDepth = 'facade' | 'd10to50' | 'd50to90' | 'tail';

/** Les deux découpes portent sur les MÊMES événements : chacune somme à churnCauses.prefixChange. */
export interface PrefixBreakdown {
  markers: Record<PrefixMarker, ChurnCauseStat>;
  noMarkerDetail: NoMarkerDetail;
  depth: Record<BreakDepth, ChurnCauseStat>;
}

export function emptyPrefixBreakdown(): PrefixBreakdown {
  return {
    markers: {
      modelSwitch: { events: 0, tokens: 0 },
      toolsAppeared: { events: 0, tokens: 0 },
      noMarker: { events: 0, tokens: 0 },
    },
    noMarkerDetail: {
      earlyMcp: { events: 0, tokens: 0 },
      other: { events: 0, tokens: 0 },
    },
    depth: {
      facade: { events: 0, tokens: 0 },
      d10to50: { events: 0, tokens: 0 },
      d50to90: { events: 0, tokens: 0 },
      tail: { events: 0, tokens: 0 },
    },
  };
}

/** Nom de l'outil dont l'appel sert de marqueur temporel « outils apparus » (corrélat observé —
 * le chargement différé lui-même préserve le cache selon la doc officielle, correctif 2026-08-05). */
const TOOLSEARCH_NAME = 'ToolSearch';

function bucketOfDepth(ratio: number): BreakDepth {
  if (ratio <= 0.1) return 'facade';
  if (ratio <= 0.5) return 'd10to50';
  if (ratio <= 0.9) return 'd50to90';
  return 'tail';
}

/** Durée de vie en vigueur au moment de la pause (celle écrite par le tour d'avant). */
export type PauseTtl = 'ttl5m' | 'ttl1h';
/** Tranches alignées sur la décision : ≤ 1 h = récupérable par le cache 1 h, au-delà = par rien. */
export type PauseBucketKey = 'b5to15m' | 'b15to60m' | 'b1to3h' | 'bOver3h';
export type PauseBuckets = Record<PauseTtl, Record<PauseBucketKey, ChurnCauseStat>>;

export function emptyPauseBuckets(): PauseBuckets {
  const row = (): Record<PauseBucketKey, ChurnCauseStat> => ({
    b5to15m: { events: 0, tokens: 0 },
    b15to60m: { events: 0, tokens: 0 },
    b1to3h: { events: 0, tokens: 0 },
    bOver3h: { events: 0, tokens: 0 },
  });
  return { ttl5m: row(), ttl1h: row() };
}

/** Tokens écrits au cache, ventilés par durée de vie ; le détail manque dans les vieux journaux → indéterminé. */
export interface CacheWrites {
  tokens5m: number;
  tokens1h: number;
  tokensUnknown: number;
}

export interface ContextStats {
  cacheChurnEvents: number;
  cacheChurnTokens: number;
  /** Ventilation des MÊMES événements par cause — invariant : la somme = les deux compteurs ci-dessus. */
  churnCauses: Record<ChurnCause, ChurnCauseStat>;
  /** Sous-ventilation de la seule case prefixChange — invariant : chaque découpe y somme exactement. */
  prefixBreakdown: PrefixBreakdown;
  /** Détail des expirations par tranche de pause × durée de vie — invariant : la somme = churnCauses.expiration. */
  pauseBuckets: PauseBuckets;
  /** Mix des écritures de cache de la session (toutes, pas seulement le churn). */
  cacheWrites: CacheWrites;
  /** in + cacheRead + cacheCreate par message main (convention agent-viz = taille de contexte). */
  contextGrowth: { first: number | null; max: number; last: number | null };
  compactions: { trigger: 'auto' | 'manual'; preTokens: number | null }[];
}

interface PrevTurn {
  /** cacheRead + cacheCreate du tour précédent = ce que le tour suivant relirait si le cache tenait. */
  cachedTotal: number;
  timestamp: string | undefined;
  wrote1h: boolean;
  model: string | null;
}

interface ChurnVerdict {
  cause: ChurnCause;
  /** Renseigné seulement pour une expiration : durée de vie en vigueur + tranche de pause. */
  pause: { ttl: PauseTtl; bucket: PauseBucketKey } | null;
}

function bucketOfGap(gapMs: number): PauseBucketKey {
  if (gapMs <= 15 * 60_000) return 'b5to15m';
  if (gapMs <= TTL_1H_MS) return 'b15to60m';
  if (gapMs <= 3 * TTL_1H_MS) return 'b1to3h';
  return 'bOver3h';
}

/**
 * L'écart est mesuré réponse-à-réponse : il surestime l'écart requête-à-requête
 * du temps de génération (approximation assumée, cf. le plan J7 —
 * docs/sources-externes.md).
 */
function classifyChurn(prev: PrevTurn, cacheRead: number, timestamp: string | undefined, compacted: boolean): ChurnVerdict {
  if (prev.cachedTotal - cacheRead <= HELD_TOLERANCE) return { cause: 'growth', pause: null };
  if (compacted) return { cause: 'compaction', pause: null };
  if (prev.timestamp === undefined || timestamp === undefined) return { cause: 'unknown', pause: null };
  const gapMs = Date.parse(timestamp) - Date.parse(prev.timestamp);
  if (Number.isNaN(gapMs)) return { cause: 'unknown', pause: null };
  if (gapMs > (prev.wrote1h ? TTL_1H_MS : TTL_5M_MS)) {
    return { cause: 'expiration', pause: { ttl: prev.wrote1h ? 'ttl1h' : 'ttl5m', bucket: bucketOfGap(gapMs) } };
  }
  return { cause: 'prefixChange', pause: null };
}

/**
 * Métrique 4 : composition/churn du contexte. Un cache_creation élevé APRÈS le
 * premier tour d'un agent signifie que le préfixe caché a été invalidé et
 * re-facturé (~10× la relecture) — le symptôme que cette métrique cherche.
 */
export class ContextAggregator {
  private readonly seen = new Set<string>();
  private readonly prevByAgent = new Map<string, PrevTurn>();
  private readonly compactPending = new Set<string>();
  private readonly toolSearchPending = new Set<string>();
  private churnEvents = 0;
  private churnTokens = 0;
  private readonly churnCauses = emptyChurnCauses();
  private readonly prefixBreakdown = emptyPrefixBreakdown();
  private readonly pauseBuckets = emptyPauseBuckets();
  private readonly cacheWrites: CacheWrites = { tokens5m: 0, tokens1h: 0, tokensUnknown: 0 };
  private first: number | null = null;
  private max = 0;
  private last: number | null = null;
  private readonly compactions: ContextStats['compactions'] = [];
  private mainTurns = 0;
  private mcpSeen = false;
  private readonly noMarkerBreaks: Array<{ tokens: number; turn: number; isMain: boolean }> = [];

  /** Un prompt de l'agent principal ouvre un tour ; le bruit du harnais n'en
   * ouvre pas (même règle que TurnsAggregator — une seule définition du tour). */
  addPrompt(evt: UserPromptEvent): void {
    if (isNoisePrompt(evt.text)) return;
    this.mainTurns += 1;
  }

  addAssistant(evt: AssistantEvent, agentKey: string): void {
    if (evt.usage === null) return;
    if (evt.msgId !== null) {
      const key = `${agentKey}:${evt.msgId}`;
      if (this.seen.has(key)) return;
      this.seen.add(key);
    }
    const u = evt.usage;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const cacheCreate = u.cache_creation_input_tokens ?? 0;
    const contextSize = (u.input_tokens ?? 0) + cacheRead + cacheCreate;
    if (agentKey === 'main') {
      if (this.first === null) this.first = contextSize;
      if (contextSize > this.max) this.max = contextSize;
      this.last = contextSize;
    }
    const detail = typeof u.cache_creation === 'object' && u.cache_creation !== null ? u.cache_creation : null;
    if (detail !== null) {
      const t5 = detail.ephemeral_5m_input_tokens ?? 0;
      const t1 = detail.ephemeral_1h_input_tokens ?? 0;
      this.cacheWrites.tokens5m += t5;
      this.cacheWrites.tokens1h += t1;
      this.cacheWrites.tokensUnknown += Math.max(0, cacheCreate - t5 - t1);
    } else {
      this.cacheWrites.tokensUnknown += cacheCreate;
    }
    const prev = this.prevByAgent.get(agentKey);
    const compacted = this.compactPending.delete(agentKey); // drapeau consommé par CE tour
    const toolsAppeared = this.toolSearchPending.delete(agentKey); // idem : le ToolSearch du tour d'avant
    // prev absent = 1er tour de l'agent : il crée légitimement le cache, jamais compté.
    if (prev !== undefined && cacheCreate > CHURN_THRESHOLD) {
      this.churnEvents += 1;
      this.churnTokens += cacheCreate;
      const { cause, pause } = classifyChurn(prev, cacheRead, evt.timestamp, compacted);
      this.churnCauses[cause].events += 1;
      this.churnCauses[cause].tokens += cacheCreate;
      if (pause !== null) {
        this.pauseBuckets[pause.ttl][pause.bucket].events += 1;
        this.pauseBuckets[pause.ttl][pause.bucket].tokens += cacheCreate;
      }
      if (cause === 'prefixChange') {
        const marker: PrefixMarker =
          prev.model !== null && evt.model !== null && evt.model !== prev.model
            ? 'modelSwitch'
            : toolsAppeared
              ? 'toolsAppeared'
              : 'noMarker';
        this.prefixBreakdown.markers[marker].events += 1;
        this.prefixBreakdown.markers[marker].tokens += cacheCreate;
        if (marker === 'noMarker') {
          this.noMarkerBreaks.push({ tokens: cacheCreate, turn: this.mainTurns, isMain: agentKey === 'main' });
        }
        // prefixChange implique cachedTotal − cacheRead > tolérance, donc cachedTotal > 0.
        const depth = bucketOfDepth(cacheRead / prev.cachedTotal);
        this.prefixBreakdown.depth[depth].events += 1;
        this.prefixBreakdown.depth[depth].tokens += cacheCreate;
      }
    }
    if (evt.toolUses.some((t) => t.name === TOOLSEARCH_NAME)) this.toolSearchPending.add(agentKey);
    if (evt.toolUses.some((t) => t.name.startsWith(MCP_TOOL_PREFIX))) this.mcpSeen = true;
    this.prevByAgent.set(agentKey, {
      cachedTotal: cacheRead + cacheCreate,
      timestamp: evt.timestamp,
      wrote1h: (u.cache_creation?.ephemeral_1h_input_tokens ?? 0) > 0,
      model: evt.model,
    });
  }

  addCompact(evt: CompactEvent, agentKey: string): void {
    this.compactions.push({ trigger: evt.trigger, preTokens: evt.preTokens });
    this.compactPending.add(agentKey);
  }

  /** Ventile les cassures muettes une fois la session entière connue : la
   * présence MCP est une propriété de session (un serveur appelé au tour 40
   * rend « early » la cassure du tour 2 — c'est le motif de l'étude). Ne mute
   * rien : result() reste stable si rappelé. */
  private ventilateNoMarker(): NoMarkerDetail {
    const detail: NoMarkerDetail = {
      earlyMcp: { events: 0, tokens: 0 },
      other: { events: 0, tokens: 0 },
    };
    for (const b of this.noMarkerBreaks) {
      const cell = b.isMain && b.turn <= EARLY_TURN_MAX && this.mcpSeen ? detail.earlyMcp : detail.other;
      cell.events += 1;
      cell.tokens += b.tokens;
    }
    return detail;
  }

  result(): ContextStats {
    return {
      cacheChurnEvents: this.churnEvents,
      cacheChurnTokens: this.churnTokens,
      churnCauses: this.churnCauses,
      prefixBreakdown: { ...this.prefixBreakdown, noMarkerDetail: this.ventilateNoMarker() },
      pauseBuckets: this.pauseBuckets,
      cacheWrites: this.cacheWrites,
      contextGrowth: { first: this.first, max: this.max, last: this.last },
      compactions: this.compactions,
    };
  }
}

/**
 * État ACTUEL du disque (approximation étiquetée comme telle dans le rapport :
 * on ne connaît pas le contenu historique des fichiers au moment des sessions).
 */
export function findClaudeMdFiles(cwd: string | null, claudeDir: string): { path: string; bytes: number }[] {
  const candidates: string[] = [];
  if (cwd !== null) {
    candidates.push(path.join(cwd, 'CLAUDE.md'), path.join(cwd, '.claude', 'CLAUDE.md'));
  }
  candidates.push(path.join(claudeDir, 'CLAUDE.md'));
  const found: { path: string; bytes: number }[] = [];
  for (const p of candidates) {
    try {
      const st = statSync(p);
      if (st.isFile()) found.push({ path: p, bytes: st.size });
    } catch {
      // absent ou illisible : simplement pas listé
    }
  }
  return found;
}
