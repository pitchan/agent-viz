// Codex annonce la fin d'une commande sans dire si elle a échoué, et n'annonce rien quand elle
// n'a pas démarré. Le verdict est dans son transcript, sur l'item CommandExecution qui porte
// l'identifiant du hook. Pur.

type Payload = Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Seules les lignes qui portent le marqueur sont décodées : le hook part à chaque outil.
export function records(text: string, marker: string): Payload[] {
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

interface Verdict {
  error: string;
  endedAt: string;
}

/** Le texte d'erreur et l'heure de fin de chaque commande en échec, par identifiant. */
function failedCommands(transcriptText: string): Map<string, Verdict> {
  const failed = new Map<string, Verdict>();
  for (const line of records(transcriptText, '"CommandExecution"')) {
    const item = isRecord(line.payload) ? line.payload.item : null;
    if (!isRecord(item) || item.type !== 'CommandExecution' || item.status !== 'failed') continue;
    const { id, exit_code, aggregated_output } = item;
    if (typeof id !== 'string' || typeof exit_code !== 'number' || typeof aggregated_output !== 'string') continue;
    if (typeof line.timestamp !== 'string') continue;
    const error = `Exit code ${exit_code}\n${aggregated_output}`.slice(0, MAX_ERROR_LENGTH).trimEnd();
    failed.set(id, { error, endedAt: line.timestamp });
  }
  return failed;
}

interface ToolStates {
  unfinished: Map<string, Payload>;
  failed: Set<string>;
}

/** Les lancements que le fichier d'événements n'a pas encore clos, et les échecs qu'il porte déjà. */
function toolStates(eventsText: string): ToolStates {
  const unfinished = new Map<string, Payload>();
  const failed = new Set<string>();
  for (const evt of records(eventsText, '"tool_use_id"')) {
    if (typeof evt.tool_use_id !== 'string') continue;
    const name = evt.hook_event_name;
    if (name === 'PreToolUse') unfinished.set(evt.tool_use_id, evt);
    else if (name === 'PostToolUse' || name === 'PostToolUseFailure') unfinished.delete(evt.tool_use_id);
    if (name === 'PostToolUseFailure') failed.add(evt.tool_use_id);
  }
  return { unfinished, failed };
}

/** Les événements à écrire pour un événement de hook Codex, verdicts du transcript appliqués. */
export function codexEvents(evt: Payload, eventsText: string, transcriptText: string): Payload[] {
  const verdicts = failedCommands(transcriptText);
  const written = toolStates(eventsText);
  const out: Payload[] = [];
  for (const [id, pre] of written.unfinished) {
    const verdict = verdicts.get(id);
    // La commande dont la fin arrive est écrite plus bas, une seule fois.
    if (verdict === undefined || id === evt.tool_use_id) continue;
    out.push({
      hook_event_name: 'PostToolUseFailure',
      session_id: pre.session_id,
      tool_use_id: id,
      agent_id: pre.agent_id,
      agent_type: pre.agent_type,
      tool_name: pre.tool_name,
      tool_input: pre.tool_input,
      error: verdict.error,
      // L'événement est écrit au hook suivant : l'heure réelle de l'échec est celle du transcript.
      ended_at: verdict.endedAt,
      cwd: pre.cwd,
      transcript_path: pre.transcript_path,
    });
  }
  if (evt.hook_event_name !== 'PostToolUse' || typeof evt.tool_use_id !== 'string') return [...out, evt];
  // Un autre hook de la session a déjà clos cette commande par son échec : sa fin la rouvrirait.
  if (written.failed.has(evt.tool_use_id)) return out;
  const verdict = verdicts.get(evt.tool_use_id);
  return [...out, verdict === undefined ? evt : { ...evt, hook_event_name: 'PostToolUseFailure', error: verdict.error }];
}
