// api.ts — the observatory's HTTP client. Its only job is to talk to the
// server and turn a failure into a readable error; it holds no state and
// formats nothing.

import type { Alert } from '../../engine/watchdog/detector.ts';
import { readAlertsPayload } from '../viz-alert-shape.ts';

// `fetchImpl` n'est pas une commodité de test : la pastille de la page viz
// appelle deux de ces routes avec SA propre couture (`initAlertReader`), et le
// module ne doit pas dépendre en dur du `fetch` global pour autant (CLAUDE.md
// § D). Seules les deux routes du journal des pannes la propagent — les autres
// n'ont qu'un appelant, leur en donner une serait de la surface morte.
async function getJson(url: string, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // The server sends the exact cause (unknown session, service failure): show
    // it rather than a generic "an error occurred".
    throw new Error(body && body.error ? body.error : `${res.status} sur ${url}`);
  }
  return body;
}

async function postJson(url: string, body?: unknown, fetchImpl: typeof fetch = fetch) {
  const opts = body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetchImpl(url, opts);
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(payload && payload.error ? payload.error : `${res.status} sur ${url}`);
  return payload;
}

// La fenêtre 7/30/90 et le bascule humain/machine, partagées par chaque appel
// fenêtré ci-dessous — le serveur borne et défaut la fenêtre de son côté.
export interface WindowOpts {
  days?: number;
  includeMachine?: boolean;
}

const windowParams = ({ days, includeMachine }: WindowOpts = {}) => {
  const params = new URLSearchParams();
  if (days) params.set('days', String(days));
  if (includeMachine) params.set('includeMachine', '1');
  return params;
};

export function fetchSummary(opts: WindowOpts = {}) {
  const q = windowParams(opts).toString();
  return getJson(`/analysis/summary${q ? `?${q}` : ''}`);
}

export function fetchSessions({ project, days, includeMachine }: WindowOpts & { project?: string } = {}) {
  const params = windowParams({ days, includeMachine });
  if (project) params.set('project', project);
  const q = params.toString();
  return getJson(`/analysis/sessions${q ? `?${q}` : ''}`);
}

export const fetchSession = (id: string) => getJson(`/analysis/session/${encodeURIComponent(id)}`);

export function requestScan(opts: WindowOpts = {}) {
  const q = windowParams(opts).toString();
  return postJson(`/analysis/scan${q ? `?${q}` : ''}`);
}

export function requestPurge(opts: WindowOpts = {}) {
  const q = windowParams(opts).toString();
  return postJson(`/analysis/purge${q ? `?${q}` : ''}`);
}

export const fetchConfigAudit = () => getJson('/config/audit');
export const fetchRecommendations = () => getJson('/recommendations');
// La raison n'accompagne qu'un arbitrage (doc/42) ; absente, l'URL reste
// celle des statuts historiques.
// `id` est l'identifiant numerique d'une recommandation (voir decisions-view.ts et
// le Number(...) de advisor-view.ts, seul autre appelant reel).
export const setRecommendationStatus = (id: number, status: string, reason?: string) =>
  postJson(`/recommendations/${encodeURIComponent(id)}?status=${encodeURIComponent(status)}`
    + (reason ? `&reason=${encodeURIComponent(reason)}` : ''));

export function fetchModelCosts(opts: WindowOpts = {}) {
  const q = windowParams(opts).toString();
  return getJson(`/analysis/models${q ? `?${q}` : ''}`);
}

export const fetchPricing = () => getJson('/pricing');

// Le journal des pannes. Meme fenetre que les conseils : la page n'a qu'une
// seule notion de periode, et le serveur retombe seul sur son defaut hors de la
// table 7/30/90.
//
// Une reponse hors forme est une erreur lisible, comme une panne du serveur ;
// une ligne hors forme est ecartee et comptee dans `rejetees`.
export async function fetchAlerts(opts: WindowOpts = {}, fetchImpl: typeof fetch = fetch)
  : Promise<{ alerts: Alert[]; rejetees: number; activeIds: string[] }> {
  const q = windowParams(opts).toString();
  return readAlertsPayload(await getJson(`/alerts${q ? `?${q}` : ''}`, fetchImpl));
}

// L'acquittement d'UNE alerte du journal. La route est unitaire et validante
// (id chaine non vide, createdAt en millisecondes epoch) : le groupe s'acquitte
// en serie cote appelant, jamais par une route de lot qui n'existe pas.
export const acknowledgeAlert = ({ id, createdAt }: { id: string; createdAt: number }, fetchImpl: typeof fetch = fetch) =>
  postJson('/alerts/ack', { id, createdAt }, fetchImpl);
