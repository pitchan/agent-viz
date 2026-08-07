// Once failures are visible, the documented worst case — an agent re-running
// the same failing command — satisfies BOTH detectors: loop (same input, four
// times) and retryStorm (three failures in a row). Two badges for one incident
// is exactly the alert fatigue this product exists to avoid.
//
// The fix is not precedence, it is disjointness. Repeating the SAME failing
// call is loop's subject, and loop says it better: it names the command and
// counts the repeats. So retryStorm stops counting a failure that repeats the
// previous one, and keeps only what loop cannot see — a run of DIFFERENT calls
// all failing.
//
// Precedence could not have worked: retryStorm's threshold is reached first,
// so by the time loop fires there is nothing left to suppress.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWatchdog } from '../../public/viz-watchdog.mjs';

const T = 1_700_000_000_000;
const SID = 'sess-1';

const pre = (i, ts, cmd) => ({
  hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Bash',
  tool_use_id: `t${i}`, tool_input: { command: cmd }, cwd: 'f:\\p',
  _ts: new Date(ts).toISOString(),
});
const fail = (i, ts, tool = 'Bash', id = `t${i}`) => ({
  hook_event_name: 'PostToolUseFailure', session_id: SID, tool_name: tool,
  tool_use_id: id, cwd: 'f:\\p', _ts: new Date(ts).toISOString(),
});

test('la meme commande qui echoue en boucle ne leve qu une alerte', () => {
  const wd = createWatchdog({ now: () => T + 60_000 });
  const raised = [];
  for (let i = 1; i <= 5; i++) {
    raised.push(...wd.processEvent(pre(i, T + i * 1000, 'npm run build')).newAlerts);
    raised.push(...wd.processEvent(fail(i, T + i * 1000 + 500)).newAlerts);
  }
  assert.deepEqual(raised.map(a => a.type), ['loop'],
    'repeter le meme echec est le sujet de loop, pas de retryStorm');
});

test('des commandes DIFFERENTES qui echouent d affilee restent le domaine de retryStorm', () => {
  const wd = createWatchdog({ now: () => T + 60_000 });
  const raised = [];
  for (let i = 1; i <= 3; i++) {
    raised.push(...wd.processEvent(pre(i, T + i * 1000, `commande-${i}`)).newAlerts);
    raised.push(...wd.processEvent(fail(i, T + i * 1000 + 500)).newAlerts);
  }
  assert.deepEqual(raised.map(a => a.type), ['retryStorm']);
});

test('deux echecs identiques encadrant un troisieme different comptent pour deux', () => {
  const wd = createWatchdog({ now: () => T + 60_000 });
  const raised = [];
  const cmds = ['a', 'a', 'b', 'a'];   // a, a(repetition ignoree), b, a
  cmds.forEach((c, i) => {
    wd.processEvent(pre(i, T + i * 1000, c));
    raised.push(...wd.processEvent(fail(i, T + i * 1000 + 500)).newAlerts);
  });
  assert.deepEqual(raised.map(a => a.type), ['retryStorm'],
    'a, b, a = trois echecs distincts consecutifs');
});

test('une signature inconnue n est jamais tenue pour une repetition', () => {
  const wd = createWatchdog({ now: () => T + 60_000 });
  const raised = [];
  // Aucun PreToolUse : le detecteur ne peut pas savoir ce que ces appels
  // etaient. Il ne doit pas en conclure qu'ils se repetent.
  for (let i = 10; i <= 12; i++) {
    raised.push(...wd.processEvent(fail(i, T + i * 1000, 'Read', `r${i}`)).newAlerts);
  }
  assert.deepEqual(raised.map(a => a.type), ['retryStorm']);
});

test('trois interruptions humaines ne sont pas un orage d echecs', () => {
  const wd = createWatchdog({ now: () => T + 60_000 });
  const raised = [];
  for (let i = 1; i <= 4; i++) {
    wd.processEvent(pre(i, T + i * 1000, `commande-${i}`));
    raised.push(...wd.processEvent({ ...fail(i, T + i * 1000 + 500), is_interrupt: true }).newAlerts);
  }
  assert.deepEqual(raised, [],
    'reprendre la main quatre fois n est pas quatre pannes');
});

test('un succes remet le compteur ET la memoire du dernier echec a zero', () => {
  const wd = createWatchdog({ now: () => T + 60_000 });
  wd.processEvent(pre(1, T + 1000, 'a'));
  wd.processEvent(fail(1, T + 1500));
  wd.processEvent({ hook_event_name: 'PostToolUse', session_id: SID, tool_name: 'Bash',
    tool_use_id: 'ok', cwd: 'f:\\p', _ts: new Date(T + 2000).toISOString() });
  const raised = [];
  for (let i = 2; i <= 4; i++) {
    wd.processEvent(pre(i, T + i * 1000, `x${i}`));
    raised.push(...wd.processEvent(fail(i, T + i * 1000 + 500)).newAlerts);
  }
  assert.deepEqual(raised.map(a => a.type), ['retryStorm'],
    'il faut trois nouveaux echecs apres le succes, pas deux');
});
