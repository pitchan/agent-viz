// La porte d'entree des alertes dans le navigateur. Ce qui a la forme qu'ecrit
// le detecteur passe tel quel ; ce qui ne l'a pas est ecarte et compte, jamais
// complete. Les controles positifs partent d'alertes levees par le vrai
// detecteur : c'est le verrou avec le moteur que tsc ne tient pas a l'execution.

import { expect, test } from 'vitest';
import { ALERT_TYPES, readAlert, readAlertsPayload } from '../../src/web/viz-alert-shape.ts';
import { createWatchdog, _DETECTOR_TYPES, type Alert } from '../../src/engine/watchdog/detector.ts';

const T0 = 1_700_000_000_000;

const appel = (id: string) => ({
  session_id: 's1', hook_event_name: 'PreToolUse', cwd: 'f:\\DEV\\projet',
  tool_name: 'Bash', tool_input: { command: 'npm run build' }, tool_use_id: id,
});

// Quatre fois la meme commande dans la fenetre : le detecteur leve une boucle.
function boucleDuDetecteur(): Alert {
  let t = T0;
  const wd = createWatchdog({ now: () => t });
  let levees: Alert[] = [];
  for (let i = 0; i < 4; i++) {
    levees = wd.processEvent(appel(`t${i}`)).newAlerts;
    t += 5_000;
  }
  return levees[0]!;
}

// Un outil lance, puis plus rien pendant trois minutes : le tic leve un blocage.
function blocageDuDetecteur(): Alert {
  let t = T0;
  const wd = createWatchdog({ now: () => t });
  wd.processEvent(appel('t1'));
  t += 3 * 60_000 + 1;
  return wd.tick().newAlerts[0]!;
}

// ── Ce qui passe : la forme du detecteur, a l'identique ────────────────────

test('une boucle levee par le vrai detecteur passe la porte telle quelle', () => {
  // Arrange
  const alerte = boucleDuDetecteur();
  // Act
  const lue = readAlert(alerte);
  // Assert
  expect(alerte.type, 'assiette : le detecteur a bien leve une boucle').toBe('loop');
  expect(lue).toEqual(alerte);
});

test('un blocage leve par le vrai detecteur passe la porte tel quel', () => {
  // Arrange
  const alerte = blocageDuDetecteur();
  // Act
  const lue = readAlert(alerte);
  // Assert
  expect(alerte.type, 'assiette : le detecteur a bien leve un blocage').toBe('stuck');
  expect(alerte.tools.length > 0, 'assiette : le blocage nomme son outil en vol').toBeTruthy();
  expect(lue).toEqual(alerte);
});

// GET /alerts ajoute `ackAt` a chaque ligne ; le navigateur ne le lit pas.
test('le champ ackAt ajoute par le journal traverse la porte, nul ou horodate', () => {
  // Arrange
  const alerte = boucleDuDetecteur();
  const relues = [{ ...alerte, ackAt: null }, { ...alerte, ackAt: 123 }];
  // Act
  const lues = relues.map(ligne => readAlert(ligne));
  // Assert
  expect(lues).toEqual(relues);
});

// ── Ce qui est refuse : rien n'est complete ────────────────────────────────

test('null, un nombre, une liste ou un objet vide sont refuses', () => {
  // Arrange
  const valeurs = [null, 42, [], {}];
  // Act
  const lues = valeurs.map(v => readAlert(v));
  // Assert
  expect(lues).toEqual([null, null, null, null]);
});

test('une alerte privee de n importe lequel de ses champs est refusee', () => {
  // Arrange
  const alerte = boucleDuDetecteur();
  const cles = Object.keys(alerte);
  // Act
  const acceptees = cles.filter(cle => {
    const { [cle]: _retire, ...privee } = alerte as unknown as Record<string, unknown>;
    return readAlert(privee) !== null;
  });
  // Assert
  expect(cles.includes('occurrences') && cles.includes('acknowledged'),
    `assiette : l alerte du detecteur porte ses champs (${cles.join(', ')})`).toBeTruthy();
  expect(acceptees, `champ(s) dont l absence passe la porte : ${acceptees.join(', ')}`).toEqual([]);
});

test('un type qu aucun detecteur ne leve, ou un tableau hors forme, est refuse', () => {
  // Arrange
  const alerte = boucleDuDetecteur();
  const abimees = {
    'type de la vigie tarifaire': { ...alerte, type: 'pricingDrift' },
    'type de demain': { ...alerte, type: 'unTypeDeDemain' },
    'occurrences nulles': { ...alerte, occurrences: null },
    'occurrence vide': { ...alerte, occurrences: [{}] },
    'outil vide': { ...alerte, tools: [{}] },
  };
  // Act
  const acceptees = Object.entries(abimees).filter(([, ligne]) => readAlert(ligne) !== null).map(([nom]) => nom);
  // Assert
  expect(acceptees).toEqual([]);
});

// Le navigateur ne charge pas le detecteur : ALERT_TYPES en est une copie, et
// ce test refuse un detecteur ajoute d'un cote sans l'autre.
test('la porte connait exactement les types que les detecteurs levent', () => {
  expect([...ALERT_TYPES].sort()).toEqual([..._DETECTOR_TYPES].sort());
});

// ── La reponse entiere de GET /alerts ──────────────────────────────────────

test('une reponse sans liste d alertes leve en nommant alerts : lecture ratee, pas journal vide', () => {
  // Arrange
  const reponses = [null, { alerts: 5 }];
  // Act
  const erreurs = reponses.map((r) => { try { readAlertsPayload(r); return ''; } catch (e: any) { return e.message; } });
  // Assert
  for (const message of erreurs) expect(message).toMatch(/: alerts n.est pas une liste/);
});

test('une reponse sans liste d identifiants vifs leve en nommant activeIds', () => {
  expect(() => readAlertsPayload({ alerts: [], activeIds: 7 })).toThrow(/: activeIds n.est pas une liste/);
});

test('une ligne hors forme est ecartee et comptee, le reste du journal est lu', () => {
  // Arrange
  const ok = boucleDuDetecteur();
  const reponse = { alerts: [null, ok, { createdAt: 1 }, undefined], activeIds: ['x'] };
  // Act
  const lu = readAlertsPayload(reponse);
  // Assert
  expect(lu).toEqual({ alerts: [ok], rejetees: 3, activeIds: ['x'] });
});
