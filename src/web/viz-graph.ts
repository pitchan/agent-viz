// viz-graph.ts — les evenements hook deviennent les noeuds du graphe.
//
// Chaque evenement cree, rattache ou termine un noeud de state.nodes, et
// alimente le fil d'evenements ; les noeuds finis et anciens sont ramasses.
// Aucune position ici : viz-layout.ts place les noeuds, ce module lui signale
// seulement la racine a replacer. Ni DOM, ni rendu, ni reseau.

import {
  COLORS, TIMELINE_CAP, NODE_GC_MAX_AGE_MS,
  state, vis, markDirty, parseMcpName,
  type VizNode, type DrawBucketEntry,
} from './viz-state.ts';
import { layoutDirtyRoots, markLayoutDirty } from './viz-layout.ts';
import { markNarratorDirty } from './viz-narrator.ts';
import { toolSubject, type ToolCallEvent, type ToolInput } from '../engine/core/tool-subject.ts';
import { formatDuration } from './viz-duration.ts';
import { recordError, recordSuccess } from './viz-errors.ts';

// L'evenement hook tel que ce module le lit : les champs de ToolCallEvent
// (moteur, deja type) plus ceux que la carte du graphe consomme. Tous
// facultatifs — l'objet arrive du flux SSE ou d'une ligne de journal rejouee.
export interface HookEvent extends ToolCallEvent {
  hook_event_name?: string;
  session_id?: string;
  agent_id?: string;
  agent_type?: string;
  subagent_type?: string;
  // Posés quand l'agent nomme son sous-agent : le nom de la tâche, et le surnom du fil.
  agent_name?: string;
  agent_nickname?: string;
  tool_use_id?: string;
  // `isolation` s'ajoute a ToolInput : seul le graphe s'en sert, pour la
  // pastille « worktree » d'un sous-agent isole.
  tool_input?: ToolInput & { isolation?: string };
  tool_response?: { agentId?: string; status?: string };
  message?: string;
  // Posé par un agent qui n'annonce son début qu'après coup : l'heure réelle du début.
  started_at?: string;
  // Posé sur un échec écrit après coup : l'heure réelle de la fin de l'outil.
  ended_at?: string;
  _ts?: string;
}

// ─── Feed-cursor adjust hook ──────────────────────────────────────────────
// When the timeline ring-buffer shifts, viz-ui's _feedRenderedCount must be
// decremented by the drop count so incremental append keeps working. Injected
// by viz-ui at load time to avoid a circular import.
type FeedCursorAdjust = (drop: number) => void;
let _feedCursorAdjust: FeedCursorAdjust = () => {};
export function setFeedCursorAdjust(fn: FeedCursorAdjust | null | undefined) { _feedCursorAdjust = fn || (() => {}); }

// ─── Node creation ────────────────────────────────────────────────────────
export function getNode(id: string): VizNode {
  if (!state.nodes.has(id)) {
    state.nodes.set(id, {
      id, type: 'tool', label: '', sub: '', color: COLORS.tool,
      children: [], parentId: null, data: null, status: 'running',
      x: 0, y: 0, duration: null, startTime: null, endTime: null,
      isIsolated: false, isParallel: false,
    });
  }
  // La clef vient d'etre posee juste au-dessus quand elle manquait : la table
  // la contient forcement ici.
  return state.nodes.get(id)!;
}

export function addTimelineEntry(evt: HookEvent, nodeId: string, type: string, label: string, sub?: string) {
  state.timelineEntries.push({
    ts: evt._ts || new Date().toISOString(),
    nodeId, type, label, sub: sub || '',
  });
  if (state.timelineEntries.length > TIMELINE_CAP + 50) {
    const drop = state.timelineEntries.length - TIMELINE_CAP;
    state.timelineEntries.splice(0, drop);
    _feedCursorAdjust(drop);
  }
}

export function setRunning(id: string, on: boolean) {
  if (on) vis.runningNodes.add(id);
  else vis.runningNodes.delete(id);
}

