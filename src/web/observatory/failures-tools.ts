// failures-tools.ts — comment l'onglet Pannes range ses pannes : par outil, par
// nombre d'apparitions, sous des noms lisibles. Module pur : il decide de l'ordre
// et des noms, failures-format.ts du regroupement par cause et des phrases.

import { groupAlerts, panelAlerts, motifPhrase, type AlertGroup } from './failures-format.ts';
import type { Alert } from '../../engine/watchdog/detector.ts';

// Les appels mal formes hors des familles de shell connues, quand leurs
// episodes ne partagent pas un outil : aucun outil reel ne porte ce nom.
export const OTHER_INVOCATIONS = 'autres-appels-mal-formes';

const TOOL_NAMES: Record<string, string> = {
  Bash: 'Shell (Bash)',
  PowerShell: 'PowerShell',
  WebFetch: 'Lecture de page web',
  WebSearch: 'Recherche web',
  Read: 'Lecture de fichier',
  Edit: 'Modification de fichier',
  Write: 'Écriture de fichier',
  SendUserFile: 'Envoi de fichier',
  SubagentHandback: 'Retour de sous-agent',
  [OTHER_INVOCATIONS]: 'Autres appels mal formés',
};

// La liste des outils est ouverte : un nom inconnu se montre tel qu'il est.
export function toolDisplayName(tool: string) {
  const known = TOOL_NAMES[tool];
  if (known) return known;
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  return mcp ? `${mcp[2]} (serveur ${mcp[1]})` : tool;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// L'outil est dit par le groupe qui contient la panne : le nom ne le repete pas.
const CAUSE_NAMES: Record<Alert['type'], (first: Alert) => string> = {
  loop: () => 'Même appel répété à l’identique',
  retryStorm: () => 'Échecs à la suite',
  badInvocation: first => capitalize(motifPhrase(first.patternId)),
  stuck: () => 'Outils encore en vol',
};

export function causeName(group: AlertGroup) {
  const first = group.episodes[0]!;
  return CAUSE_NAMES[first.type](first);
}

// Un appel mal forme est groupe par motif, et un motif traverse les outils :
// il se range sous le shell que son motif nomme.
const SHELL_OF_PATTERN: [string, string][] = [
  ['inv-ps-', 'PowerShell'],
  ['inv-bash-', 'Bash'],
  ['inv-cross-shell-', 'Bash'],
];

export function causeTool(group: AlertGroup) {
  const first = group.episodes[0]!;
  if (first.type === 'badInvocation') {
    const shell = SHELL_OF_PATTERN.find(([prefix]) => first.patternId.startsWith(prefix));
    if (shell) return shell[1];
  }
  const tools = new Set(group.episodes.map(e => e.toolName));
  return tools.size === 1 ? first.toolName : OTHER_INVOCATIONS;
}

export type Gravity = 'high' | 'mid' | 'low';

export function gravity(appearances: number): Gravity {
  if (appearances >= 5) return 'high';
  return appearances >= 2 ? 'mid' : 'low';
}

export interface ToolGroup {
  tool: string;
  label: string;
  causes: AlertGroup[];
  total: number;
  lastAt: number;
}

export interface PannesLayout {
  top: AlertGroup[];
  tools: ToolGroup[];
  once: AlertGroup[];
  acked: AlertGroup[];
  toTreatCount: number;
  appearances: number;
}

// Le plus apparu d'abord, le plus recent a egalite.
const byFrequency = (a: { n: number; lastAt: number }, b: { n: number; lastAt: number }) =>
  b.n - a.n || b.lastAt - a.lastAt;
const causeOrder = (a: AlertGroup, b: AlertGroup) =>
  byFrequency({ n: a.episodes.length, lastAt: a.lastAt }, { n: b.episodes.length, lastAt: b.lastAt });

export function layoutPannes(alerts: Alert[]): PannesLayout {
  const groups = groupAlerts(panelAlerts(alerts));
  const toTreat = groups.filter(g => g.unacked > 0).sort(causeOrder);

  const byTool = new Map<string, AlertGroup[]>();
  for (const g of toTreat) {
    const tool = causeTool(g);
    byTool.set(tool, [...(byTool.get(tool) ?? []), g]);
  }
  const all = [...byTool.entries()].map(([tool, causes]) => ({
    tool,
    label: toolDisplayName(tool),
    causes,
    total: causes.reduce((n, g) => n + g.episodes.length, 0),
    lastAt: Math.max(...causes.map(g => g.lastAt)),
  }));

  return {
    top: toTreat.slice(0, 3),
    tools: all.filter(t => t.total > 1)
      .sort((a, b) => byFrequency({ n: a.total, lastAt: a.lastAt }, { n: b.total, lastAt: b.lastAt })),
    once: all.filter(t => t.total === 1).flatMap(t => t.causes).sort((a, b) => b.lastAt - a.lastAt),
    acked: groups.filter(g => g.unacked === 0),
    toTreatCount: toTreat.length,
    appearances: toTreat.reduce((n, g) => n + g.episodes.length, 0),
  };
}
