// External alerts (pricing drift vigil): same dedup/ack contract as watchdog
// alerts, exercised through the public client API. Ids are unique per test —
// the module holds shared state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  raiseExternalAlert, getActiveAlerts, acknowledgeAlert, onAlertsChanged,
} from '../../src/web/viz-watchdog-client.ts';
import { pricingDriftAlert } from '../../src/web/viz-pricing-drift-alert.ts';

const drift = model => pricingDriftAlert({ model, kind: 'tarif-different' }, 1);

test('a raised external alert becomes active and notifies listeners', () => {
  const seen = [];
  const off = onAlertsChanged(a => seen.push(...a));
  raiseExternalAlert(drift('a'));
  off();
  assert.equal(seen.length, 1);
  assert.ok(getActiveAlerts().some(a => a.id === 'pricingDrift:a'));
});

test('the same id does not fire twice while active', () => {
  raiseExternalAlert(drift('b'));
  const seen = [];
  const off = onAlertsChanged(a => seen.push(...a));
  raiseExternalAlert(drift('b'));
  off();
  assert.equal(seen.length, 0);
  assert.equal(getActiveAlerts().filter(a => a.id === 'pricingDrift:b').length, 1);
});

test('acknowledged disappears; a fresh raise after ack fires again', () => {
  raiseExternalAlert(drift('c'));
  acknowledgeAlert('pricingDrift:c');
  assert.ok(!getActiveAlerts().some(a => a.id === 'pricingDrift:c'));
  raiseExternalAlert(drift('c'));
  assert.ok(getActiveAlerts().some(a => a.id === 'pricingDrift:c'));
});
