// Codex annonce la fin d'une commande sans dire si elle a échoué. Le verdict est dans son
// transcript, sur l'item CommandExecution qui porte l'identifiant du hook. Pur.

type Payload = Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Seules les lignes qui portent le marqueur sont décodées : le hook part à chaque outil.
function records(text: string, marker: string): Payload[] {
  const out: Payload[] = [];
  for (const line of text.split('\n')) {
    if (line.indexOf(marker) === -1) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isRecord(value)) out.push(value);
    } catch {
      // Une ligne en cours d'écriture, ou coupée par le début de la fenêtre de lecture.
    }
  }
  return out;
}

// La borne laisse passer un bloc d'erreur PowerShell entier, que lit l'alerte de mauvaise invocation.
const MAX_ERROR_LENGTH = 4000;

/** Le texte d'erreur de chaque commande en échec, par identifiant. */
function failedCommands(transcriptText: string): Map<string, string> {
  const failed = new Map<string, string>();
  for (const line of records(transcriptText, '"CommandExecution"')) {
    const item = isRecord(line.payload) ? line.payload.item : null;
    if (!isRecord(item) || item.type !== 'CommandExecution' || item.status !== 'failed') continue;
    const { id, exit_code, aggregated_output } = item;
    if (typeof id !== 'string' || typeof exit_code !== 'number' || typeof aggregated_output !== 'string') continue;
    failed.set(id, `Exit code ${exit_code}\n${aggregated_output}`.slice(0, MAX_ERROR_LENGTH).trimEnd());
  }
  return failed;
}

/** Les événements à écrire pour un événement de hook Codex, verdicts du transcript appliqués. */
export function codexEvents(evt: Payload, _eventsText: string, transcriptText: string): Payload[] {
  const failed = failedCommands(transcriptText);
  const error = evt.hook_event_name === 'PostToolUse' && typeof evt.tool_use_id === 'string'
    ? failed.get(evt.tool_use_id)
    : undefined;
  return [error === undefined ? evt : { ...evt, hook_event_name: 'PostToolUseFailure', error }];
}
