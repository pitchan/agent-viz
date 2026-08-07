// The point of this file: "it repeated itself" and "it repeated a failure"
// are not the same alert. The second is the documented worst case — an agent
// re-running a command that keeps failing — and it is the one worth waking
// someone for. The detector can only say it if it remembers how each call
// ended, so that is what these tests pin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWatchdog } from '../../public/viz-watchdog.mjs';

const T = 1_700_000_000_000;
const SID = 'sess-1';

function pre(i, ts) {
  return {
    hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Bash',
    tool_use_id: `t${i}`, tool_input: { command: 'npm run build' },
    cwd: 'f:\\DEV\\projet', _ts: new Date(ts).toISOString(),
  };
}
function post(i, ts, failed) {
  return {
    hook_event_name: failed ? 'PostToolUseFailure' : 'PostToolUse',
    session_id: SID, tool_name: 'Bash', tool_use_id: `t${i}`,
    cwd: 'f:\\DEV\\projet', _ts: new Date(ts).toISOString(),
  };
}

// Four identical calls, the first three already came back failing.
function runFailingLoop(wd) {
  let last = null;
  for (let i = 1; i <= 4; i++) {
    const r = wd.processEvent(pre(i, T + i * 1000));
    if (r.newAlerts.length) last = r.newAlerts[0];
    if (i < 4) wd.processEvent(post(i, T + i * 1000 + 500, true));
  }
  return last;
}

test('loop: chaque occurrence porte son identifiant et son issue', () => {
  const wd = createWatchdog({ now: () => T + 10_000 });
  const alert = runFailingLoop(wd);
  assert.ok(alert, 'la boucle doit lever une alerte');
  assert.equal(alert.occurrences.length, 4);
  assert.deepEqual(alert.occurrences.map(o => o.toolUseId), ['t1', 't2', 't3', 't4']);
  assert.deepEqual(alert.occurrences.map(o => o.failed), [true, true, true, null],
    'le dernier appel est encore en vol : son issue est inconnue, pas fausse');
});

test('loop: le libelle COMPTE les echecs, il ne quantifie jamais', () => {
  const wd = createWatchdog({ now: () => T + 10_000 });
  // 4 appels, 3 revenus en echec, le 4e encore en vol. Dire « all failing »
  // affirmerait sur un appel dont l'issue n'est pas connue — et qui ne le sera
  // jamais, l'alerte etant une photographie.
  const alert = runFailingLoop(wd);
  assert.ok(alert, 'la boucle doit lever une alerte');
  assert.match(alert.message, / — 3 of 4 failing$/);
  assert.doesNotMatch(alert.message, /\ball\b/);
});

test('loop: une repetition qui reussit ne parle pas d echec', () => {
  const wd = createWatchdog({ now: () => T + 10_000 });
  let last = null;
  for (let i = 1; i <= 4; i++) {
    const r = wd.processEvent(pre(i, T + i * 1000));
    if (r.newAlerts.length) last = r.newAlerts[0];
    if (i < 4) wd.processEvent(post(i, T + i * 1000 + 500, false));
  }
  assert.ok(last, 'la boucle doit lever une alerte');
  assert.doesNotMatch(last.message, /failing/);
});

test('loop: une repetition en partie en echec compte, elle ne generalise pas', () => {
  const wd = createWatchdog({ now: () => T + 10_000 });
  let last = null;
  for (let i = 1; i <= 4; i++) {
    const r = wd.processEvent(pre(i, T + i * 1000));
    if (r.newAlerts.length) last = r.newAlerts[0];
    if (i < 4) wd.processEvent(post(i, T + i * 1000 + 500, i === 1));
  }
  assert.ok(last, 'la boucle doit lever une alerte');
  assert.match(last.message, / — 1 of 4 failing$/);
});

test('une interruption humaine n est pas un echec de la commande', () => {
  const wd = createWatchdog({ now: () => T + 10_000 });
  let last = null;
  for (let i = 1; i <= 4; i++) {
    const r = wd.processEvent(pre(i, T + i * 1000));
    if (r.newAlerts.length) last = r.newAlerts[0];
    // Echap humain : l appel s arrete, mais on n apprend RIEN sur la commande.
    if (i < 4) wd.processEvent({ ...post(i, T + i * 1000 + 500, true), is_interrupt: true });
  }
  assert.ok(last, 'la boucle doit lever une alerte');
  assert.deepEqual(last.occurrences.map(o => o.failed), [null, null, null, null],
    'inconnu, pas echoue : compter une reprise en main comme une panne serait une fausse alerte');
  assert.doesNotMatch(last.message, /failing/);
});

