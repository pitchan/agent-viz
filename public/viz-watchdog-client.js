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
    const res = await _fetch('/alerts?days=30');
    // A read that failed is not evidence that all is well: leave the badge on
    // what it already knew rather than blanking it.
    if (!res || !res.ok) return;
    payload = await res.json();
  } catch { return; }            // server gone: the badge simply stops moving
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
  const raised = after.filter(a => !before.has(keyOf(a)));
  // A refresh can also WITHDRAW — an alert acknowledged from another tab, or
  // one the server no longer counts. Notifying on new alerts only would leave
  // a retracted alert on the badge until something else moved.
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
// The pair that goes on the wire is the one the JOURNAL gave us, not the one
// the caller rebuilt — the panel reads it back off a DOM attribute, where a
// missing value reads as `Number('')`, which is 0 and not NaN. The route
// validates the SHAPE of a key, never its existence: a well-formed pair that
// matches nothing writes a permanent line acknowledging nothing, and
// acknowledgements are not deduplicated the way alerts are. Hence also the
// guard below: we never post an id we were not served.
export async function acknowledgeAlert(id, createdAt) {
  const external = externalAlerts.get(id);
  if (external) { external.acknowledged = true; notify([]); return; }
  const held = serverAlerts.get(id);
  if (!held) return;
  const wasActive = activeIds.has(id);
  serverAlerts.delete(id);
  activeIds.delete(id);
  notify([]);
  let recorded = false;
  try {
    const res = await _fetch('/alerts/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, createdAt: held.createdAt }),
    });
    recorded = !!res && !!res.ok;
  } catch { recorded = false; }
  if (recorded) return;
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
