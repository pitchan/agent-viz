// Antigravity n'annonce pas le début d'une conversation. Son transcript s'ouvre sur la question
// de l'utilisateur, datée : à la fin d'un appel au modèle, cette heure est rendue sous forme
// d'un événement SessionStart, une seule fois par conversation. L'heure va dans `started_at` :
// `_ts` reste l'heure de réception, que l'alerte de blocage lit comme une horloge. Pur.

import { jsonLines } from './hook-antigravity-verdicts.ts';

type Payload = Record<string, unknown>;

// Le format du transcript n'est pas documenté : une heure qui ne se lit plus ne donne rien,
// plutôt qu'une durée fausse.
function startedAt(transcriptText: string): string | null {
  const first = jsonLines(transcriptText)[0];
  if (!first || first.type !== 'USER_INPUT' || typeof first.created_at !== 'string') return null;
  return Number.isNaN(Date.parse(first.created_at)) ? null : first.created_at;
}

/** Le début de session que le transcript révèle et que le fichier d'événements ne porte pas encore. */
export function sessionStart(base: Payload, eventsText: string, transcriptText: string): Payload[] {
  if (jsonLines(eventsText).some(evt => evt.hook_event_name === 'SessionStart')) return [];
  const at = startedAt(transcriptText);
  return at === null ? [] : [{ ...base, hook_event_name: 'SessionStart', started_at: at }];
}
