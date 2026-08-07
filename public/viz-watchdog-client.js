// viz-watchdog-client.js — browser-side orchestration around viz-watchdog.mjs.
//
// Owns the single watchdog instance, the wall-clock tick loop, and an
// observer registry. Stays narrow on purpose: detection logic lives in
// viz-watchdog.mjs (pure, testable, server-portable), DOM rendering and
// Notification API calls live in viz-ui.js, and the SSE pipeline (viz-layout
// → viz-network) just forwards events into here.

import { createWatchdog } from './viz-watchdog.mjs';

const TICK_MS = 5_000;

// Whether events would currently reach us. Owned here and pushed in by the
// transport (viz-network) rather than read from it, so this module keeps
// knowing nothing about EventSource, fetch or the Page Visibility API.
let observing = true;
export function setObserving(v) { observing = !!v; }

const watchdog = createWatchdog({ canObserve: () => observing });
const listeners = new Set();
let tickTimer = null;

// External alerts — server-side detections (e.g. the pricing drift vigil).
// Same shape and same dedup/ack contract as watchdog alerts, kept in their
// own registry because they do not come from the hook event stream.
const externalAlerts = new Map();

function notify(newAlerts) {
  for (const fn of listeners) fn(newAlerts);
}

function activeCount() {
  return watchdog.getActiveAlerts().length + [...externalAlerts.values()].filter(a => !a.acknowledged).length;
}

function ensureTicker() {
  if (tickTimer != null) return;
  tickTimer = setInterval(() => {
    // A tick can *withdraw* an alert as well as raise one — a stuck session
    // that came back, or one that went past the point of being worth
    // reporting. Notifying only on new alerts would leave a retracted alert
    // on the badge for as long as the tab stays open.
    const before = activeCount();
    const { newAlerts } = watchdog.tick();
    if (newAlerts.length || activeCount() !== before) notify(newAlerts);
  }, TICK_MS);
  // Node exposes .unref() on the timer handle — call it so unit tests that
  // transitively import this module don't hang waiting for the interval.
  // No-op in browsers (handle is a plain number there).
  if (tickTimer && typeof tickTimer.unref === 'function') tickTimer.unref();
}

export function feedEvent(evt) {
  ensureTicker();
  const { newAlerts } = watchdog.processEvent(evt);
  if (newAlerts.length) notify(newAlerts);
}

export function raiseExternalAlert(alert) {
  const existing = externalAlerts.get(alert.id);
  if (existing && !existing.acknowledged) return;
  const fresh = { ...alert, acknowledged: false };
  externalAlerts.set(alert.id, fresh);
  notify([fresh]);
}

export function getActiveAlerts() {
  const external = [...externalAlerts.values()].filter(a => !a.acknowledged);
  return [...watchdog.getActiveAlerts(), ...external];
}

export function acknowledgeAlert(id) {
  watchdog.acknowledge(id);
  const external = externalAlerts.get(id);
  if (external) external.acknowledged = true;
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
