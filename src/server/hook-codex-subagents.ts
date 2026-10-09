// Codex nomme un sous-agent dans la première ligne de son transcript, et écrit sa fin dans celui
// du fil qui l'a lancé. Le hook ne porte ni le nom ni la fin. Pur.

import { records } from './hook-codex-verdicts.ts';

type Payload = Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface AgentIdentity {
  agent_name: string;
  agent_nickname: string;
}

/** Le nom et le surnom d'un sous-agent, lus dans l'en-tête de son transcript ; `null` pour un fil qui n'en a pas. */
export function agentIdentity(transcriptHead: string): AgentIdentity | null {
  const end = transcriptHead.indexOf('\n');
  if (end === -1) return null;
  const meta: unknown = JSON.parse(transcriptHead.slice(0, end));
  if (!isRecord(meta) || meta.type !== 'session_meta' || !isRecord(meta.payload)) return null;
  const { agent_path, agent_nickname } = meta.payload;
  if (typeof agent_path !== 'string' || typeof agent_nickname !== 'string') return null;
  return { agent_name: agent_path.slice(agent_path.lastIndexOf('/') + 1), agent_nickname };
}

/** Les fins de sous-agent que le transcript révèle et que le fichier d'événements ne porte pas encore. */
export function subagentStops(evt: Payload, eventsText: string, transcriptText: string): Payload[] {
  // Un sous-agent relancé finit plusieurs fois : c'est la fin qui est identifiée, pas l'agent.
  const written = new Set<unknown>();
  for (const stop of records(eventsText, '"SubagentStop"')) written.add(stop.activity_id);

  // Le début du passage en cours de chaque sous-agent : son lancement, ou le message qui le
  // relance une fois fini. Un message reçu en plein travail ne déplace pas ce début.
  const runStart = new Map<string, string>();
  const out: Payload[] = [];
  for (const line of records(transcriptText, '"SubAgentActivity"')) {
    const item = isRecord(line.payload) ? line.payload.item : null;
    if (!isRecord(item) || item.type !== 'SubAgentActivity') continue;
    const { id, kind, agent_thread_id } = item;
    if (typeof id !== 'string' || typeof agent_thread_id !== 'string' || typeof line.timestamp !== 'string') continue;
    if (kind === 'started' || (kind === 'interacted' && !runStart.has(agent_thread_id))) {
      runStart.set(agent_thread_id, line.timestamp);
    }
    if (kind !== 'completed') continue;
    const started_at = runStart.get(agent_thread_id);
    runStart.delete(agent_thread_id);
    if (written.has(id)) continue;
    out.push({
      hook_event_name: 'SubagentStop',
      session_id: evt.session_id,
      agent_id: agent_thread_id,
      activity_id: id,
      // Le hook ne voit le sous-agent qu'à son premier outil, et sa fin qu'au hook suivant :
      // les heures réelles du passage sont celles du transcript.
      started_at,
      ended_at: line.timestamp,
      transcript_path: evt.transcript_path,
    });
  }
  return out;
}
