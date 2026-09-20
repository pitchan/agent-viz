// External alerts (pricing drift vigil): same dedup/ack contract as watchdog
// alerts, exercised through the public client API. Ids are unique per test —
// the module holds shared state.
import { expect, test } from 'vitest';
import {
  raiseExternalAlert, getActiveAlerts, acknowledgeAlert, onAlertsChanged,
} from '../../src/web/viz-watchdog-client.ts';
import { pricingDriftAlert } from '../../src/web/viz-pricing-drift-alert.ts';

const drift = (model: string) => pricingDriftAlert({ model, kind: 'tarif-different' }, 1);

test('a raised external alert becomes active and notifies listeners', () => {
  const seen = [];
  const off = onAlertsChanged(a => seen.push(...a));
  raiseExternalAlert(drift('a'));
  off();
  expect(seen.length).toBe(1);
  expect(getActiveAlerts().some(a => a.id === 'pricingDrift:a')).toBeTruthy();
});

test('the same id does not fire twice while active', () => {
  raiseExternalAlert(drift('b'));
  const seen = [];
  const off = onAlertsChanged(a => seen.push(...a));
  raiseExternalAlert(drift('b'));
  off();
  expect(seen.length).toBe(0);
  expect(getActiveAlerts().filter(a => a.id === 'pricingDrift:b').length).toBe(1);
});

test('acknowledged disappears; a fresh raise after ack fires again', () => {
  raiseExternalAlert(drift('c'));
  acknowledgeAlert('pricingDrift:c', NaN);
  expect(!getActiveAlerts().some(a => a.id === 'pricingDrift:c')).toBeTruthy();
  raiseExternalAlert(drift('c'));
  expect(getActiveAlerts().some(a => a.id === 'pricingDrift:c')).toBeTruthy();
});
