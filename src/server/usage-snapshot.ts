// Applique à une session les jetons d'un agent qui les tient hors du transcript, dans un
// fichier relu en entier (Antigravity). Le chemin de Claude, lu ligne à ligne, ne passe pas ici.

import { accumulateUsage } from './tokens.ts';
import type { UsageSnapshotSource } from './transcript-adapters/types.ts';

interface SnapshotTokens {
  main: unknown;
  unsupported?: boolean;
}

interface SnapshotState {
  stamp: string | null;
  reported: Set<string>;
}

// L'état de relecture vit hors de l'enregistrement de session : il disparaît avec lui.
const states = new WeakMap<object, SnapshotState>();

function stateOf(tokens: object): SnapshotState {
  let state = states.get(tokens);
  if (!state) {
    state = { stamp: null, reported: new Set() };
    states.set(tokens, state);
  }
  return state;
}

function reportOnce(state: SnapshotState, sessionId: string, message: string, log: (line: string) => void): void {
  if (state.reported.has(message)) return;
  state.reported.add(message);
  log(`[tokens] ${sessionId.slice(0, 8)}: ${message}`);
}

/** Rend `true` quand l'état des jetons a changé et doit être diffusé. */
export function applyUsageSnapshot(
  sessionId: string,
  tokens: SnapshotTokens,
  source: UsageSnapshotSource,
  transcriptPath: string,
  log: (line: string) => void = console.error,
): boolean {
  // Un format refusé une fois le reste : des chiffres qui reviendraient ensuite ne seraient pas fiables.
  if (tokens.unsupported) return false;
  const state = stateOf(tokens);
  const stamp = source.stamp(transcriptPath);
  if (stamp === null || stamp === state.stamp) return false;

  let snapshot;
  try {
    snapshot = source.read(transcriptPath);
  } catch (err: unknown) {
    // Base occupée ou copie interrompue : l'empreinte n'est pas retenue, l'événement suivant réessaie.
    reportOnce(state, sessionId, `usage snapshot unreadable — ${err instanceof Error ? err.message : String(err)}`, log);
    return false;
  }
  state.stamp = stamp;
  if (!snapshot.ok) {
    tokens.unsupported = true;
    reportOnce(state, sessionId, `usage snapshot rejected — ${snapshot.reason}`, log);
    return true;
  }
  // `accumulateUsage` dédoublonne par identifiant d'appel : relire toutes les lignes est sans effet.
  for (const call of snapshot.calls) accumulateUsage(tokens.main, call.usage, call.model, call.id, null);
  return snapshot.calls.length > 0;
}