// Le nom qu'un agent donne à son sous-agent le distingue ; son type, plusieurs le partagent.
function agentLabel(evt: HookEvent): string {
  return evt.agent_name || evt.agent_type || evt.subagent_type || 'Agent';
}

// Lazy-promote a node created by getNode('a:<aid>') with default type='tool'
// into a real agent node. Claude Code does not emit SubagentStart hooks today,
// so the first child PreToolUse carrying agent_id is our spawn signal.
// Child events also carry agent_type, so we have a real label immediately.
function promoteAgentNode(n: VizNode, evt: HookEvent, sid: string, ts: string) {
  n.type = 'agent';
  n.label = agentLabel(evt);
  if (!n.sub) n.sub = evt.agent_nickname || (evt.agent_id || '').slice(0, 8);
  n.color = COLORS.agent;
  n.status = 'running';
  if (!n.startTime) n.startTime = ts;
  setRunning(n.id, true);
  if (!n.parentId) {
    const aid = (evt.agent_id || n.id.slice(2));
    const forkedParentAid = state.forkedAgentParents.get(aid);
    const forkedParent = forkedParentAid ? state.nodes.get(`a:${forkedParentAid}`) : null;
    let parent;
    if (forkedParent) {
      parent = forkedParent;
    } else {
      parent = getNode(`s:${sid}`);
      parent.type = 'session';
      parent.label = parent.label || 'Session';
      parent.color = COLORS.session;
    }
    n.parentId = parent.id;
    parent.children.push(n);
    recomputeParallelFlags(parent.id);
  }
  addTimelineEntry(evt, n.id, 'agent', n.label, n.sub);
}

// Detach `n` from its current parent's children list and attach it under
// `newParentId`. No-op if newParent is unknown or already the parent.
function reparentNode(n: VizNode, newParentId: string) {
  if (!n || !newParentId || n.parentId === newParentId) return;
  const newParent = state.nodes.get(newParentId);
  if (!newParent) return;
  const oldParent = n.parentId ? state.nodes.get(n.parentId) : null;
  if (oldParent) {
    const idx = oldParent.children.indexOf(n);
    if (idx >= 0) oldParent.children.splice(idx, 1);
  }
  n.parentId = newParent.id;
  newParent.children.push(n);
  if (oldParent) recomputeParallelFlags(oldParent.id);
  recomputeParallelFlags(newParent.id);
  markLayoutDirty(n);
}

// Mark all running agents under this session as parallel if 2+ run at once.
// Sticky: once flagged, an agent keeps isParallel=true for the rest of its life.
export function recomputeParallelFlags(sessionId: string) {
  const session = state.nodes.get(sessionId);
  if (!session) return;
  const runningAgents = session.children.filter(c =>
    c.type === 'agent' && c.status === 'running'
  );
  if (runningAgents.length >= 2) {
    for (const a of runningAgents) a.isParallel = true;
  }
}

// On SessionEnd, close every descendant that was still running so particle
// generation (which iterates vis.runningNodes) stops immediately.
export function cascadeTerminate(rootNodeId: string, ts: string) {
  const root = state.nodes.get(rootNodeId);
  if (!root) return;
  const stack = [...(root.children || [])];
  while (stack.length) {
    // La condition de boucle dit que la pile n'est pas vide : `pop` rend un noeud.
    const n = stack.pop()!;
    if (n.status === 'running') {
      n.status = 'done';
      n.endTime = ts;
      n.duration = calcDuration(n.startTime, ts);
      setRunning(n.id, false);
    }
    if (n.children && n.children.length) {
      for (const c of n.children) stack.push(c);
    }
  }
}

// ─── Event → graph mutation ───────────────────────────────────────────────
// Per-event handlers receive the same context bag (evt, sid, ts) and mutate
// state/vis directly. Adding a new hook event = one entry in EVENT_HANDLERS.

