// viz-state.ts — constants, shared state, helpers, render scheduler.
//
// All mutable app state lives here (state, vis). Other modules import these
// live object references and mutate them directly. Primitive consts and
// stateless helpers are also exported.

import { countOrZero } from '../engine/core/usage.ts';

// ─── Palette ──────────────────────────────────────────────────────────────
export const COLORS = {
  void: '#050510',
  grid: 'rgba(102, 204, 255, 0.03)',
  session: '#66ccff', agent: '#bc8cff', tool: '#ffbb44',
  skill: '#56d6e2', mcp: '#ff8cc8',
  error: '#ff5566', notification: '#ffaa33',
  complete: '#66ffaa', stop: '#8b949e',
  edge: 'rgba(102, 204, 255, 0.15)', edgeActive: 'rgba(102, 204, 255, 0.4)',
  particle: '#66ccff',
};

// ─── Geometry ─────────────────────────────────────────────────────────────
export const AGENT_R = 36;
export const SESSION_R = 44;
export const TOOL_W = 130, TOOL_H = 28;
export const SKILL_R = 22;
export const MCP_R = 24;
export const SPAWN_DIST = 220;
export const LERP_SPEED = 5;

// Feed buffer cap (timeline entries retained in memory).
export const TIMELINE_CAP = 500;
// GC window for finished tool/skill/notification nodes.
export const NODE_GC_MAX_AGE_MS = 10 * 60 * 1000;

// Lerp settling epsilons.
export const LERP_EPS_POS = 0.1;
export const LERP_EPS_OPACITY = 0.005;
export const LERP_EPS_SCALE = 0.005;
// Pulse-only animation throttle (running nodes glow at 20 fps).
export const PULSE_FRAME_MS = 1000 / 20;

// Un seau de jetons tel que le serveur l'envoie (SSE `tokens` ou GET /tokens).
// `costComplete`, `unknownModels` et `malformedUsageMessages` portent la réserve sur le
// coût (costCompleteness plus bas) : absents sur un seau d'un serveur antérieur, ce qui
// vaut complet.
export interface TokenBucket {
  in?: number;
  out?: number;
  cacheCreate?: number;
  cacheRead?: number;
  lastIn?: number;
  lastCacheCreate?: number;
  lastCacheRead?: number;
  lastModel?: string;
  contextMax?: number;
  costUsd?: number;
  costComplete?: boolean;
  unknownModels?: string[];
  malformedUsageMessages?: number;
}

// Un nœud du graphe (state.nodes) — construit par viz-layout.ts, lu par
// viz-drawers.ts et viz-narrator.ts. `_visible` n'existe que sur un nœud
// posé par le layout orbital ; absent avant le premier passage.
export interface VizNode {
  id: string;
  type: string;
  label: string;
  sub: string;
  color: string;
  children: VizNode[];
  parentId: string | null;
  data: unknown;
  status: string;
  x: number;
  y: number;
  duration: string | null;
  startTime: string | null;
  endTime: string | null;
  isIsolated: boolean;
  isParallel: boolean;
  _visible?: boolean;
}

// La position animée d'un nœud (vis.nodes) — lerpée vers sa cible à chaque
// frame (viz-canvas.ts), lue par les dessinateurs pour le rendu courant.
export interface VisNode {
  id: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  opacity: number;
  targetOpacity: number;
  scale: number;
  targetScale: number;
  glowPhase: number;
}

// Une paire {noeud, position animée} — la forme des cinq seaux de dessin
// (vis.drawXxxNodes), triés par type pour que le rendu n'ait pas à filtrer.
export interface DrawBucketEntry {
  n: VizNode;
  vn: VisNode;
}

// Une particule (vis.particles) — un trait lumineux d'un parent vers un
// enfant actif. `x`/`y` n'existent qu'après le premier pas d'animation.
export interface Particle {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  progress: number;
  speed: number;
  size: number;
  color: string;
  opacity: number;
  x?: number;
  y?: number;
}

// Une entrée du fil (state.timelineEntries) — un événement affiché dans le
// panneau Feed, avec de quoi remonter au nœud d'origine.
export interface TimelineEntry {
  ts: string;
  nodeId: string;
  type: string;
  label: string;
  sub: string;
}

// ─── App state ────────────────────────────────────────────────────────────
export const state = {
  eventSeq: 0, offset: 0, nodes: new Map<string, VizNode>(), selected: null as string | null,
  toolsCompleted: 0, filter: '', autoFit: true,
  timelineEntries: [] as TimelineEntry[],
  startTimes: new Map<string, string>(),
  _lastServerId: null as string | null,
  // Token usage — populated by SSE `tokens` events.
  // tokensSupported: false ⇒ adapter declares tokens N/A (UI shows badge).
  // null ⇒ no SSE snapshot received yet (don't show anything).
  // transcriptMissing: true ⇒ Claude session whose transcript isn't located yet.
  tokens: {
    main: null as TokenBucket | null,
    perAgent: new Map<string, TokenBucket>(),
    tokensSupported: null as boolean | null,
    transcriptMissing: false,
  },
  // Map<forkedChildAgentId, parentAgentId>. Filled by PostToolUse(Skill) events
  // with tool_response.status === 'forked'. Used to attach forked sub-agents
  // under their launching agent instead of the session root — the forked
  // child's own PreToolUse events carry no parent_agent_id.
  forkedAgentParents: new Map<string, string>(),
};

