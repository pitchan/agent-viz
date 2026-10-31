// Copilot CLI n'envoie aucun identifiant d'appel, et la page relie la fin d'un outil à son début
// par `tool_use_id`. Chaque début en reçoit un ; chaque fin reprend celui du plus ancien début
// encore ouvert de la session, même outil, mêmes arguments. Pur.

import { records, toolStates } from './hook-codex-verdicts.ts';

type Payload = Record<string, unknown>;

function sameCall(a: Payload, b: Payload): boolean {
  return a.tool_name === b.tool_name && JSON.stringify(a.tool_input) === JSON.stringify(b.tool_input);
}

// Le rang suit le plus grand déjà écrit, pas le nombre de lignes : le ménage tronque le fichier.
function nextRank(prefix: string, eventsText: string): number {
  let last = 0;
  for (const evt of records(eventsText, `"${prefix}`)) {
    const id = evt.tool_use_id;
    const rank = typeof id === 'string' && id.startsWith(prefix) ? Number(id.slice(prefix.length)) : NaN;
    if (Number.isInteger(rank) && rank > last) last = rank;
  }
  return last + 1;
}

/** L'événement Copilot muni de son identifiant d'appel, d'après le fichier d'événements de sa session. */
export function copilotToolIds(evt: Payload, eventsText: string): Payload {
  const name = evt.hook_event_name;
  if (name === 'PreToolUse') {
    const prefix = `copilot:${String(evt.session_id)}:`;
    return { ...evt, tool_use_id: prefix + nextRank(prefix, eventsText) };
  }
  if (name !== 'PostToolUse' && name !== 'PostToolUseFailure') return evt;
  for (const [id, pre] of toolStates(eventsText).unfinished) {
    if (sameCall(pre, evt)) return { ...evt, tool_use_id: id };
  }
  return evt;
}
