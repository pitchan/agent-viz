import type { NormalizedEvent, RawUsage, ToolUseRef } from '../../core/events.js';
import { detectGraphSignal, type GraphSignal } from '../../router/detector.js';
import { detectAgentGesture, type AgentGestureKind } from './agent-gestures.js';
import { isNoisePrompt } from './prompts.js';

type AssistantEvent = Extract<NormalizedEvent, { kind: 'assistant' }>;
type UserPromptEvent = Extract<NormalizedEvent, { kind: 'user_prompt' }>;

export interface TurnBucketStat {
  turns: number;
  netTokens: number;
}

export interface TurnsStats {
  /** Questions humaines non-bruit du transcript principal. */
  turns: number;
  /** Tours dont la question déclenche detectGraphSignal — le détecteur du router livré (J6). */
  triggered: TurnBucketStat;
  silent: TurnBucketStat;
  /** Jetons rattachables à aucune question : démarrage de session, horodatage absent. */
  unattributedNetTokens: number;
  bySignal: Record<GraphSignal, number>;
  subagents: { attributed: number; unattributed: number };
  /** Gestes de graphe de l'AGENT (comportement-agent) — drapeaux sur les tours, jamais une dépense. */
  agentGraph: AgentGraphStats;
}

export interface AgentGraphStats {
  events: number;
  byKind: Record<AgentGestureKind, number>;
  turnsWithGesture: number;
  /** Tours SANS signal de graphe au prompt mais où l'agent a fait le geste — l'angle mort de v0.7.0. */
  agentOnly: TurnBucketStat;
  unattributedEvents: number;
}

export function emptyAgentGraphByKind(): Record<AgentGestureKind, number> {
  return { grepImport: 0, bashImport: 0, spawnGraphPrompt: 0 };
}

export function emptyBySignal(): Record<GraphSignal, number> {
  return { 'blast-radius': 0, impact: 0, dependents: 0, importers: 0, 'hot-files': 0 };
}

/** Convention du repo : input + cache_creation + output, cache_read exclu. */
function netOfUsage(u: RawUsage): number {
  return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
}

function parseTs(timestamp: string | undefined): number | null {
  if (timestamp === undefined) return null;
  const ms = Date.parse(timestamp);
  return Number.isNaN(ms) ? null : ms;
}

interface Turn {
  signal: GraphSignal | null;
  startTs: number | null;
  netTokens: number;
  /** Gestes de graphe du main tombés pendant ce tour. */
  gestures: number;
}

interface SubBucket {
  netTokens: number;
  /** Premier événement HORODATÉ de l'agent — approxime le tour de lancement. */
  firstTs: number | null;
  /** Gestes de graphe de ce sous-agent — rattachés au tour hôte dans result(). */
  gestures: number;
}

/**
 * Métrique « gain vécu » : rattache la dépense à chaque question (un tour =
 * question → question suivante) et la classe par le détecteur du router.
 * Un sous-agent est facturé au tour où tombe son premier événement horodaté
 * (« lancé pendant un tour = facturé à ce tour ») ; le bruit du harnais
 * n'ouvre pas de tour ; l'inattribuable est compté à part, jamais tu.
 * Même déduplication par message.id que TokensAggregator — l'invariant de
 * somme (tirés + silencieux + non-attribuable = net total) en dépend.
 */
export class TurnsAggregator {
  private readonly seen = new Set<string>();
  private readonly turns: Turn[] = [];
  private readonly subBuckets = new Map<string, SubBucket>();
  private unattributedNet = 0;
  private readonly bySignal = emptyBySignal();
  /** Dédup des gestes : une ligne assistant est répétée par content block (même piège que spawnSeen). */
  private readonly seenGestureIds = new Set<string>();
  private readonly gestureByKind = emptyAgentGraphByKind();
  private gestureEvents = 0;
  private mainUnattributedGestures = 0;

  addPrompt(evt: UserPromptEvent): void {
    if (isNoisePrompt(evt.text)) return;
    const signal = detectGraphSignal(evt.text);
    if (signal !== null) this.bySignal[signal] += 1;
    this.turns.push({ signal, startTs: parseTs(evt.timestamp), netTokens: 0, gestures: 0 });
  }

