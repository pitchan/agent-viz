// viz-subagent-end.ts — la fin d'un sous-agent, lue sur un événement de l'agent qui le pilote.
//
// agent-viz n'installe pas le hook SubagentStop : un sous-agent se termine quand l'outil qui
// l'a lancé rend la main, quand un outil d'arrêt le nomme, ou quand un message du fil principal
// annonce sa fin. Ce module ferme alors son noeud.

import { COLORS, state, vis, type VizNode } from './viz-state.ts';
import { calcDuration } from './viz-duration.ts';
import { recomputeParallelFlags } from './viz-parallel.ts';
import type { HookEvent } from './viz-graph.ts';

export function endAgentNode(an: VizNode, status: 'done' | 'error', ts: string) {
  an.status = status;
  an.endTime = ts;
  an.duration = calcDuration(an.startTime, ts);
  an.color = status === 'error' ? COLORS.error : COLORS.complete;
  vis.runningNodes.delete(an.id);
  if (an.parentId) recomputeParallelFlags(an.parentId);
}

// L'outil Agent et le Skill en fork rendent la main quand leur sous-agent a fini, et le nomment
// alors dans tool_response.agentId.
export function launchesSubagent(evt: HookEvent): boolean {
  return evt.tool_name === 'Agent'
    || (evt.tool_name === 'Skill' && evt.tool_response?.status === 'forked');
}

// terminalStatus is 'done' (PostToolUse) or 'error' (PostToolUseFailure).
export function settleLaunchedSubagent(evt: HookEvent, ts: string, terminalStatus: 'done' | 'error') {
  if (!launchesSubagent(evt)) return;
  const aid = evt.tool_response && evt.tool_response.agentId;
  const an = aid ? state.nodes.get(`a:${aid}`) : null;
  if (!an || an.status !== 'running') return;
  // Le noeud est né au premier outil du sous-agent : le lancement de l'outil lanceur, connu
  // seulement maintenant qu'il nomme son sous-agent, est son vrai début.
  const launcher = state.nodes.get(`t:${evt.tool_use_id}`);
  if (launcher) an.startTime = launcher.startTime;
  endAgentNode(an, terminalStatus, ts);
  if (terminalStatus === 'done') {
    const desc = evt.tool_input && evt.tool_input.description;
    if (desc) an.sub = desc.slice(0, 45);
  }
}

// Outil d'arrêt → le sous-agent qu'il dit avoir arrêté. TaskStop arrête aussi les commandes en
// arrière-plan : seule une tâche de type sous-agent en nomme un.
const SUBAGENT_STOPPERS: Record<string, (r: NonNullable<HookEvent['tool_response']>) => string | undefined> = {
  TaskStop: r => (r.task_type === 'local_agent' ? r.task_id : undefined),
};

// Un sous-agent arrêté ne reçoit aucun hook de fin : la réponse de l'outil d'arrêt est sa fin.
export function settleStoppedSubagent(evt: HookEvent, ts: string) {
  const stopped = evt.tool_name ? SUBAGENT_STOPPERS[evt.tool_name] : undefined;
  const aid = stopped && evt.tool_response ? stopped(evt.tool_response) : undefined;
  const an = aid ? state.nodes.get(`a:${aid}`) : undefined;
  if (an && an.status === 'running') endAgentNode(an, 'done', ts);
}

// La fin du tour liste dans background_tasks ce qui travaille encore : un sous-agent lancé en
// arrière-plan y figure, et sa fin arrive plus tard.
export function stillRunningSubagents(evt: HookEvent): Set<string> {
  return new Set((evt.background_tasks || [])
    .filter(t => t.type === 'subagent' && t.status === 'running')
    .map(t => `a:${t.id}`));
}

// Messages du fil principal qui annoncent la fin d'un sous-agent en arrière-plan : son compte
// rendu de fin, ou la notification de fin de sa tâche (seule trace d'un sous-agent interrompu).
const SUBAGENT_END_MESSAGES: RegExp[] = [
  /^<agent-message from="([^"]+)">\s*\[Subagent hand-back\]/,
  /^<task-notification>\s*<task-id>([^<]+)<\/task-id>/,
];

export function settleReportedSubagent(evt: HookEvent, ts: string) {
  const prompt = evt.prompt || '';
  const aid = SUBAGENT_END_MESSAGES.map(re => prompt.match(re)?.[1]).find(Boolean);
  const an = aid ? state.nodes.get(`a:${aid}`) : undefined;
  if (an && an.status === 'running') endAgentNode(an, 'done', ts);
}
