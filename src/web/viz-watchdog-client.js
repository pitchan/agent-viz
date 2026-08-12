// viz-watchdog-client.js — the browser side of the watchdog: a reader, not a
// detector.
//
// Detection and memory live on the server (lib/server/watchdog/): it sees
// every event whether or not a tab is open, and it writes what it sees to a
// journal that survives a reload, a restart and an acknowledgement. This
// module's whole job is the LIVE case — say what is wrong right now — so it
// takes the server's journal and keeps only what is still worth shouting
// about. The lasting record is read in the Conseils drawer, not here.
//
// Two sieves, not one, because GET /alerts answers two different questions:
//
//   * `alerts` is the MEMORY. The journal has no notion of liveness at all —
//     it hands back what was written down over the requested window.
//   * `activeIds` is what the server's detector still judges LIVE, and it is
//     the only thing that can say so. A standing alert (`stuck`) describes a
//     STATE, so it has no expiry: `isFresh` answers true for it for ever, by
//     design. Served from the journal alone, a session stuck yesterday would
//     shout until someone clicked it.
//
// So: an event-driven alert is judged by freshness, a standing alert by
// `activeIds`. Not the union of the two — `loop` and `retryStorm` declare no
// `isStale`, so their alert sits in the server's registry until it is
// acknowledged; taking membership as sufficient would keep the badge red on a
// loop that ended an hour ago, which is the exact thing the freshness rule
// exists to prevent.
//
// External alerts (the pricing vigil) do not come from the hook stream and
// carry no triggering event, hence no createdAt. They are current by
// construction and are kept in their own registry, out of both sieves.

import { isFresh } from './viz-alert-freshness.mjs';
// Les deux routes du journal des pannes sont décrites une seule fois, dans le
// client HTTP de l'Observatoire (constat C6). La pastille en garde la POLITIQUE
// — ne rien vider sur une lecture ratée, remettre l'alerte à l'écran sur un
// acquittement refusé — mais plus l'adresse ni la charge : c'est le contrat de
// route, pas le traitement d'erreur, que les deux pages portaient en double.
// La couture `_fetch` reste ici et voyage avec l'appel : le client la reçoit en
// paramètre, il ne la garde pas.
//
// L'alias n'est pas cosmétique : ce module exporte lui aussi un
// `acknowledgeAlert`, et c'est un geste différent — celui-ci retire l'alerte de
// l'écran d'abord, puis consigne ; celui de l'API ne fait que poster.
import { fetchAlerts, acknowledgeAlert as postAcknowledgement } from './observatory/api.js';

const listeners = new Set();
const externalAlerts = new Map();

// id → the most recent journal entry carrying that id. The journal's key is
// the PAIR (id, createdAt) and it legitimately holds several incidents under
// one id — the same tool looping twice in a day is two entries. The badge
// speaks about the present, so of those it keeps the latest; indexing by id
// and letting the last one written win would silence a live loop behind a
// finished one, because the journal answers newest-first.
let serverAlerts = new Map();
// What the server still judges live. Kept as a set of ids, never as alerts:
// the alert itself comes from the journal, with its `acknowledged` recomputed
// there, and a second copy would be a second truth for one fact.
let activeIds = new Set();

let _fetch = (...args) => fetch(...args);
let _now = () => Date.now();
// Has the journal been read once? The first read is the page catching up on a
// record that already existed, so nothing in it "just happened" — see the
// announce rule in refreshAlerts.
let firstRead = true;

// One incident, as the journal identifies it. Not the id alone: a new episode
// under the same id is a new incident and has to be announceable.
// A separator is indispensable, and it is the journal's own: glued together,
// ('a1', 2) and ('a', 12) both give 'a12'. NUL can appear neither in an id nor
// in a number, and ids already carry punctuation (loop:s1:Bash).
const keyOf = a => `${a.id}\u0000${a.createdAt}`;

function notify(newAlerts) {
  for (const fn of listeners) fn(newAlerts);
}

// Is this journal entry something the badge should be lit about right now?
// The alert declares which kind it is; nothing here sniffs its type.
function isLive(alert, now) {
  if (alert.standing) return activeIds.has(alert.id);
  return isFresh(alert, now);
}

function liveServerAlerts() {
  const now = _now();
  return [...serverAlerts.values()].filter(a => isLive(a, now));
}

export function getActiveAlerts() {
  const external = [...externalAlerts.values()].filter(a => !a.acknowledged);
  return [...liveServerAlerts(), ...external];
}

