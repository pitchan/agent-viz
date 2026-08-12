// External alerts (pricing drift vigil): same dedup/ack contract as watchdog
// alerts, exercised through the public client API. Ids are unique per test —
// the module holds shared state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  raiseExternalAlert, getActiveAlerts, acknowledgeAlert, onAlertsChanged,
} from '../../src/web/viz-watchdog-client.js';

const drift = id => ({
  id, type: 'pricingDrift', sessionId: '', toolName: 'claude-test-x',
  count: 1, createdAt: 1, message: 'Vigie tarifaire : test',
});

test('a raised external alert becomes active and notifies listeners', () => {
  const seen = [];
  const off = onAlertsChanged(a => seen.push(...a));
  raiseExternalAlert(drift('pricingDrift:a'));
  off();
  assert.equal(seen.length, 1);
  assert.ok(getActiveAlerts().some(a => a.id === 'pricingDrift:a'));
});

test('the same id does not fire twice while active', () => {
  raiseExternalAlert(drift('pricingDrift:b'));
  const seen = [];
  const off = onAlertsChanged(a => seen.push(...a));
  raiseExternalAlert(drift('pricingDrift:b'));
  off();
  assert.equal(seen.length, 0);
  assert.equal(getActiveAlerts().filter(a => a.id === 'pricingDrift:b').length, 1);
});

test('acknowledged disappears; a fresh raise after ack fires again', () => {
  raiseExternalAlert(drift('pricingDrift:c'));
  acknowledgeAlert('pricingDrift:c');
  assert.ok(!getActiveAlerts().some(a => a.id === 'pricingDrift:c'));
  raiseExternalAlert(drift('pricingDrift:c'));
  assert.ok(getActiveAlerts().some(a => a.id === 'pricingDrift:c'));
});
