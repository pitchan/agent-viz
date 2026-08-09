// api.js — the observatory's HTTP client. Its only job is to talk to the
// server and turn a failure into a readable error; it holds no state and
// formats nothing.

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // The server sends the exact cause (missing engine, unknown session): show
    // it rather than a generic "an error occurred".
    throw new Error(body && body.error ? body.error : `${res.status} sur ${url}`);
  }
  return body;
}

async function postJson(url, body) {
  const opts = body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(url, opts);
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(payload && payload.error ? payload.error : `${res.status} sur ${url}`);
  return payload;
}

// The 7/30/90 window and the human/machine toggle, shared by every windowed
// call below — the server clamps and defaults the window on its own.
const windowParams = ({ days, includeMachine } = {}) => {
  const params = new URLSearchParams();
  if (days) params.set('days', String(days));
  if (includeMachine) params.set('includeMachine', '1');
  return params;
};

export function fetchSummary(opts = {}) {
  const q = windowParams(opts).toString();
  return getJson(`/analysis/summary${q ? `?${q}` : ''}`);
}

export function fetchSessions({ project, days, includeMachine } = {}) {
  const params = windowParams({ days, includeMachine });
  if (project) params.set('project', project);
  const q = params.toString();
  return getJson(`/analysis/sessions${q ? `?${q}` : ''}`);
}

export const fetchSession = id => getJson(`/analysis/session/${encodeURIComponent(id)}`);

export function requestScan(opts = {}) {
  const q = windowParams(opts).toString();
  return postJson(`/analysis/scan${q ? `?${q}` : ''}`);
}

export function requestPurge(opts = {}) {
  const q = windowParams(opts).toString();
  return postJson(`/analysis/purge${q ? `?${q}` : ''}`);
}

export const fetchConfigAudit = () => getJson('/config/audit');
export const fetchRecommendations = () => getJson('/recommendations');
export const setRecommendationStatus = (id, status) =>
  postJson(`/recommendations/${encodeURIComponent(id)}?status=${encodeURIComponent(status)}`);

export function fetchModelCosts(opts = {}) {
  const q = windowParams(opts).toString();
  return getJson(`/analysis/models${q ? `?${q}` : ''}`);
}

export const fetchPricing = () => getJson('/pricing');

// Le journal des pannes. Meme fenetre que les conseils : la page n'a qu'une
// seule notion de periode, et le serveur retombe seul sur son defaut hors de la
// table 7/30/90.
export function fetchAlerts(opts = {}) {
  const q = windowParams(opts).toString();
  return getJson(`/alerts${q ? `?${q}` : ''}`);
}

// L'acquittement d'UNE alerte du journal. La route est unitaire et validante
// (id chaine non vide, createdAt en millisecondes epoch) : le groupe s'acquitte
// en serie cote appelant, jamais par une route de lot qui n'existe pas.
export const acknowledgeAlert = ({ id, createdAt }) => postJson('/alerts/ack', { id, createdAt });
