// Codex annonce la fin d'une commande sans dire si elle a échoué, et n'annonce rien quand elle
// n'a pas démarré. Le verdict est dans son transcript, sur l'item CommandExecution qui porte
// l'identifiant du hook. Pur.

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

/** Les lancements de commande que le fichier d'événements n'a pas encore clos, par identifiant. */
function unfinished(eventsText: string): Map<string, Payload> {
  const started = new Map<string, Payload>();
  for (const evt of records(eventsText, '"tool_use_id"')) {
    if (typeof evt.tool_use_id !== 'string') continue;
    const name = evt.hook_event_name;
    if (name === 'PreToolUse') started.set(evt.tool_use_id, evt);
    else if (name === 'PostToolUse' || name === 'PostToolUseFailure') started.delete(evt.tool_use_id);
  }
  return started;
}

/** Les événements à écrire pour un événement de hook Codex, verdicts du transcript appliqués. */
export function codexEvents(evt: Payload, eventsText: string, transcriptText: string): Payload[] {
  const failed = failedCommands(transcriptText);
  const out: Payload[] = [];
  for (const [id, pre] of unfinished(eventsText)) {
    const error = failed.get(id);
    // La commande dont la fin arrive est écrite plus bas, une seule fois.
    if (error === undefined || id === evt.tool_use_id) continue;
    out.push({
      hook_event_name: 'PostToolUseFailure',
      session_id: pre.session_id,
      tool_use_id: id,
      tool_name: pre.tool_name,
      tool_input: pre.tool_input,
      error,
      cwd: pre.cwd,
      transcript_path: pre.transcript_path,
    });
  }
  const error = evt.hook_event_name === 'PostToolUse' && typeof evt.tool_use_id === 'string'
    ? failed.get(evt.tool_use_id)
    : undefined;
  out.push(error === undefined ? evt : { ...evt, hook_event_name: 'PostToolUseFailure', error });
  return out;
}
