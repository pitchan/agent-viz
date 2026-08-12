import type { ToolUseRef } from '../../core/events.js';
import { detectGraphSignal } from '../../router/detector.js';
import { SPAWN_TOOL_NAMES } from './subagents.js';

/**
 * Détecteur DÉTERMINISTE des gestes de graphe de l'AGENT (plan comportement-agent) —
 * l'angle mort du « gain vécu » v0.7.0 qui ne jugeait que les prompts humains.
 * Même calibrage que le détecteur du router : précision avant rappel (un faux
 * positif gonflerait le dossier « rouvrir la carte » sur du bruit). Périmètre
 * JS/TS seulement — l'habitat de la carte ; un grep d'imports Python ne serait
 * pas servi par elle, donc ne compte pas.
 */
export type AgentGestureKind = 'grepImport' | 'bashImport' | 'spawnGraphPrompt';

/** Les classes d'échappement regex deviennent des espaces (piège réel : « \bimport\b » littéral dans les motifs). */
function normalizePattern(pattern: string): string {
  return pattern.replace(/\\[bBsSwWdD]/g, ' ');
}

/** Forme d'import JS/TS : mot « import », mot « require », ou « from » suivi d'une quote proche. */
function hasImportShape(text: string): boolean {
  const norm = normalizePattern(text);
  return /\bimport\b/i.test(norm) || /\brequire\b/i.test(norm) || /\bfrom\b.{0,8}['"]/i.test(norm);
}

/** path ciblant UN fichier (extension finale) = « qu'importe CE fichier » — lecture locale, pas un geste de graphe. */
function isSingleFilePath(path: unknown): boolean {
  return typeof path === 'string' && /\.[a-z0-9]{1,6}$/i.test(path);
}

const GREP_VERB = /(^|[\s|;&("'`])(rg|grep|egrep|git\s+grep|select-string|findstr)\b/i;

export function detectAgentGesture(tu: ToolUseRef): AgentGestureKind | null {
  const input = typeof tu.input === 'object' && tu.input !== null ? (tu.input as Record<string, unknown>) : {};
  if (tu.name === 'Grep') {
    const pattern = input['pattern'];
    if (typeof pattern !== 'string' || !hasImportShape(pattern)) return null;
    return isSingleFilePath(input['path']) ? null : 'grepImport';
  }
  if (tu.name === 'Bash') {
    const command = input['command'];
    if (typeof command !== 'string' || !GREP_VERB.test(command) || !hasImportShape(command)) return null;
    return 'bashImport';
  }
  if (SPAWN_TOOL_NAMES.has(tu.name)) {
    const text = [input['description'], input['prompt']]
      .filter((v): v is string => typeof v === 'string')
      .join('\n');
    return text.length > 0 && detectGraphSignal(text) !== null ? 'spawnGraphPrompt' : null;
  }
  return null;
}