export async function refreshAlerts() {
  let payload;
  try {
    payload = await fetchAlerts({ days: 30 }, _fetch);
  } catch { return; }            // server gone, or not a 200: the badge simply stops moving
  // A read that failed is not evidence that all is well: leave the badge on
  // what it already knew rather than blanking it. A 200 whose body cannot be
  // parsed comes back as `null` — the shared client's contract — and counts as
  // a failed read, not as an empty journal.
  if (!payload) return;
  // Both fields are read defensively, and not out of ceremony: neither
  // `for...of` nor `new Set` tolerates a non-iterable, and nobody awaits this
  // promise. A malformed 200 would therefore reject into nothing and stop the
  // 30s refresh for good, without a word — the badge would go on showing
  // whatever it last knew, looking perfectly healthy.
  const journal = payload && Array.isArray(payload.alerts) ? payload.alerts : [];
  const live = payload && Array.isArray(payload.activeIds) ? payload.activeIds : [];
  const before = new Set(liveServerAlerts().map(keyOf));
  const next = new Map();
  for (const a of journal) {
    if (!a || !a.id || a.acknowledged) continue;
    const held = next.get(a.id);
    if (!held || a.createdAt > held.createdAt) next.set(a.id, a);
  }
  serverAlerts = next;
  activeIds = new Set(live);
  const after = liveServerAlerts();
  // Only what the display would show gets announced, and only the first time.
  // This signal is what fires the desktop notification, and this function runs
  // on a timer: announcing the whole live set every poll would ring once per
  // alert per poll for as long as the tab stays open. External alerts are
  // excluded by construction — they never come back from the journal.
  //
  // And nothing at all is announced on the FIRST read. `before` is empty then,
  // so every live alert would read as new: a session that has been stuck for
  // twenty minutes would ring a desktop notification on every page reload.
  // The notification is for what HAPPENS while the user is looking elsewhere;
  // for someone who has just opened the page, the red badge is the right
  // amount of noise, and it still lights up below.
  const raised = firstRead ? [] : after.filter(a => !before.has(keyOf(a)));
  firstRead = false;
  // A refresh can also WITHDRAW — an alert acknowledged from another tab, or a
  // standing one the server has stopped counting. That change carries no alert
  // at all, so notifying on `raised` alone would leave a retracted alert on the
  // badge until something else happened to move. This second member is the ONLY
  // path that turns the badge off.
  if (raised.length || after.length !== before.size) notify(raised);
}

// Pushed by the SSE stream the moment the server records something, so the
// badge does not wait for the next poll.
export function applyServerAlert(alert) {
  if (!alert || !alert.id) return;
  const held = serverAlerts.get(alert.id);
  // Same rule as the refresh: of two incidents sharing an id, the latest one
  // is the one that speaks. A live stream can carry an alert built from an old
  // event, and it must not push the current incident off the badge.
  if (held && held.createdAt > alert.createdAt) return;
  serverAlerts.set(alert.id, alert);
  // The server would not be broadcasting it if it had not just recorded it, so
  // this IS the liveness signal — the one thing the journal cannot give. Wait
  // for the next GET /alerts to supply it and a `stuck` pushed here would stay
  // invisible for up to thirty seconds, which is the delay this path exists to
  // remove.
  activeIds.add(alert.id);
  notify(isLive(alert, _now()) ? [alert] : []);
}

export function raiseExternalAlert(alert) {
  const existing = externalAlerts.get(alert.id);
  if (existing && !existing.acknowledged) return;
  const fresh = { ...alert, acknowledged: false };
  externalAlerts.set(alert.id, fresh);
  notify([fresh]);
}

// createdAt is half the identity of an incident: the same id at another time
// is another incident, and acknowledging one must not silence the next.
//
// The user acknowledges WHAT THEY SAW, so `createdAt` — the caller naming the
// incident it rendered — is what goes on the wire. This is not pedantry about
// an unused parameter. A newer incident under the same id can land between the
// render and the click; sending what we now HOLD would acknowledge the one
// nobody has read, and leave the one they were looking at unacknowledged in the
// journal — visible for ever in the lasting record. A divergence between the
// two is therefore normal and WANTED, not a mismatch to reconcile: the newer
// incident has not been seen, so it stays on the badge. Do not "simplify" this
// to `held.createdAt`.
//
// The fallback is not ceremony either: the panel rebuilds this value from a DOM
// attribute, where a missing one reads as `Number('')` — which is 0, not NaN,
// and 0 is a well-formed key. The route validates the SHAPE of a key, never its
// existence: a well-formed pair matching nothing writes a permanent line that
// acknowledges nothing, and acknowledgements are not deduplicated the way
// alerts are. Hence also the guard below — we never post an id we were not
// served.
export async function acknowledgeAlert(id, createdAt) {
  const external = externalAlerts.get(id);
  if (external) { external.acknowledged = true; notify([]); return; }
  const held = serverAlerts.get(id);
  if (!held) return;
  const when = Number.isFinite(createdAt) ? createdAt : held.createdAt;
  // Is the incident being acknowledged the one we are holding? When it is not,
  // there is nothing of it left on the badge to take off — and what IS on the
  // badge must stay, being precisely the incident nobody has read yet.
  const onScreen = when === held.createdAt;
  const wasActive = activeIds.has(id);
  if (onScreen) {
    serverAlerts.delete(id);
    activeIds.delete(id);
    notify([]);
  }
  let recorded = false;
  try {
    await postAcknowledgement({ id, createdAt: when }, _fetch);
    recorded = true;
  } catch { recorded = false; }  // refus du serveur ou coupure : non consigné
  if (recorded || !onScreen) return;
  // 400 on a malformed key, 503 while the port is served but the watchdog is
  // not built yet — a real window. Nothing was written down, so the alert is
  // coming back at the next reload: showing it again now is the difference
  // between a visible refusal and the silent failure this whole chantier
  // repairs.
  serverAlerts.set(id, held);
  if (wasActive) activeIds.add(id);
  notify([]);
}

// Subscribe to changes in the active-alert set. Returns the unsubscribe
// function. The callback receives the alerts that are *new* this round —
// possibly none, when the change was a withdrawal. Render from
// getActiveAlerts(); use the argument only to decide what deserves a desktop
// notification. Named for the change, not the arrival: a listener that assumed
// a non-empty array is exactly the bug this signal exists to prevent.
export function onAlertsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function initAlertReader({ fetchImpl, now } = {}) {
  if (fetchImpl) _fetch = fetchImpl;
  if (now) _now = now;
  await refreshAlerts();
}
