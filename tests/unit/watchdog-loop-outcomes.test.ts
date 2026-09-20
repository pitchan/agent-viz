// The point of this file: "it repeated itself" and "it repeated a failure"
// are not the same alert. The second is the documented worst case — an agent
// re-running a command that keeps failing — and it is the one worth waking
// someone for. The detector can only say it if it remembers how each call
// ended, so that is what these tests pin.

import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createWatchdog, type Alert } from '../../src/engine/watchdog/detector.ts';

const T = 1_700_000_000_000;
const SID = 'sess-1';

function pre(i: number, ts: number) {
  return {
    hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Bash',
    tool_use_id: `t${i}`, tool_input: { command: 'npm run build' },
    cwd: 'f:\\DEV\\projet', _ts: new Date(ts).toISOString(),
  };
}
function post(i: number, ts: number, failed: boolean) {
  return {
    hook_event_name: failed ? 'PostToolUseFailure' : 'PostToolUse',
    session_id: SID, tool_name: 'Bash', tool_use_id: `t${i}`,
    cwd: 'f:\\DEV\\projet', _ts: new Date(ts).toISOString(),
  };
}

// Four identical calls, the first three already came back failing.
function runFailingLoop(wd: ReturnType<typeof createWatchdog>): Alert | null {
  let last: Alert | null = null;
  for (let i = 1; i <= 4; i++) {
    const r = wd.processEvent(pre(i, T + i * 1000));
    if (r.newAlerts.length) last = r.newAlerts[0]!;
    if (i < 4) wd.processEvent(post(i, T + i * 1000 + 500, true));
  }
  return last;
}

test('loop: chaque occurrence porte son identifiant et son issue', () => {
  const wd = createWatchdog({ now: () => T + 10_000 });
  const alert = runFailingLoop(wd);
  expect(alert, 'la boucle doit lever une alerte').toBeTruthy();
  expect(alert!.occurrences.length).toBe(4);
  expect(alert!.occurrences.map(o => o.toolUseId)).toEqual(['t1', 't2', 't3', 't4']);
  expect(alert!.occurrences.map(o => o.failed), 'le dernier appel est encore en vol : son issue est inconnue, pas fausse').toEqual([true, true, true, null]);
});

test('loop: le libelle COMPTE les echecs, il ne quantifie jamais', () => {
  const wd = createWatchdog({ now: () => T + 10_000 });
  // 4 appels, 3 revenus en echec, le 4e encore en vol. Dire « all failing »
  // affirmerait sur un appel dont l'issue n'est pas connue — et qui ne le sera
  // jamais, l'alerte etant une photographie.
  const alert = runFailingLoop(wd);
  expect(alert, 'la boucle doit lever une alerte').toBeTruthy();
  expect(alert!.message).toMatch(/ — 3 of 4 failing$/);
  expect(alert!.message).not.toMatch(/\ball\b/);
});

test('loop: une repetition qui reussit ne parle pas d echec', () => {
  const wd = createWatchdog({ now: () => T + 10_000 });
  let last: Alert | null = null;
  for (let i = 1; i <= 4; i++) {
    const r = wd.processEvent(pre(i, T + i * 1000));
    if (r.newAlerts.length) last = r.newAlerts[0]!;
    if (i < 4) wd.processEvent(post(i, T + i * 1000 + 500, false));
  }
  expect(last, 'la boucle doit lever une alerte').toBeTruthy();
  expect(last!.message).not.toMatch(/failing/);
});

test('loop: une repetition en partie en echec compte, elle ne generalise pas', () => {
  const wd = createWatchdog({ now: () => T + 10_000 });
  let last: Alert | null = null;
  for (let i = 1; i <= 4; i++) {
    const r = wd.processEvent(pre(i, T + i * 1000));
    if (r.newAlerts.length) last = r.newAlerts[0]!;
    if (i < 4) wd.processEvent(post(i, T + i * 1000 + 500, i === 1));
  }
  expect(last, 'la boucle doit lever une alerte').toBeTruthy();
  expect(last!.message).toMatch(/ — 1 of 4 failing$/);
});

test('une interruption humaine n est pas un echec de la commande', () => {
  const wd = createWatchdog({ now: () => T + 10_000 });
  let last: Alert | null = null;
  for (let i = 1; i <= 4; i++) {
    const r = wd.processEvent(pre(i, T + i * 1000));
    if (r.newAlerts.length) last = r.newAlerts[0]!;
    // Echap humain : l appel s arrete, mais on n apprend RIEN sur la commande.
    if (i < 4) wd.processEvent({ ...post(i, T + i * 1000 + 500, true), is_interrupt: true });
  }
  expect(last, 'la boucle doit lever une alerte').toBeTruthy();
  expect(last!.occurrences.map(o => o.failed), 'inconnu, pas echoue : compter une reprise en main comme une panne serait une fausse alerte').toEqual([null, null, null, null]);
  expect(last!.message).not.toMatch(/failing/);
});

