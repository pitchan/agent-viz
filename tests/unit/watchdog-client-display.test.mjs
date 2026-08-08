// Where the freshness rule actually meets the user: the browser client.
//
// The watchdog no longer refuses to see the past, so the client is now the
// only thing standing between an hour-old incident and a desktop toast. Two
// halves, and both are needed: getActiveAlerts decides what the pill and the
// panel SHOW, feedEvent decides what gets ANNOUNCED. Filtering one and not
// the other would either leave the panel shouting about last hour or let the
// OS notification fire for a replay nobody asked about.
//
// Ids and sessions are unique per test — the module holds shared state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  feedEvent, getActiveAlerts, raiseExternalAlert, onAlertsChanged,
} from '../../public/viz-watchdog-client.js';

// Real wall clock: this module reads Date.now() directly, and that is the
// point — the injected clock is the pure module's affair, not the client's.
const pre = (session, at, id) => ({
  session_id: session, hook_event_name: 'PreToolUse',
  tool_name: 'Bash', tool_input: { command: 'npm run build' },
  tool_use_id: id, cwd: 'f:\\p', _ts: new Date(at).toISOString(),
});

test('une boucle d il y a une heure est consignee, mais elle ne reveille personne', () => {
  const seen = [];
  const off = onAlertsChanged(a => seen.push(...a));
  const base = Date.now() - 60 * 60_000;
  for (let i = 0; i < 4; i++) feedEvent(pre('sess-old', base + i * 1_000, `o${i}`));
  off();
  assert.deepEqual(seen, [],
    'rien ne doit sonner — la notification bureau part de ce signal');
  assert.deepEqual(getActiveAlerts().filter(a => a.sessionId === 'sess-old'), [],
    'et le panneau ne montre pas ce qui est fini depuis une heure');
});

test('une boucle de l instant allume la pastille et previent', () => {
  const seen = [];
  const off = onAlertsChanged(a => seen.push(...a));
  const base = Date.now() - 3_000;
  for (let i = 0; i < 4; i++) feedEvent(pre('sess-live', base + i * 500, `n${i}`));
  off();
  assert.equal(seen.length, 1, 'controle positif : le direct passe toujours');
  assert.equal(seen[0].type, 'loop');
  assert.equal(getActiveAlerts().filter(a => a.sessionId === 'sess-live').length, 1);
});

test('une alerte externe n est jamais soumise au tamis', () => {
  // La vigie tarifaire ne vient pas du flux d evenements. Selon l appelant
  // elle porte l heure de sa levee ou rien du tout ; dans les deux cas la
  // fraicheur n est pas sa regle, et la passer au tamis la ferait disparaitre.
  raiseExternalAlert({
    id: 'pricingDrift:ancienne', type: 'pricingDrift', sessionId: '', toolName: 'm1',
    count: 1, createdAt: 1, message: 'Vigie tarifaire : test', occurrences: [], tools: [],
  });
  raiseExternalAlert({
    id: 'pricingDrift:sans-heure', type: 'pricingDrift', sessionId: '', toolName: 'm2',
    count: 1, message: 'Vigie tarifaire : test', occurrences: [], tools: [],
  });
  const ids = getActiveAlerts().map(a => a.id);
  assert.ok(ids.includes('pricingDrift:ancienne'), 'un horodatage ancien ne l elimine pas');
  assert.ok(ids.includes('pricingDrift:sans-heure'), 'une absence d horodatage non plus');
});