function ensureSessionParent(sid: string) {
  const parent = getNode(`s:${sid}`);
  parent.type = 'session';
  parent.label = parent.label || 'Session';
  parent.color = COLORS.session;
  return parent;
}

function onSessionStart(evt: HookEvent, sid: string, ts: string) {
  const n = getNode(`s:${sid}`);
  n.type = 'session'; n.label = 'Session'; n.sub = sid.slice(0, 8);
  n.color = COLORS.session; n.data = evt; n.status = 'running'; n.startTime = evt.started_at || ts;
  setRunning(n.id, true);
  addTimelineEntry(evt, n.id, 'session', 'Session', sid.slice(0, 8));
}

function onSubagentStart(evt: HookEvent, sid: string, ts: string) {
  const aid = evt.agent_id || sid;
  const n = getNode(`a:${aid}`);
  n.type = 'agent';
  n.label = agentLabel(evt);
  n.sub = (evt.tool_input && evt.tool_input.description) || aid.slice(0, 8);
  n.color = COLORS.agent; n.data = evt; n.status = 'running'; n.startTime = ts;
  if (evt.tool_input && evt.tool_input.isolation === 'worktree') n.isIsolated = true;
  setRunning(n.id, true);
  const parent = ensureSessionParent(sid);
  if (!n.parentId) { n.parentId = parent.id; parent.children.push(n); }
  recomputeParallelFlags(parent.id);
  addTimelineEntry(evt, n.id, 'agent', n.label, n.sub);
}

function onSubagentStop(evt: HookEvent, sid: string, ts: string) {
  const aid = evt.agent_id || sid;
  const n = state.nodes.get(`a:${aid}`);
  if (!n) return;
  // Le noeud est né au premier outil du sous-agent : l'heure réelle de son lancement le corrige.
  if (evt.started_at) n.startTime = evt.started_at;
  n.status = 'done'; n.data = evt; n.endTime = evt.ended_at || ts;
  n.duration = calcDuration(n.startTime, n.endTime);
  n.color = COLORS.complete;
  setRunning(n.id, false);
  if (n.parentId) recomputeParallelFlags(n.parentId);
}

function onPreToolUse(evt: HookEvent, sid: string, ts: string) {
  const tid = evt.tool_use_id || `t${state.eventSeq++}`;
  const n = getNode(`t:${tid}`);
  const isSkill = evt.tool_name === 'Skill';
  const isMcp = typeof evt.tool_name === 'string' && evt.tool_name.startsWith('mcp__');
  n.type = isSkill ? 'skill' : isMcp ? 'mcp' : 'tool';
  if (isMcp) {
    const parsed = parseMcpName(evt.tool_name);
    n.label = parsed.label;
    n.sub = parsed.sub;
  } else {
    n.label = isSkill ? ((evt.tool_input && evt.tool_input.skill) || 'Skill') : (evt.tool_name || 'Tool');
    n.sub = formatToolSub(evt);
  }
  n.color = isSkill ? COLORS.skill : isMcp ? COLORS.mcp : COLORS.tool;
  n.data = evt; n.status = 'running'; n.startTime = ts;
  setRunning(n.id, true);
  state.startTimes.set(tid, ts);
  const parentId = evt.agent_id ? `a:${evt.agent_id}` : `s:${sid}`;
  const parent = getNode(parentId);
  if (parentId.startsWith('s:')) {
    parent.type = 'session'; parent.label = parent.label || 'Session'; parent.color = COLORS.session;
  } else if (parent.type !== 'agent') {
    promoteAgentNode(parent, evt, sid, ts);
  }
  if (!n.parentId) { n.parentId = parent.id; parent.children.push(n); }
  addTimelineEntry(evt, n.id, n.type, n.label, n.sub);
}

