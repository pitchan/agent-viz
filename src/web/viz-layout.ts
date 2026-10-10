// viz-layout.ts — incremental orbital layout.
//
// Places each node of state.nodes in orbit around its parent and pushes the
// result to the vis layer (ensureVisNode + draw buckets) as animation targets.
// Reads the graph, never builds it: viz-graph.ts does. Pure: no DOM, no
// rendering, no fetch.

import { SPAWN_DIST, state, vis, type VizNode, type VisNode } from './viz-state.ts';

export function ensureVisNode(id: string): VisNode {
  if (!vis.nodes.has(id)) {
    const n = state.nodes.get(id);
    const parent = n && n.parentId ? vis.nodes.get(n.parentId) : null;
    const startX = parent ? parent.x : 0;
    const startY = parent ? parent.y : 0;
    const vn = {
      id,
      x: startX, y: startY,
      targetX: 0, targetY: 0,
      opacity: 0, targetOpacity: 1,
      scale: 0.3, targetScale: 1,
      glowPhase: Math.random() * Math.PI * 2,
    };
    vis.nodes.set(id, vn);
    if (n) {
      const bucket = n.type === 'session' ? vis.drawSessionNodes
        : n.type === 'agent' ? vis.drawAgentNodes
        : n.type === 'skill' ? vis.drawSkillNodes
        : n.type === 'mcp' ? vis.drawMcpNodes
        : vis.drawToolNodes;
      bucket.push({ n, vn });
    }
  }
  // La position vient d'etre posee juste au-dessus quand elle manquait : la
  // table la contient forcement ici.
  return vis.nodes.get(id)!;
}

// ─── Layout (incremental orbital) ─────────────────────────────────────────
export const layoutDirtyRoots = new Set<string>();
let _lastRootCount = -1;
let _layoutFullDirty = true;

function getRootId(n: VizNode | undefined): string | null {
  while (n && n.parentId) n = state.nodes.get(n.parentId);
  return n ? n.id : null;
}

export function markLayoutDirty(node: VizNode) {
  const rid = getRootId(node);
  if (rid) layoutDirtyRoots.add(rid);
}

export function markLayoutFullDirty() { _layoutFullDirty = true; }

// Reset internal layout counters — called from clearState on session switch.
export function resetLayout() {
  _layoutFullDirty = true;
  _lastRootCount = -1;
  layoutDirtyRoots.clear();
}

// Count agent nodes in a subtree (the node + all transitively-reachable agent
// children). Used by the root layout to inflate the agent ring proportionally
// to how much room each branch needs.
function subtreeAgentCount(n: VizNode): number {
  let w = 1;
  for (const c of n.children) if (c.type === 'agent') w += subtreeAgentCount(c);
  return w;
}

// Position one agent's tool and sub-agent children outward from the agent
// (along `dirFromParent`), then recurse into each sub-agent. Sub-agents fan
// out on an outer arc; tools either fan along the parent axis (no sub-agents)
// or split into two short lateral fans (sub-agents present) so they avoid
// both the sub-agent ring and the path back to the parent.
function layoutAgent(agent: VizNode, dirFromParent: number) {
  const filtered = agent.children.filter(c => matchesFilter(c));
  const subAgents = filtered.filter(c => c.type === 'agent');
  const tools = filtered.filter(c => c.type !== 'agent');

  const runningTools = tools.filter(c => c.status === 'running');
  const doneTools = tools.filter(c => c.status !== 'running');
  const visibleDone = doneTools.slice(-5);
  const visibleTools = [...visibleDone, ...runningTools];

  const subDist = 160 + Math.max(0, subAgents.length - 2) * 26;
  const subSpread = Math.min(Math.PI * 1.4, Math.max(Math.PI * 0.45, subAgents.length * 0.5));
  subAgents.forEach((sa, i) => {
    const t = subAgents.length === 1 ? 0 : (i / (subAgents.length - 1) - 0.5);
    const angle = dirFromParent + t * subSpread;
    sa.x = agent.x + Math.cos(angle) * subDist;
    sa.y = agent.y + Math.sin(angle) * subDist;
    layoutAgent(sa, angle);
  });

  if (subAgents.length === 0) {
    // No sub-agents → tools fan along the outward axis.
    const toolDist = 90 + visibleTools.length * 8;
    const toolSpread = Math.min(Math.PI * 1.2, visibleTools.length * 0.35);
    visibleTools.forEach((tool, ti) => {
      const tAngle = dirFromParent - toolSpread / 2
        + (ti / Math.max(visibleTools.length - 1, 1)) * toolSpread;
      tool.x = agent.x + Math.cos(tAngle) * toolDist;
      tool.y = agent.y + Math.sin(tAngle) * toolDist;
      tool._visible = true;
    });
  } else {
    // Sub-agents take the outward fan; place tools in two short side-fans
    // perpendicular to the parent axis so they avoid both the sub-agent ring
    // and the path back to the parent (which has its own tools).
    const half = Math.ceil(visibleTools.length / 2);
    const toolDist = 80 + half * 10;
    const fanSpread = Math.min(Math.PI * 0.6, Math.max(Math.PI * 0.2, half * 0.3));
    visibleTools.forEach((tool, ti) => {
      const onLeft = ti < half;
      const sideIdx = onLeft ? ti : ti - half;
      const sideCount = onLeft ? half : Math.max(1, visibleTools.length - half);
      const sideBase = dirFromParent + (onLeft ? -Math.PI / 2 : Math.PI / 2);
      const t = sideCount === 1 ? 0 : (sideIdx / (sideCount - 1) - 0.5);
      const angle = sideBase + t * fanSpread;
      tool.x = agent.x + Math.cos(angle) * toolDist;
      tool.y = agent.y + Math.sin(angle) * toolDist;
      tool._visible = true;
    });
  }
  tools.filter(c => !visibleTools.includes(c)).forEach(c => { c._visible = false; });
}

