// Antigravity annonce la fin d'un outil avant d'en écrire le résultat, et sans dire s'il a échoué.
// Le résultat est sur disque à la fin de l'appel au modèle (PostInvocation) : c'est là que les
// échecs sont lus dans le transcript et rendus sous forme d'événements PostToolUseFailure. Pur.

type Payload = Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function jsonLines(text: string): Payload[] {
  const out: Payload[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isRecord(value)) out.push(value);
    } catch {
      // Une ligne en cours d'écriture par agy : elle sera lue à la fin de l'appel suivant.
    }
  }
  return out;
}

// Ancrée sur l'en-tête qu'agy pose lui-même : la sortie de la commande, plus bas, ne peut pas l'imiter.
const EXIT_CODE = /^Created At: [^\n]*\nCompleted At: [^\n]*\n\n(The command exited with code (\d+)\.)/;
const MAX_ERROR_LENGTH = 500;

// La phrase d'agy est reprise telle quelle : son code n'est pas toujours celui de la commande.
function failureOf(toolName: unknown, result: Payload): string | null {
  if (result.status === 'ERROR') {
    const reason = typeof result.error === 'string' && result.error ? result.error : result.content;
    return typeof reason === 'string' && reason ? reason.slice(0, MAX_ERROR_LENGTH) : 'step failed';
  }
  if (toolName !== 'run_command' || typeof result.content !== 'string') return null;
  const m = EXIT_CODE.exec(result.content);
  return m && m[1] && m[2] !== '0' ? m[1] : null;
}

/** Les échecs que le transcript révèle et que le fichier d'événements ne porte pas encore. */
export function lateFailures(eventsText: string, transcriptText: string): Payload[] {
  const started = new Map<string, Payload>();
  const failed = new Set<string>();
  for (const evt of jsonLines(eventsText)) {
    if (typeof evt.tool_use_id !== 'string') continue;
    if (evt.hook_event_name === 'PreToolUse') started.set(evt.tool_use_id, evt);
    if (evt.hook_event_name === 'PostToolUseFailure') failed.add(evt.tool_use_id);
  }
  const results = new Map<unknown, Payload>();
  for (const line of jsonLines(transcriptText)) results.set(line.step_index, line);

  const out: Payload[] = [];
  for (const [id, pre] of started) {
    if (failed.has(id)) continue;
    const result = results.get(pre.stepIdx);
    const error = result ? failureOf(pre.tool_name, result) : null;
    if (error === null) continue;
    out.push({
      hook_event_name: 'PostToolUseFailure',
      _native_event: 'PostInvocation',
      session_id: pre.session_id,
      tool_use_id: id,
      tool_name: pre.tool_name,
      tool_input: pre.tool_input,
      error,
      cwd: pre.cwd,
      transcript_path: pre.transcript_path,
    });
  }
  return out;
}