// Subagent completion: PostToolUse on the main-thread Agent tool carries
// tool_response.agentId. This is the canonical "subagent done" signal,
// since SubagentStop hooks are not reliably emitted. terminalStatus is
// 'done' (PostToolUse) or 'error' (PostToolUseFailure).
function settleAgentFromAgentToolResponse(evt: HookEvent, ts: string, terminalStatus: 'done' | 'error') {
  if (evt.tool_name !== 'Agent') return;
  const aid = evt.tool_response && evt.tool_response.agentId;
  const an = aid ? state.nodes.get(`a:${aid}`) : null;
  if (!an || an.status !== 'running') return;
  an.status = terminalStatus;
  an.endTime = ts;
  an.duration = calcDuration(an.startTime, ts);
  an.color = terminalStatus === 'error' ? COLORS.error : COLORS.complete;
  setRunning(an.id, false);
  if (terminalStatus === 'done') {
    const desc = evt.tool_input && evt.tool_input.description;
    if (desc) an.sub = desc.slice(0, 45);
  }
  if (an.parentId) recomputeParallelFlags(an.parentId);
}

function onPostToolUse(evt: HookEvent, sid: string, ts: string) {
  const tid = evt.tool_use_id || '';
  const n = state.nodes.get(`t:${tid}`);
  if (n) {
    n.status = 'done'; n.data = evt; n.endTime = ts;
    n.duration = calcDuration(n.startTime, ts);
    state.toolsCompleted++;
    setRunning(n.id, false);
  }
  settleAgentFromAgentToolResponse(evt, ts, 'done');
  // Skill fork → record the parent mapping and reparent the forked sub-agent
  // under its launching agent. The child's first PreToolUse arrives before
  // this PostToolUse, so the child is initially attached to the session by
  // promoteAgentNode and must be moved retroactively here.
  if (evt.tool_name === 'Skill' && evt.tool_response
      && evt.tool_response.status === 'forked' && evt.tool_response.agentId
      && evt.agent_id) {
    const childAid = evt.tool_response.agentId;
    const parentAid = evt.agent_id;
    state.forkedAgentParents.set(childAid, parentAid);
    const childNode = state.nodes.get(`a:${childAid}`);
    if (childNode) reparentNode(childNode, `a:${parentAid}`);
  }
  // EN DERNIER, comme recordError dans le pendant echec : l'abonne repeint de
  // facon synchrone, il doit lire des noeuds deja a jour. C'est le fait de
  // continuite de la pastille — combien d'outils ont reussi depuis un echec.
  recordSuccess(evt);
}

function onPostToolUseFailure(evt: HookEvent, sid: string, ts: string) {
  const tid = evt.tool_use_id || '';
  const n = state.nodes.get(`t:${tid}`);
  if (n) {
    n.status = 'error'; n.color = COLORS.error; n.data = evt;
    n.endTime = evt.ended_at || ts; n.duration = calcDuration(n.startTime, n.endTime);
    setRunning(n.id, false);
  }
  settleAgentFromAgentToolResponse(evt, ts, 'error');
  // HORS du `if (n)` : un echec dont le noeud manque (PreToolUse non recu, noeud deja
  // ramasse) se compte aussi. Et EN DERNIER : l'abonne de `recordError`, synchrone, repeint
  // le flux d'apres le STATUT des noeuds, qui doit deja porter la mutation ci-dessus.
  recordError(evt);
}

function onNotification(evt: HookEvent, sid: string, ts: string) {
  const nid = `n:${state.eventSeq++}`;
  const n = getNode(nid);
  n.type = 'notification'; n.label = 'Notification'; n.sub = (evt.message || '').slice(0, 50);
  n.color = COLORS.notification; n.data = evt; n.status = 'done';
  const parent = ensureSessionParent(sid);
  if (!n.parentId) { n.parentId = parent.id; parent.children.push(n); }
  addTimelineEntry(evt, nid, 'notification', 'Notification', n.sub);
}