// Visual/animation state.
export const vis = {
  nodes: new Map<string, VisNode>(),
  particles: [] as Particle[],
  camera: { x: 0, y: 0, zoom: 1, targetX: 0, targetY: 0, targetZoom: 1 },
  time: 0,
  hoveredNode: null as string | null,
  rafHandle: null as number | null,
  pulseTimer: null as ReturnType<typeof setTimeout> | null,
  dirty: true,
  activeAnimations: 0,
  drawSessionNodes: [] as DrawBucketEntry[],
  drawAgentNodes: [] as DrawBucketEntry[],
  drawToolNodes: [] as DrawBucketEntry[],
  drawSkillNodes: [] as DrawBucketEntry[],
  drawMcpNodes: [] as DrawBucketEntry[],
  runningNodes: new Set<string>(),
  avgFrameMs: 8,
  _particleSkipToggle: false,
};

// ─── Render scheduler ─────────────────────────────────────────────────────
// The rAF driver lives in viz-canvas.ts (tick). It registers itself here so
// markDirty/requestRender can schedule frames without a circular import.
let _tickFn: FrameRequestCallback | null = null;
export function setTickFn(fn: FrameRequestCallback) { _tickFn = fn; }

export function markDirty() {
  vis.dirty = true;
  requestRender();
}

export function requestRender() {
  if (vis.rafHandle != null || vis.pulseTimer != null) return;
  if (!_tickFn) return;
  vis.rafHandle = requestAnimationFrame(_tickFn);
}

// ─── Helpers ──────────────────────────────────────────────────────────────
const _haCache = new Map<string, string>();
export function hexAlpha(hex: string, alpha: number): string {
  if (hex.startsWith('rgba')) return hex;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 100) / 100;
  const key = hex + a;
  let v = _haCache.get(key);
  if (!v) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    v = `rgba(${r},${g},${b},${a})`;
    _haCache.set(key, v);
  }
  return v;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Regular hexagon with a vertex pointing up, circumscribed radius r.
export function traceHexagon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + i * (Math.PI / 3);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// Diamond (losange) — square rotated 45°, half-diagonal r.
export function traceDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
}

// Parse an MCP tool name "mcp__<server>__<action>" into readable label/sub.
// Examples:
//   mcp__plugin_playwright_playwright__browser_click → {label:"browser_click", sub:"playwright"}
//   mcp__claude_ai_Gmail__authenticate              → {label:"authenticate", sub:"Gmail"}
export function parseMcpName(toolName: string | undefined | null) {
  if (!toolName || !toolName.startsWith('mcp__')) return { label: toolName || 'MCP', sub: '' };
  const parts = toolName.split('__');
  const action = parts[parts.length - 1] || toolName;
  // Middle segment holds the server id; drop common prefixes + dedup repeats.
  let server = parts.length >= 3 ? parts.slice(1, -1).join('_') : '';
  server = server.replace(/^plugin_/, '').replace(/^claude_ai_/, '');
  const segs = server.split('_').filter(Boolean);
  const dedup: string[] = [];
  for (const s of segs) if (dedup[dedup.length - 1] !== s) dedup.push(s);
  return { label: action, sub: dedup.join('_') };
}

export function truncate(s: string, max: number) { return s.length > max ? s.slice(0, max - 1) + '…' : s; }
export function esc(s: unknown) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
export function easeInOut(t: number) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
export function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

// Compact token display — "850" / "12.4k" / "1.3M".
export function formatTokens(n: number | null | undefined) {
  if (!n || n < 1000) return String(n || 0);
  if (n < 10_000) return (n / 1000).toFixed(1) + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (n / 1_000_000).toFixed(1) + 'M';
}

// Sum of the 4 cumulative counters in a token bucket. Safe on null/undefined.
export function tokenTotal(t: TokenBucket | null | undefined) {
  if (!t) return 0;
  return countOrZero(t.in) + countOrZero(t.out) + countOrZero(t.cacheCreate) + countOrZero(t.cacheRead);
}

// Context window size = last message's input + cache_creation + cache_read.
// Matches Claude Code's /context semantics (not cumulative). Same guard as
// tokenTotal; the engine has no equivalent to these three "last" fields.
export function tokenContext(t: TokenBucket | null | undefined) {
  if (!t) return 0;
  return countOrZero(t.lastIn) + countOrZero(t.lastCacheCreate) + countOrZero(t.lastCacheRead);
}

