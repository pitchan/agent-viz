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
  const cmds = ['a', 'a', 'b', 'a'];   // le second « a » répète le premier
  cmds.forEach((c, i) => {
    wd.processEvent(pre(i, T + i * 1000, c));
    raised.push(...wd.processEvent({
      ...fail(i, T + i * 1000 + 500), tool_input: { command: c },
    }).newAlerts);
  });
  assert.deepEqual(raised.map(a => a.type), ['retryStorm']);
  // Le compte seul ne prouve rien : que le second « a » soit ignoré ou non,
  // on arrive à trois. Ce qui distingue les deux, c'est SUR QUEL échec
  // l'alerte naît. Ignoré : a, b, a — elle naît sur le dernier « a ».
  // Compté : a, a, b — elle serait née sur « b ».
  assert.equal(raised[0].subject, 'a',
    'l alerte naît sur le dernier « a » : la repetition du second n a pas compte');
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

// Les échecs de ces tests portent `tool_input`, comme ceux de la vraie machine
// (le relevé gelé de la sonde le prouve). C'est indispensable : un scénario
// dont l'échec ne porte pas sa charge ne reproduit pas la panne qu'il épingle.

const lecture = (id, ts) => ({
  hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Read',
  tool_use_id: id, tool_input: { file_path: `${id}.js` }, cwd: 'f:\\p',
  _ts: new Date(ts).toISOString(),
});

test('une boucle noyee dans dix autres appels reste vue par loop', () => {
  // Le cas qui a résisté trois rondes. Avec un tampon partagé de dix entrées,
  // ces lectures évinçaient les occurrences du build : loop devenait muet, et
  // retryStorm essayait de PRÉVOIR ce silence depuis l'extérieur. Compté par
  // signature, il n'y a plus rien à prévoir — une boucle est une boucle, que
  // d'autres outils travaillent en même temps ou non.
  const wd = createWatchdog({ now: () => T + 60_000 });
  const raised = [];
  for (let i = 1; i <= 4; i++) {
    const at = T + i * 10_000;
    raised.push(...wd.processEvent(pre(i, at, 'npm run build')).newAlerts);
    raised.push(...wd.processEvent({
      ...fail(i, at + 2000), tool_input: { command: 'npm run build' },
    }).newAlerts);
    // Intercalées APRÈS l'échec et avant la relance — l'ordre réaliste :
    // le build plante, l'agent lit des fichiers pour comprendre, il relance.
    for (let j = 0; j < 10; j++) {
      raised.push(...wd.processEvent(lecture(`r${i}-${j}`, at + 3000 + j * 100)).newAlerts);
    }
  }
  assert.deepEqual(raised.map(a => a.type), ['loop'],
    'plus aucune eviction : loop voit ses quatre occurrences et parle seul');
});

test('un filet de trois appels intercales ne cache plus rien non plus', () => {
  // La bande étroite de la ronde 2 : trois appels par cycle laissaient loop
  // sous son seuil pour toujours tout en le faisant paraître vivant. Elle
  // n'existe plus, il n'y a plus de seuil de capacité à franchir.
  const wd = createWatchdog({ now: () => T + 60_000 });
  const raised = [];
  for (let i = 1; i <= 4; i++) {
    const at = T + i * 5_000;
    raised.push(...wd.processEvent(pre(i, at, 'npm run build')).newAlerts);
    raised.push(...wd.processEvent({
      ...fail(i, at + 500), tool_input: { command: 'npm run build' },
    }).newAlerts);
    for (let j = 0; j < 3; j++) {
      raised.push(...wd.processEvent(lecture(`r${i}-${j}`, at + 600 + j * 50)).newAlerts);
    }
  }
  assert.deepEqual(raised.map(a => a.type), ['loop']);
});

test('une sequence mixte a,a,a,a,b ne met pas deux pastilles sur un fait', () => {
  // Les répétitions n'alimentent plus le compteur d'orage : seul le premier
  // « a » et le « b » comptent. Sans quoi deux répétitions plus un échec
  // distinct suffisaient à faire tirer retryStorm par-dessus loop.
  const wd = createWatchdog({ now: () => T + 60_000 });
  const raised = [];
  ['a', 'a', 'a', 'a', 'b'].forEach((c, i) => {
    const at = T + (i + 1) * 5_000;
    raised.push(...wd.processEvent(pre(i, at, c)).newAlerts);
    raised.push(...wd.processEvent({
      ...fail(i, at + 500), tool_input: { command: c },
    }).newAlerts);
  });
  assert.deepEqual(raised.map(a => a.type), ['loop'],
    'une boucle suivie d un echec distinct reste une seule panne');
});

test('les occurrences sorties de la fenetre sont oubliees', () => {
  // Bornage mémoire. Trois appels identiques, puis cinq cents appels tous
  // différents qui font passer la fenêtre. Si les anciennes occurrences
  // restaient, ce quatrième appel identique porterait le compte à quatre et
  // lèverait une boucle qui n'a pas eu lieu — et rien ne bornerait la
  // croissance de la carte.
  const wd = createWatchdog({ now: () => T + 700_000 });
  for (let i = 1; i <= 3; i++) wd.processEvent(pre(i, T + i * 1000, 'npm run build'));
  for (let i = 0; i < 500; i++) {
    wd.processEvent(pre(`u${i}`, T + 60_000 + i * 1000, `unique-${i}`));
  }
  const r = wd.processEvent(pre('final', T + 660_000, 'npm run build'));
  assert.deepEqual(r.newAlerts, [],
    'les trois anciennes occurrences ont quitte la fenetre, donc la carte');
});

