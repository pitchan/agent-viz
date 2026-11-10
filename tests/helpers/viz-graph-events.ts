// Rejouer des événements hook dans le graphe et lire la pastille « parallèle » des agents.
// L'état du graphe est un singleton de module : chaque test le remet à zéro.

import { state, vis } from '../../src/web/viz-state.ts';
import { type HookEvent } from '../../src/web/viz-graph.ts';
import { layoutDirtyRoots } from '../../src/web/viz-layout.ts';
import { resetErrors } from '../../src/web/viz-errors.ts';

export const SID = 'session-0001';

export function resetGraph(): void {
  state.nodes.clear();
  state.timelineEntries.length = 0;
  state.eventSeq = 0;
  state.startTimes.clear();
  state.forkedAgentParents.clear();
  state.workflowSubagents.clear();
  state.runningWorkflows.clear();
  vis.nodes.clear();
  vis.runningNodes.clear();
  layoutDirtyRoots.clear();
  resetErrors();
}

export function ev(ts: string, hook_event_name: string, extra: Partial<HookEvent> = {}): HookEvent {
  return { session_id: SID, hook_event_name, _ts: ts, ...extra };
}

/** La pastille de chaque agent du graphe, indexée par son identifiant d'agent. */
export function parallelFlags(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const n of state.nodes.values()) if (n.type === 'agent') out[n.id.slice(2)] = n.isParallel;
  return out;
}