// Complétude du coût, agrégée sur plusieurs seaux.
//
// `costUsd` n'est jamais un montant faux : c'est la somme des messages dont le
// TARIF est connu, donc une BORNE INFÉRIEURE exacte du coût réel. Quand un
// modèle absent de la table embarquée a produit des jetons, le serveur pose
// `costComplete: false` sur le seau et nomme le modèle : la pastille temps réel
// porte alors la même réserve que la page Observatoire (« coût partiel »).
//
// Un seau SANS le champ (enveloppe d'un serveur antérieur, rejeu d'un ancien
// instantané) compte comme complet : l'enveloppe SSE est additive, et
// `undefined` n'est pas `false`. Pour la même raison, un seau sans le compte des
// messages au `usage` inexploitable n'en ajoute aucun.
export function costCompleteness(buckets: (TokenBucket | null | undefined)[]) {
  const inconnus = new Set<string>();
  let complete = true;
  let malformedUsageMessages = 0;
  for (const b of buckets) {
    if (!b) continue;
    if (b.costComplete === false) complete = false;
    for (const m of (b.unknownModels || [])) inconnus.add(m);
    malformedUsageMessages += countOrZero(b.malformedUsageMessages);
  }
  return { complete, unknownModels: [...inconnus].sort(), malformedUsageMessages };
}

// Les raisons d'un coût partiel, en mots, pour la pastille et le panneau de détail :
// chaque raison n'apparaît que si elle a eu lieu.
export function costReasons(c: { unknownModels: string[]; malformedUsageMessages: number }): string[] {
  const reasons: string[] = [];
  if (c.unknownModels.length > 0) reasons.push(`sans tarif : ${c.unknownModels.join(', ')}`);
  if (c.malformedUsageMessages > 0) reasons.push(`${c.malformedUsageMessages} message(s) au champ usage inexploitable`);
  return reasons;
}

// Format USD cost — "$0.42", "$12.30", "$1.2k" for very large sessions.
// 4-decimal precision for sub-cent values so cheap exploratory runs still
// register something visible.
export function formatCost(usd: number | null | undefined) {
  if (!usd || usd < 0) return '$0';
  if (usd < 0.01) return '$' + usd.toFixed(4);
  if (usd < 100) return '$' + usd.toFixed(2);
  if (usd < 1000) return '$' + Math.round(usd);
  return '$' + (usd / 1000).toFixed(1) + 'k';
}

// Le montant assorti de ce qu'il PRÉTEND. Trois énoncés,
// trois vérités différentes :
//
//   complet            → « $4.17 ». C'est le coût.
//   partiel, part > 0  → « au moins $4.17 ». Le montant est une BORNE
//                        INFÉRIEURE exacte, et « au moins » dit le SENS de
//                        l'erreur : le vrai coût est au-dessus, jamais en
//                        dessous. Un simple « partiel » laisserait le lecteur
//                        ignorer de quel côté se tromper — or il regarde ce
//                        chiffre pour décider s'il brûle de l'argent.
//   partiel, part = 0  → « coût indisponible ». Rien n'est tarifé du tout ;
//                        « au moins $0 » serait vrai et ne prétendrait RIEN,
//                        ce qui est pire qu'avouer l'absence.
//
// Le mot « partiel » — celui qu'emploie déjà la page Observatoire — tient dans
// l'infobulle, où il y a la place de le qualifier et de nommer les modèles fautifs. La pastille n'a la place que de l'énoncé.
export function formatCostBound(usd: number | null | undefined, complete: boolean) {
  if (complete) return formatCost(usd);
  return usd && usd > 0 ? `au moins ${formatCost(usd)}` : 'coût indisponible';
}

// Human label derived from the canonical id ("Opus 4.6", "Opus 5", "Fable 5.1"),
// without shipping the price map to the client. The server canonicalizes ids
// (date and `[1m]` suffixes stripped), hence the `$` anchor. Anything else stays raw.
export function modelLabel(id: string | null | undefined) {
  if (!id) return '';
  const m = id.match(/^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?$/);
  if (!m) return id;
  const family = `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)}`;
  return m[3] !== undefined ? `${family} ${m[2]}.${m[3]}` : `${family} ${m[2]}`;
}

// Le modèle écrit sous le titre d'un nœud Session ou Agent. Lu dans les seaux de jetons,
// qui arrivent après la création du nœud par les hooks : '' tant qu'il est inconnu.
export function nodeModelLabel(
  n: Pick<VizNode, 'id' | 'type'>,
  tokens: { main: TokenBucket | null; perAgent: Map<string, TokenBucket> },
) {
  const aid = agentIdFromNode(n.id);
  const bucket = n.type === 'session' ? tokens.main : aid ? tokens.perAgent.get(aid) : null;
  return modelLabel(bucket?.lastModel);
}

// Un instantané `tokens` ne s'applique qu'à la session affichée, et à aucune tant qu'elle
// est inconnue : à la connexion, le serveur rejoue ceux de TOUTES ses sessions, et le
// dernier arrivé l'emporterait.
export function tokensApplyTo(target: string | null, session: string) {
  return target !== null && session === target;
}

// Extract the bare agent id from a node id of the form "a:<agentId>".
export function agentIdFromNode(nodeId: string | null | undefined) {
  return nodeId && nodeId.startsWith('a:') ? nodeId.slice(2) : null;
}

// Extract the bare session id from a node id of the form "s:<sid>".
export function sessionIdFromNode(nodeId: string | null | undefined) {
  return nodeId && nodeId.startsWith('s:') ? nodeId.slice(2) : null;
}
