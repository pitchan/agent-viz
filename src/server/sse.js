'use strict';
// SSE clients registry + broadcast helpers.

const sseClients = new Set();

function broadcastSSE(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}

// Debounced "sessions list changed" broadcast. Collapses bursts of new-file /
// mtime-updated notifications into one client refresh.
let _sessionsChangedTimer = null;
function broadcastSessionsChanged() {
  if (_sessionsChangedTimer) return;
  _sessionsChangedTimer = setTimeout(() => {
    _sessionsChangedTimer = null;
    broadcastSSE({ type: 'sessionsChanged' });
  }, 2000);
}

module.exports = { sseClients, broadcastSSE, broadcastSessionsChanged };