test('toute alerte porte le projet ou elle s est produite', () => {
  const wd = createWatchdog({ now: () => T + 10_000 });
  assert.equal(runFailingLoop(wd).cwd, 'f:\\DEV\\projet');
});

test('retryStorm porte lui aussi le projet', () => {
  const wd = createWatchdog({ now: () => T + 10_000 });
  let last = null;
  for (let i = 1; i <= 3; i++) {
    const r = wd.processEvent(post(i, T + i * 1000, true));
    if (r.newAlerts.length) last = r.newAlerts[0];
  }
  assert.ok(last, 'trois echecs consecutifs doivent lever une alerte');
  assert.equal(last.type, 'retryStorm');
  assert.equal(last.cwd, 'f:\\DEV\\projet');
});

test('stuck porte aussi le projet, sans avoir d evenement sous la main', () => {
  let clock = T;
  const wd = createWatchdog({ now: () => clock });
  wd.processEvent(pre(1, T));
  clock = T + 4 * 60_000;               // au-dela de silenceMs, en deca d abandonnedMs
  const { newAlerts } = wd.tick();
  assert.equal(newAlerts.length, 1);
  assert.equal(newAlerts[0].cwd, 'f:\\DEV\\projet');
});

// ─── Le relevé réel ────────────────────────────────────────────────────────
// Les cas de bord ci-dessus se lisent mieux en objets construits sur place,
// mais aucun d'eux ne prouve que le détecteur sait lire ce que la machine
// écrit vraiment. Celui-ci fait traverser le code à la charge utile relevée
// sur la machine, telle quelle : si sa forme change, ce test tombe.

const failureEvent = JSON.parse(
  readFileSync(new URL('../fixtures/post-tool-use-failure.json', import.meta.url), 'utf8'),
);
const FT = Date.parse(failureEvent._ts);

test('un releve reel de PostToolUseFailure marque bien son occurrence en echec', () => {
  const wd = createWatchdog({ now: () => FT + 10_000 });
  const paired = {
    hook_event_name: 'PreToolUse', session_id: failureEvent.session_id,
    tool_name: failureEvent.tool_name, tool_input: failureEvent.tool_input,
    tool_use_id: failureEvent.tool_use_id, cwd: failureEvent.cwd,
    _ts: new Date(FT - 4000).toISOString(),
  };
  wd.processEvent(paired);
  wd.processEvent(failureEvent);        // le relevé, sans rien y toucher
  let last = null;
  for (let i = 2; i <= 4; i++) {
    const r = wd.processEvent({
      ...paired, tool_use_id: `t${i}`, _ts: new Date(FT - 4000 + i * 1000).toISOString(),
    });
    if (r.newAlerts.length) last = r.newAlerts[0];
  }
  assert.ok(last, 'quatre appels identiques doivent lever une alerte');
  assert.equal(last.occurrences[0].toolUseId, failureEvent.tool_use_id);
  assert.deepEqual(last.occurrences.map(o => o.failed), [true, null, null, null]);
  assert.equal(last.cwd, failureEvent.cwd);
  assert.match(last.message, / — 1 of 4 failing$/,
    'un seul echec connu sur quatre se dit comme tel, jamais « all »');
});

// `error` et `duration_ms` ne sont consommes par aucun detecteur aujourd hui,
// et c est exactement pourquoi ils ont besoin d une assertion : sans elle, les
// retirer du releve laisserait la suite verte et ce que la sonde de la tache 1
// avait etabli serait perdu en silence. On epingle la FORME, pas un libelle.
test('le releve garde la forme que la sonde a etablie', () => {
  assert.equal(typeof failureEvent.error, 'string',
    'error est une chaine plate, pas l objet structure qu annonçait une source secondaire');
  assert.match(failureEvent.error, /^Exit code \d+\n[\s\S]+$/,
    'code de sortie puis stderr, colles par un \\n');
  assert.ok(Number.isFinite(failureEvent.duration_ms),
    'duration_ms est une duree en millisecondes');
});