// Ce que ce test protege : la DONNEE, pas seulement sa mise en forme.
//
// `count` est derive de `occurrences.length`, donc une troncature chez le
// producteur reste AUTO-COHERENTE : plafonner la liste a cinq ferait dire
// « called 5× » d'une boucle de deux cent quarante, sans qu'aucune assertion
// de libelle ni de plafond d'affichage ne bronche — le plafond d'affichage
// vit dans viz-alert-format.ts et dit lui-meme combien il en a laisse de
// cote. Un compte faux dans le journal, lui, y reste quatre-vingt-dix jours.
//
// La propriete affirmee est donc : l'alerte porte TOUTES les repetitions
// encore dans la fenetre. Le chemin pour depasser le seuil est celui du
// produit et non un artifice : une alerte deja levee dedoublonne jusqu'a son
// acquittement, les repetitions s'accumulent pendant ce temps, et la suivante
// — levee au premier appel apres que le verrou a saute — les porte toutes.
//
// Mutation attrapee : `occ.slice(0, N).map(...)` chez le producteur.
test('loop: l alerte porte toutes les repetitions de la fenetre, jamais un echantillon', () => {
  const wd = createWatchdog({ now: () => T + 60_000 });
  let premiere: Alert | null = null;
  for (let i = 1; i <= 4; i++) {
    const r = wd.processEvent(pre(i, T + i * 1000));
    if (r.newAlerts.length) premiere = r.newAlerts[0]!;
  }
  expect(premiere!.count, 'la premiere alerte se leve au seuil').toBe(4);

  // Sous le verrou : la boucle continue, rien ne se leve, tout s'accumule.
  for (let i = 5; i <= 7; i++) {
    expect(wd.processEvent(pre(i, T + i * 1000)).newAlerts.length, 'une alerte deja active dedoublonne').toBe(0);
  }

  wd.acknowledge(premiere!.id);
  const seconde = wd.processEvent(pre(8, T + 8000)).newAlerts[0]!;

  expect(seconde, 'le verrou a saute : la boucle qui dure doit se redire').toBeTruthy();
  expect(seconde.count, 'les huit appels tiennent dans la fenetre de 60 s').toBe(8);
  expect(seconde.occurrences.length, 'le compte n est pas plus riche que la donnee').toBe(8);
  expect(seconde.occurrences.map(o => o.toolUseId)).toEqual(['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8']);
  expect(seconde.message).toMatch(/called 8×/);
});

test('toute alerte porte le projet ou elle s est produite', () => {
  const wd = createWatchdog({ now: () => T + 10_000 });
  expect(runFailingLoop(wd)!.cwd).toBe('f:\\DEV\\projet');
});

test('retryStorm porte lui aussi le projet', () => {
  const wd = createWatchdog({ now: () => T + 10_000 });
  let last: Alert | null = null;
  for (let i = 1; i <= 3; i++) {
    const r = wd.processEvent(post(i, T + i * 1000, true));
    if (r.newAlerts.length) last = r.newAlerts[0]!;
  }
  expect(last, 'trois echecs consecutifs doivent lever une alerte').toBeTruthy();
  expect(last!.type).toBe('retryStorm');
  expect(last!.cwd).toBe('f:\\DEV\\projet');
});

test('stuck porte aussi le projet, sans avoir d evenement sous la main', () => {
  let clock = T;
  const wd = createWatchdog({ now: () => clock });
  wd.processEvent(pre(1, T));
  clock = T + 4 * 60_000;               // au-dela de silenceMs, en deca d abandonnedMs
  const { newAlerts } = wd.tick();
  expect(newAlerts.length).toBe(1);
  expect(newAlerts[0]!.cwd).toBe('f:\\DEV\\projet');
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
  let last: Alert | null = null;
  for (let i = 2; i <= 4; i++) {
    const r = wd.processEvent({
      ...paired, tool_use_id: `t${i}`, _ts: new Date(FT - 4000 + i * 1000).toISOString(),
    });
    if (r.newAlerts.length) last = r.newAlerts[0]!;
  }
  expect(last, 'quatre appels identiques doivent lever une alerte').toBeTruthy();
  expect(last!.occurrences[0]!.toolUseId).toBe(failureEvent.tool_use_id);
  expect(last!.occurrences.map(o => o.failed)).toEqual([true, null, null, null]);
  expect(last!.cwd).toBe(failureEvent.cwd);
  expect(last!.message, 'un seul echec connu sur quatre se dit comme tel, jamais « all »').toMatch(/ — 1 of 4 failing$/);
});

// Aucun detecteur ne consomme `error` ni `duration_ms`, d ou cette assertion : sans elle,
// les retirer de la charge relevee laisserait la suite verte, et leur forme reelle serait
// perdue en silence. On epingle la FORME, pas un libelle.
test('la charge relevee porte error en chaine et duration_ms en nombre', () => {
  expect(typeof failureEvent.error, 'error est une chaine plate, pas un objet structure').toBe('string');
  expect(failureEvent.error, 'code de sortie puis stderr, colles par un \\n').toMatch(/^Exit code \d+\n[\s\S]+$/);
  expect(Number.isFinite(failureEvent.duration_ms), 'duration_ms est une duree en millisecondes').toBeTruthy();
});
