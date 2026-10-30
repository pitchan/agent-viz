// viz-parallel.ts — la pastille « parallèle » des agents frères.
//
// Lit les heures de passage des agents d'un même parent et pose isParallel.
// Ni DOM, ni rendu, ni réseau.

import { state, type VizNode } from './viz-state.ts';

// Le passage d'un agent, en millisecondes ; un agent en cours court jusqu'à maintenant.
function agentSpan(n: VizNode): [number, number] {
  const end = n.status === 'running' ? Infinity : Date.parse(n.endTime ?? '');
  return [Date.parse(n.startTime ?? ''), end];
}

// Deux agents frères sont parallèles quand leurs passages se chevauchent. Un début corrigé
// après coup compte (un agent né à son premier outil peut avoir été lancé bien avant), et le
// drapeau suit les frères actuels : un agent changé de parent est réévalué.
export function recomputeParallelFlags(parentId: string) {
  const parent = state.nodes.get(parentId);
  if (!parent) return;
  const agents = parent.children.filter(c => c.type === 'agent');
  const spans = agents.map(agentSpan);
  for (const a of agents) a.isParallel = false;
  // `i` et `j` restent sous la longueur commune des deux tableaux : les cases existent.
  for (let i = 0; i < agents.length; i++) {
    const [aStart, aEnd] = spans[i]!;
    for (let j = i + 1; j < agents.length; j++) {
      const [bStart, bEnd] = spans[j]!;
      if (aStart < bEnd && bStart < aEnd) { agents[i]!.isParallel = true; agents[j]!.isParallel = true; }
    }
  }
}