test('ce qui sort de la fenetre sort AUSSI de la carte des identifiants', () => {
  // L'autre carte doit être élaguée avec la première, sinon elle seule croît
  // sans fin. Le piège : la signature doit rester VIVANTE dans `calls` (sinon
  // la garde « loop regarde-t-il ce cas ? » masque tout), pendant que le vieil
  // identifiant, lui, doit avoir été oublié.
  const wd = createWatchdog({ now: () => T + 180_000 });
  wd.processEvent(pre(1, T + 1000, 'npm run build'));         // t1 → build
  wd.processEvent(pre(9, T + 120_000, 'npm run build'));      // élague t1, garde la signature
  const raised = [];
  // t1 revient en échec très en retard, sans `tool_input` : lui seul dépend
  // de la carte des identifiants. Si elle l'avait gardé, l'échec suivant
  // passerait pour sa répétition et serait déféré — donc pas d'orage.
  raised.push(...wd.processEvent(fail(1, T + 121_000)).newAlerts);
  raised.push(...wd.processEvent(fail(9, T + 122_000)).newAlerts);
  raised.push(...wd.processEvent(fail(7, T + 123_000)).newAlerts);   // jamais vu
  assert.deepEqual(raised.map(a => a.type), ['retryStorm'],
    'un identifiant elague ne dit plus rien, et « inconnu » n est jamais une repetition');
});

test('l alerte est une photographie : ce qui arrive apres ne la reecrit pas', () => {
  // `loop` tient maintenant un tableau vivant par signature. L'alerte doit en
  // prendre une copie : sinon l'appel suivant la ferait grandir, et une issue
  // connue après coup réécrirait ce qu'elle affirmait au moment des faits.
  const wd = createWatchdog({ now: () => T + 60_000 });
  let alert = null;
  for (let i = 1; i <= 4; i++) {
    const r = wd.processEvent(pre(i, T + i * 1000, 'npm run build'));
    if (r.newAlerts.length) alert = r.newAlerts[0];
  }
  assert.ok(alert, 'quatre appels identiques doivent lever une boucle');
  assert.equal(alert.occurrences.length, 4);
  assert.deepEqual(alert.occurrences.map(o => o.failed), [null, null, null, null]);
  wd.processEvent({ ...fail(4, T + 4500), tool_input: { command: 'npm run build' } });
  wd.processEvent(pre(5, T + 5000, 'npm run build'));
  assert.equal(alert.occurrences.length, 4, 'l alerte ne grandit pas apres coup');
  assert.deepEqual(alert.occurrences.map(o => o.failed), [null, null, null, null],
    'une issue connue apres coup ne reecrit pas ce que l alerte affirmait');
});

test('la frontiere de cadence est exactement celle de loop, pas une approximation', () => {
  const run = (gap) => {
    const wd = createWatchdog({ now: () => T + 5 * gap });
    const raised = [];
    for (let i = 1; i <= 3; i++) {
      const at = T + i * gap;
      wd.processEvent(pre(i, at, 'npm run build'));
      raised.push(...wd.processEvent(fail(i, at + 100)).newAlerts);
    }
    return raised.map(a => a.type);
  };
  // 20 s × 3 = 60 s : loop y arrive tout juste, retryStorm se tait.
  assert.deepEqual(run(20_000), []);
  // Une milliseconde de plus, et loop ne peut plus : retryStorm reprend.
  assert.deepEqual(run(20_001), ['retryStorm']);
});

test('trois echecs identiques que loop n a jamais vus ne sont pas un silence', () => {
  // Aucun PreToolUse : loop n'a aucune preuve de cette répétition, et n'en
  // aura jamais. Lui déférer ici, ce serait se taire pour toujours — le
  // défaut même que la condition de capacité existe pour fermer.
  const wd = createWatchdog({ now: () => T + 60_000 });
  const raised = [];
  for (let i = 1; i <= 3; i++) {
    raised.push(...wd.processEvent({
      ...fail(i, T + i * 1000), tool_input: { command: 'npm run build' },
    }).newAlerts);
  }
  assert.deepEqual(raised.map(a => a.type), ['retryStorm'],
    'on ne defere pas a un detecteur qui n a rien vu et ne verra rien');
});

test('la signature se lit sur l evenement d echec, pas seulement dans sigOfCall', () => {
  // loop détient bien la répétition — quatre PreToolUse identiques. Mais les
  // échecs portent un tool_use_id absent de `sigOfCall` : seule la lecture
  // directe de `tool_input` peut voir qu'ils se répètent. Sans elle la
  // signature serait nulle, retryStorm compterait ses trois échecs, et la
  // double pastille reviendrait.
  const wd = createWatchdog({ now: () => T + 60_000 });
  const raised = [];
  for (let i = 1; i <= 4; i++) {
    const at = T + i * 10_000;
    raised.push(...wd.processEvent(pre(i, at, 'npm run build')).newAlerts);
    raised.push(...wd.processEvent({
      hook_event_name: 'PostToolUseFailure', session_id: SID, tool_name: 'Bash',
      tool_use_id: `inconnu-${i}`, tool_input: { command: 'npm run build' },
      cwd: 'f:\\p', _ts: new Date(at + 1000).toISOString(),
    }).newAlerts);
  }
  assert.deepEqual(raised.map(a => a.type), ['loop'],
    'sans lecture directe la signature serait inconnue et retryStorm doublonnerait');
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