function layoutRoot(root: VizNode) {
  const cx = root.x;
  const agents = root.children.filter(c => c.type === 'agent');
  const tools = root.children.filter(c => c.type !== 'agent');

  // Push agents farther out when any branch has its own sub-agents, so the
  // recursive sub-agent fans have room without colliding with the session ring.
  const branchInflation = agents.reduce((s, a) => s + Math.max(0, subtreeAgentCount(a) - 1), 0);
  const agentDist = SPAWN_DIST + Math.max(0, agents.length - 3) * 30 + branchInflation * 60;
  agents.forEach((agent, ai) => {
    const angle = -Math.PI / 2 + (ai / Math.max(agents.length, 1)) * Math.PI * 2;
    agent.x = cx + Math.cos(angle) * agentDist;
    agent.y = root.y + Math.sin(angle) * agentDist;
    layoutAgent(agent, angle);
  });

  const visibleRootTools = tools.filter(c => matchesFilter(c));
  const runningRootTools = visibleRootTools.filter(c => c.status === 'running');
  const doneRootTools = visibleRootTools.filter(c => c.status !== 'running');
  const recentRootTools = [...doneRootTools.slice(-10), ...runningRootTools];
  const rootToolDist = agents.length > 0 ? SPAWN_DIST * 0.55 : SPAWN_DIST * 0.7;
  recentRootTools.forEach((tool, ti) => {
    const angle = -Math.PI / 2 + (ti / Math.max(recentRootTools.length, 1)) * Math.PI * 2;
    tool.x = cx + Math.cos(angle) * rootToolDist;
    tool.y = root.y + Math.sin(angle) * rootToolDist;
    tool._visible = true;
  });
  visibleRootTools.filter(c => !recentRootTools.includes(c)).forEach(c => { c._visible = false; });
}

function pushTargetsForSubtree(root: VizNode) {
  const stack = [root];
  while (stack.length) {
    // La condition de boucle dit que la pile n'est pas vide : `pop` rend un noeud.
    const n = stack.pop()!;
    const vn = ensureVisNode(n.id);
    vn.targetX = n.x;
    vn.targetY = n.y;
    const isDoneTool = (n.type === 'tool' || n.type === 'skill' || n.type === 'mcp') && n.status !== 'running';
    vn.targetOpacity = (n._visible === false) ? 0 : isDoneTool ? 0.5 : 1;
    vn.targetScale = (n._visible === false) ? 0 : 1;
    if (n.children && n.children.length) {
      for (const c of n.children) stack.push(c);
    }
  }
}

export function layout() {
  const roots = [];
  for (const n of state.nodes.values()) {
    if (!n.parentId) roots.push(n);
  }
  const totalRoots = roots.length;

  if (totalRoots !== _lastRootCount || _layoutFullDirty) {
    _lastRootCount = totalRoots;
    _layoutFullDirty = false;
    layoutDirtyRoots.clear();
    roots.forEach((root, i) => {
      const cx = totalRoots > 1 ? (i - (totalRoots - 1) / 2) * 400 : 0;
      root.x = cx; root.y = 0;
      layoutRoot(root);
      pushTargetsForSubtree(root);
    });
    return;
  }

  if (!layoutDirtyRoots.size) return;

  roots.forEach((root, i) => {
    if (!layoutDirtyRoots.has(root.id)) return;
    const cx = totalRoots > 1 ? (i - (totalRoots - 1) / 2) * 400 : 0;
    root.x = cx; root.y = 0;
    layoutRoot(root);
    pushTargetsForSubtree(root);
  });
  layoutDirtyRoots.clear();
}

export function matchesFilter(n: VizNode) {
  if (!state.filter) return true;
  const f = state.filter;
  return n.label.toLowerCase().includes(f) || n.sub.toLowerCase().includes(f) || n.type.includes(f);
}
