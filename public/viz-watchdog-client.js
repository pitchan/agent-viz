// viz-watchdog-client.js — browser-side orchestration around viz-watchdog.mjs.
//
// Owns the single watchdog instance, the wall-clock tick loop, and an
// observer registry. Stays narrow on purpose: detection logic lives in
// viz-watchdog.mjs (pure, testable, server-portable), DOM rendering and
// Notification API calls live in viz-ui.js, and the SSE pipeline (viz-layout
// → viz-network) just forwards events into here.

import { createWatchdog } from './viz-watchdog.mjs';

const TICK_MS = 5_000;

const watchdog = createWatchdog();
const listeners = new Set();
let tickTimer = null;

function notify(newAlerts) {
  if (!newAlerts.length) return;
  for (const fn of listeners) fn(newAlerts);
}

function ensureTicker() {
  if (tickTimer != null) return;
  tickTimer = setInterval(() => {
    notify(watchdog.tick().newAlerts);
  }, TICK_MS);
  // Node exposes .unref() on the timer handle — call it so unit tests that
  // transitively import this module don't hang waiting for the interval.
  // No-op in browsers (handle is a plain number there).
  if (tickTimer && typeof tickTimer.unref === 'function') tickTimer.unref();
}

export function feedEvent(evt) {
  ensureTicker();
  notify(watchdog.processEvent(evt).newAlerts);
}

export function getActiveAlerts() {
  return watchdog.getActiveAlerts();
}

export function acknowledgeAlert(id) {
  watchdog.acknowledge(id);
}

// Subscribe to new-alert notifications. Returns the unsubscribe function.
// Callers are responsible for handling DOM updates and OS-level notifications.
export function onNewAlerts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