  /** Drapeau « geste de graphe » sur le tour — mêmes règles de rattachement que les jetons. */
  registerToolUse(tu: ToolUseRef, agentKey: string): void {
    const kind = detectAgentGesture(tu);
    if (kind === null || this.seenGestureIds.has(tu.id)) return;
    this.seenGestureIds.add(tu.id);
    this.gestureEvents += 1;
    this.gestureByKind[kind] += 1;
    if (agentKey === 'main') {
      const current = this.turns[this.turns.length - 1];
      if (current === undefined) this.mainUnattributedGestures += 1;
      else current.gestures += 1;
    } else {
      const sub = this.subBuckets.get(agentKey) ?? { netTokens: 0, firstTs: null, gestures: 0 };
      sub.gestures += 1;
      this.subBuckets.set(agentKey, sub);
    }
  }

  addAssistant(evt: AssistantEvent, agentKey: string): void {
    const sub = agentKey === 'main' ? null : (this.subBuckets.get(agentKey) ?? { netTokens: 0, firstTs: null, gestures: 0 });
    if (sub !== null) {
      if (sub.firstTs === null) sub.firstTs = parseTs(evt.timestamp);
      this.subBuckets.set(agentKey, sub);
    }
    if (evt.usage === null) return;
    if (evt.msgId !== null) {
      const key = `${agentKey}:${evt.msgId}`;
      if (this.seen.has(key)) return;
      this.seen.add(key);
    }
    const net = netOfUsage(evt.usage);
    if (sub !== null) {
      sub.netTokens += net;
    } else {
      const current = this.turns[this.turns.length - 1];
      if (current === undefined) this.unattributedNet += net;
      else current.netTokens += net;
    }
  }

  result(): TurnsStats {
    // Rattachement sans mutation des tours : result() reste stable si rappelé.
    const extra = this.turns.map(() => 0);
    const gestureExtra = this.turns.map(() => 0);
    const subagents = { attributed: 0, unattributed: 0 };
    let unattributed = this.unattributedNet;
    let unattributedGestures = this.mainUnattributedGestures;
    for (const sub of this.subBuckets.values()) {
      const host = sub.firstTs !== null ? this.lastTurnStartedBefore(sub.firstTs) : -1;
      if (host === -1) {
        subagents.unattributed += 1;
        unattributed += sub.netTokens;
        unattributedGestures += sub.gestures;
      } else {
        subagents.attributed += 1;
        extra[host] = (extra[host] ?? 0) + sub.netTokens;
        gestureExtra[host] = (gestureExtra[host] ?? 0) + sub.gestures;
      }
    }
    const triggered = { turns: 0, netTokens: 0 };
    const silent = { turns: 0, netTokens: 0 };
    const agentOnly = { turns: 0, netTokens: 0 };
    let turnsWithGesture = 0;
    this.turns.forEach((t, i) => {
      const net = t.netTokens + (extra[i] ?? 0);
      const bucket = t.signal !== null ? triggered : silent;
      bucket.turns += 1;
      bucket.netTokens += net;
      if (t.gestures + (gestureExtra[i] ?? 0) > 0) {
        turnsWithGesture += 1;
        if (t.signal === null) {
          agentOnly.turns += 1;
          agentOnly.netTokens += net;
        }
      }
    });
    return {
      turns: this.turns.length,
      triggered,
      silent,
      unattributedNetTokens: unattributed,
      bySignal: { ...this.bySignal },
      subagents,
      agentGraph: {
        events: this.gestureEvents,
        byKind: { ...this.gestureByKind },
        turnsWithGesture,
        agentOnly,
        unattributedEvents: unattributedGestures,
      },
    };
  }

  /** Index du dernier tour horodaté commencé avant ts ; −1 si aucun (agent d'avant la 1re question). */
  private lastTurnStartedBefore(ts: number): number {
    for (let i = this.turns.length - 1; i >= 0; i -= 1) {
      const startTs = this.turns[i]?.startTs ?? null;
      if (startTs !== null && startTs <= ts) return i;
    }
    return -1;
  }
}