function onSessionEnd(evt: HookEvent, sid: string, ts: string) {
  const n = state.nodes.get(`s:${sid}`);
  if (!n) return;
  n.status = 'done'; n.data = evt; n.endTime = ts;
  n.duration = calcDuration(n.startTime, ts);
  n.color = COLORS.complete;
  setRunning(n.id, false);
  cascadeTerminate(n.id, ts);
}

type EventHandler = (evt: HookEvent, sid: string, ts: string) => void;

const EVENT_HANDLERS: Record<string, EventHandler> = {
  SessionStart: onSessionStart,
  SubagentStart: onSubagentStart,
  SubagentStop: onSubagentStop,
  PreToolUse: onPreToolUse,
  PostToolUse: onPostToolUse,
  PostToolUseFailure: onPostToolUseFailure,
  Notification: onNotification,
  Stop: onSessionEnd,
  SessionEnd: onSessionEnd,
};

export function processEvent(evt: HookEvent) {
  const sid = evt.session_id;
  if (typeof sid !== 'string' || !sid) {
    console.warn('[viz] event without session_id — ignored', evt.hook_event_name);
    return;
  }
  const ts = evt._ts || new Date().toISOString();
  layoutDirtyRoots.add(`s:${sid}`);
  const handler = evt.hook_event_name ? EVENT_HANDLERS[evt.hook_event_name] : undefined;
  if (handler) handler(evt, sid, ts);
  // No watchdog feed here: this function receives only the events a tab happened to be
  // open for, while the server sees all of them and runs detection.
  markNarratorDirty();
}

// Le format vit dans viz-duration.ts ; ici on ne garde que la
// traduction de « pas de durée » propre à la carte du graphe : `null`, que
// `viz-canvas` et le panneau de détail savent déjà taire.
export function calcDuration(start: string | null | undefined, end: string | null | undefined): string | null {
  if (!start || !end) return null;
  return formatDuration(new Date(end).getTime() - new Date(start).getTime());
}

// Feed label: the shared subject rule, cut to the width the feed column can
// show. The rule itself lives in the engine's tool-subject.ts — the watchdog
// needs the same answer at a different length.
export function formatToolSub(evt: HookEvent) {
  return toolSubject(evt).slice(0, 45);
}

// ─── Garbage collection ───────────────────────────────────────────────────
// Drop finished tool/skill/notification nodes older than the GC window, as
// long as no feed entry still references them (so clicks remain valid).
export function garbageCollect() {
  const now = Date.now();
  const referenced = new Set<string>();
  for (const e of state.timelineEntries) referenced.add(e.nodeId);

  const victims = [];
  for (const n of state.nodes.values()) {
    if (n.type !== 'tool' && n.type !== 'skill' && n.type !== 'mcp' && n.type !== 'notification') continue;
    if (n.status === 'running') continue;
    if (!n.endTime) continue;
    const endMs = +new Date(n.endTime);
    if (!isFinite(endMs)) continue;
    if (now - endMs < NODE_GC_MAX_AGE_MS) continue;
    if (referenced.has(n.id)) continue;
    victims.push(n);
  }
  if (!victims.length) return;
  const victimIds = new Set(victims.map(v => v.id));
  for (const n of victims) {
    if (n.parentId) {
      const parent = state.nodes.get(n.parentId);
      if (parent) {
        const idx = parent.children.indexOf(n);
        if (idx >= 0) parent.children.splice(idx, 1);
      }
    }
    state.nodes.delete(n.id);
    vis.nodes.delete(n.id);
    vis.runningNodes.delete(n.id);
  }
  const purge = (arr: DrawBucketEntry[]) => {
    for (let i = arr.length - 1; i >= 0; i--) {
      // `i` descend de length-1 a 0 : la case existe.
      if (victimIds.has(arr[i]!.n.id)) arr.splice(i, 1);
    }
  };
  purge(vis.drawToolNodes);
  purge(vis.drawSkillNodes);
  purge(vis.drawMcpNodes);
  purge(vis.drawAgentNodes);
  purge(vis.drawSessionNodes);
  markDirty();
}
