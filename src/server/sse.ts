'use strict';
// SSE clients registry + broadcast helpers.

// Ce que ce module attend d'un client : pouvoir lui écrire une trame — jamais
// le reste de `http.ServerResponse`, que ce fichier n'utilise pas. Les
// appelants (routes.ts, hors lot) y déposent de vraies réponses HTTP, qui
// satisfont cette forme structurellement.
interface SseClient {
  write(chunk: string): unknown;
}

const sseClients = new Set<SseClient>();

// `data` voyage vers `JSON.stringify` seul — aucun champ n'est lu ici, donc
// aucune forme à imposer aux appelants (tokens.ts, pricing.ts, l'observatoire,
// hors lot pour la racine) au-delà de la sérialisabilité JSON.
function broadcastSSE(data: unknown): void {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}

// Debounced "sessions list changed" broadcast. Collapses bursts of new-file /
// mtime-updated notifications into one client refresh.
let _sessionsChangedTimer: NodeJS.Timeout | null = null;
function broadcastSessionsChanged(): void {
  if (_sessionsChangedTimer) return;
  _sessionsChangedTimer = setTimeout(() => {
    _sessionsChangedTimer = null;
    broadcastSSE({ type: 'sessionsChanged' });
  }, 2000);
}

export { sseClients, broadcastSSE, broadcastSessionsChanged };
export type { SseClient };
