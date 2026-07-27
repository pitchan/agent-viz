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

async function postJson(url) {
  const res = await fetch(url, { method: 'POST' });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body && body.error ? body.error : `${res.status} sur ${url}`);
  return body;
}

export const fetchSummary = () => getJson('/analysis/summary');

export function fetchSessions({ project, since } = {}) {
  const params = new URLSearchParams();
  if (project) params.set('project', project);
  if (since) params.set('since', since);
  const query = params.toString();
  return getJson(`/analysis/sessions${query ? `?${query}` : ''}`);
}

export const fetchSession = id => getJson(`/analysis/session/${encodeURIComponent(id)}`);
export const requestScan = () => postJson('/analysis/scan');
export const fetchConfigAudit = () => getJson('/config/audit');
export const fetchRecommendations = () => getJson('/recommendations');
export const setRecommendationStatus = (id, status) =>
  postJson(`/recommendations/${encodeURIComponent(id)}?status=${encodeURIComponent(status)}`);
