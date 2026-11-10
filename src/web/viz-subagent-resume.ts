// viz-subagent-resume.ts — la relance d'un sous-agent fermé par l'outil SendMessage.
//
// Le message adressé à un sous-agent qui a fini le remet au travail : son noeud se rouvre.
// Relancé en arrière-plan, il se referme à son compte rendu suivant ; relancé au premier plan,
// au retour du SendMessage qui porte ce compte rendu.

import { COLORS, state, vis, type VizNode } from './viz-state.ts';
import { recomputeParallelFlags } from './viz-parallel.ts';
import { endAgentNode } from './viz-subagent-end.ts';
import type { HookEvent } from './viz-graph.ts';

function resumedAgent(evt: HookEvent): VizNode | undefined {
  const input = evt.tool_input;
  if (evt.tool_name !== 'SendMessage' || input?.recipient_kind !== 'agent' || !input.recipient) return undefined;
  const an = state.nodes.get(`a:${input.recipient}`);
  return an?.type === 'agent' ? an : undefined;
}

// Rend le noeud rouvert, pour que le fil d'événements y ajoute sa ligne.
export function reopenResumedSubagent(evt: HookEvent): VizNode | undefined {
  const an = resumedAgent(evt);
  if (!an || an.status === 'running') return undefined;
  an.status = 'running';
  an.endTime = null;
  an.duration = null;
  an.color = COLORS.agent;
  vis.runningNodes.add(an.id);
  if (an.parentId) recomputeParallelFlags(an.parentId);
  return an;
}

// Le retour d'une relance au premier plan porte le compte rendu du sous-agent : il a fini.
export function settleInlineResume(evt: HookEvent, ts: string) {
  const an = resumedAgent(evt);
  if (an && an.status === 'running' && evt.tool_response?.inlineHandback) endAgentNode(an, 'done', ts);
}
