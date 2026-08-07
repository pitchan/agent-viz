// Une fois les échecs visibles, le pire cas documenté — un agent qui relance
// la même commande qui plante — satisfait les DEUX détecteurs : loop (même
// entrée, quatre fois) et retryStorm (trois échecs d'affilée). Deux pastilles
// pour une seule panne, c'est très exactement la fatigue d'alerte que ce
// produit existe pour éviter.
//
// La correction n'est pas une préséance, c'est une disjonction. Répéter le
// MÊME appel qui échoue est le sujet de loop, et loop le dit mieux : il nomme
// la commande et compte les répétitions. retryStorm cesse donc de compter un
// échec qui répète le précédent, et ne garde que ce que loop ne peut pas voir
// — une série d'appels DIFFÉRENTS qui échouent tous.
//
// Une préséance n'aurait pas pu marcher : le seuil de retryStorm est atteint
// en premier, donc au moment où loop sort il n'y a plus rien à supprimer.
//
// Mais la délégation est CONDITIONNELLE. loop ne voit qu'une répétition qui
// tient dans sa fenêtre ; se taire pour une répétition qu'il n'atteindra
// jamais, ce serait ne prévenir personne.

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
  const cmds = ['a', 'a', 'b', 'a'];   // a, a(répétition ignorée), b, a
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
  // Aucun PreToolUse et aucun tool_input : le détecteur ne peut pas savoir ce
  // que ces appels étaient. Il ne doit pas en conclure qu'ils se répètent.
  for (let i = 10; i <= 12; i++) {
    raised.push(...wd.processEvent(fail(i, T + i * 1000, 'Read', `r${i}`)).newAlerts);
  }
  assert.deepEqual(raised.map(a => a.type), ['retryStorm']);
});

test('quatre interruptions humaines ne sont pas un orage d echecs', () => {
  const wd = createWatchdog({ now: () => T + 60_000 });
  const raised = [];
  for (let i = 1; i <= 4; i++) {
    wd.processEvent(pre(i, T + i * 1000, `commande-${i}`));
    raised.push(...wd.processEvent({ ...fail(i, T + i * 1000 + 500), is_interrupt: true }).newAlerts);
  }
  assert.deepEqual(raised, [],
    'reprendre la main quatre fois n est pas quatre pannes');
});

test('une boucle d echecs TROP LENTE pour loop reste vue par retryStorm', () => {
  // 45 s par tentative : loop ne verra jamais 4 appels dans sa fenêtre de
  // 60 s. Se taire ici, ce serait ne prévenir personne — et c'est le cas le
  // plus courant en vrai (un build qui échoue met plus de 20 s).
  const wd = createWatchdog({ now: () => T + 200_000 });
  const raised = [];
  for (let i = 1; i <= 3; i++) {
    const at = T + i * 45_000;
    wd.processEvent(pre(i, at, 'npm run build'));
    raised.push(...wd.processEvent(fail(i, at + 1000)).newAlerts);
  }
  assert.deepEqual(raised.map(a => a.type), ['retryStorm'],
    'hors de portee de loop, retryStorm reprend son role');
});

test('la meme boucle ASSEZ RAPIDE pour loop laisse loop parler seul', () => {
  // Même scénario, cadence 10 s : 10 × 3 = 30 ≤ 60, loop y arrivera.
  //
  // L'horloge se pose juste après le dernier événement, et pas plus loin : au
  // delà de freshnessMs (120 s) la barrière de fraîcheur retiendrait l'alerte
  // de loop, et le test rendrait [] — un vert impossible qui ne dirait rien de
  // la cadence. Une boucle rapide est de toute façon une boucle récente.
  const wd = createWatchdog({ now: () => T + 60_000 });
  const raised = [];
  for (let i = 1; i <= 4; i++) {
    const at = T + i * 10_000;
    raised.push(...wd.processEvent(pre(i, at, 'npm run build')).newAlerts);
    raised.push(...wd.processEvent(fail(i, at + 1000)).newAlerts);
  }
  assert.deepEqual(raised.map(a => a.type), ['loop']);
});

test('la signature se lit sur l evenement d echec, pas seulement dans le tampon de loop', () => {
  // Aucun PreToolUse : l'ancienne lecture indirecte aurait rendu null et
  // compté trois fois. L'échec porte tool_input, la signature est connue.
  const wd = createWatchdog({ now: () => T + 60_000 });
  const raised = [];
  for (let i = 1; i <= 3; i++) {
    raised.push(...wd.processEvent({
      ...fail(i, T + i * 1000), tool_input: { command: 'npm run build' },
    }).newAlerts);
  }
  assert.deepEqual(raised, [],
    'trois fois le meme echec est une repetition, meme sans PreToolUse');
});

test('apres un succes, le premier echec identique compte a nouveau', () => {
  // Le seul test qui couvre `lastFailureSig.delete`. Sans lui, le premier
  // « a » d'après le succès passerait pour une répétition du « a » d'avant.
  const wd = createWatchdog({ now: () => T + 60_000 });
  const raised = [];
  const step = (i, cmd) => {
    wd.processEvent(pre(i, T + i * 1000, cmd));
    raised.push(...wd.processEvent(fail(i, T + i * 1000 + 500)).newAlerts);
  };
  step(1, 'a');
  wd.processEvent({ hook_event_name: 'PostToolUse', session_id: SID, tool_name: 'Bash',
    tool_use_id: 'ok', cwd: 'f:\\p', _ts: new Date(T + 2000).toISOString() });
  step(2, 'a'); step(3, 'b'); step(4, 'a');
  assert.deepEqual(raised.map(a => a.type), ['retryStorm'],
    'le succes efface la memoire : a, b, a = trois echecs distincts');
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
