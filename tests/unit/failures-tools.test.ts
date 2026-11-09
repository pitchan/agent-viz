// Le rangement des pannes de l'onglet Pannes : par outil, par nombre
// d'apparitions, avec des noms lisibles. Module pur, sans document.
import { expect, test } from 'vitest';
import {
  toolDisplayName, causeName, causeTool, gravity, layoutPannes, OTHER_INVOCATIONS,
} from '../../src/web/observatory/failures-tools.ts';
import { groupAlerts } from '../../src/web/observatory/failures-format.ts';
import type { Alert } from '../../src/engine/watchdog/detector.ts';

const JOUR = 86_400_000;
const T0 = Date.UTC(2026, 9, 19, 20, 0, 0);

const alerte = (sur: Record<string, any> = {}): Alert => ({
  id: 'x', type: 'loop', sessionId: 's1', toolName: 'Bash', count: 4, createdAt: T0,
  message: '', agentId: '', agentType: '', subject: 'git status', occurrences: [], tools: [],
  cwd: 'F:\\DEV\\agent-viz', standing: false, patternId: '', acknowledged: false, ...sur,
} as Alert);

// n episodes d'une meme cause, le plus recent a `dernier`.
const episodes = (n: number, dernier: number, sur: Record<string, any> = {}) =>
  Array.from({ length: n }, (_, i) => alerte({
    id: `${sur.type ?? 'loop'}-${sur.toolName ?? 'Bash'}-${sur.patternId ?? ''}-${i}`,
    createdAt: dernier - i * 1000, ...sur,
  }));

const unGroupe = (alerts: Alert[]) => groupAlerts(alerts)[0]!;

test.each([
  ['Bash', 'Shell (Bash)'],
  ['PowerShell', 'PowerShell'],
  ['WebFetch', 'Lecture de page web'],
  ['WebSearch', 'Recherche web'],
  ['Read', 'Lecture de fichier'],
  ['Edit', 'Modification de fichier'],
  ['Write', 'Écriture de fichier'],
  ['SendUserFile', 'Envoi de fichier'],
  ['SubagentHandback', 'Retour de sous-agent'],
  ['mcp__ccd_session__start_session', 'start_session (serveur ccd_session)'],
  ['run_command', 'run_command'],
  [OTHER_INVOCATIONS, 'Autres appels mal formés'],
])('l outil %s se nomme « %s »', (technique, lisible) => {
  expect(toolDisplayName(technique)).toBe(lisible);
});

test.each([
  [{ type: 'loop' }, 'Même appel répété à l’identique'],
  [{ type: 'retryStorm' }, 'Échecs à la suite'],
  [{ type: 'badInvocation', patternId: 'inv-bash-trailing-backslash-in-path' },
    'Un guillemet double non fermé — typiquement un chemin Windows terminé par un antislash'],
  [{ type: 'badInvocation', patternId: 'inv-inconnu' }, 'Un réglage du poste de travail'],
])('la panne %o se nomme sans repeter l outil', (sur, nom) => {
  // Arrange
  const groupe = unGroupe(episodes(2, T0, sur));
  // Act
  const lu = causeName(groupe);
  // Assert
  expect(lu).toBe(nom);
});

test('un appel mal forme PowerShell se range sous PowerShell, meme lance par un autre outil', () => {
  // Arrange
  const groupe = unGroupe([
    alerte({ id: 'a', type: 'badInvocation', patternId: 'inv-ps-command-not-found', toolName: 'PowerShell' }),
    alerte({ id: 'b', type: 'badInvocation', patternId: 'inv-ps-command-not-found', toolName: 'mcp__x__run' }),
  ]);
  // Act
  const outil = causeTool(groupe);
  // Assert
  expect(outil).toBe('PowerShell');
});

test.each([
  ['inv-bash-syntax-error'],
  ['inv-cross-shell-cmdlet-in-posix'],
])('le motif %s se range sous le shell Bash, quel que soit l outil de l episode', patternId => {
  // Arrange
  const groupe = unGroupe(episodes(1, T0, { type: 'badInvocation', patternId, toolName: 'run_command' }));
  // Act
  const outil = causeTool(groupe);
  // Assert
  expect(outil).toBe('Bash');
});

test('hors des familles connues, un appel mal forme garde son outil s il est le meme partout', () => {
  // Arrange
  const groupe = unGroupe(episodes(2, T0, { type: 'badInvocation', patternId: 'inv-autre', toolName: 'Grep' }));
  // Act
  const outil = causeTool(groupe);
  // Assert
  expect(outil).toBe('Grep');
});

test('hors des familles connues, un appel mal forme sur plusieurs outils va sous « Autres »', () => {
  // Arrange
  const groupe = unGroupe([
    alerte({ id: 'a', type: 'badInvocation', patternId: 'inv-autre', toolName: 'Grep' }),
    alerte({ id: 'b', type: 'badInvocation', patternId: 'inv-autre', toolName: 'Glob' }),
  ]);
  // Act
  const outil = causeTool(groupe);
  // Assert
  expect(outil).toBe(OTHER_INVOCATIONS);
});

test('une repetition se range sous son outil', () => {
  // Arrange
  const groupe = unGroupe(episodes(3, T0, { type: 'retryStorm', toolName: 'WebFetch' }));
  // Act
  const outil = causeTool(groupe);
  // Assert
  expect(outil).toBe('WebFetch');
});

test.each([[1, 'low'], [2, 'mid'], [4, 'mid'], [5, 'high'], [11, 'high']])(
  '%i apparitions donnent la gravite %s (rouge des 5, orange de 2 a 4, gris pour 1)',
  (n, niveau) => {
    expect(gravity(n)).toBe(niveau);
  },
);

// Le cas reel du 20/10/2026, reduit : une boucle Bash tres frequente, deux
// pannes a 3 qui se departagent par la date, des pannes isolees, une panne
// deja acquittee.
const reel = () => [
  ...episodes(11, T0, { type: 'loop', toolName: 'Bash' }),
  ...episodes(3, T0 - 10 * JOUR, { type: 'retryStorm', toolName: 'Bash' }),
  ...episodes(1, T0 + 1000, { type: 'badInvocation', toolName: 'Bash', patternId: 'inv-bash-trailing-backslash-in-path' }),
  ...episodes(3, T0 - 9 * JOUR, { type: 'badInvocation', toolName: 'PowerShell', patternId: 'inv-ps-command-not-found' }),
  ...episodes(2, T0 - 13 * JOUR, { type: 'retryStorm', toolName: 'WebFetch' }),
  ...episodes(2, T0 - 13 * JOUR - 1, { type: 'loop', toolName: 'WebFetch' }),
  ...episodes(1, T0 - 1, { type: 'loop', toolName: 'mcp__ccd_turn__wrap_up' }),
  ...episodes(1, T0 - 13 * JOUR, { type: 'loop', toolName: 'Edit' }),
  ...episodes(2, T0 - 20 * JOUR, { type: 'loop', toolName: 'Grep', acknowledged: true }),
];

test('le top 3 : les pannes a traiter apparues le plus, la plus recente d abord a egalite', () => {
  // Arrange
  const alerts = reel();
  // Act
  const { top } = layoutPannes(alerts);
  // Assert
  expect(top.map(g => [causeTool(g), causeName(g), g.episodes.length])).toEqual([
    ['Bash', 'Même appel répété à l’identique', 11],
    ['PowerShell', 'Une commande que PowerShell ne connaît pas', 3],
    ['Bash', 'Échecs à la suite', 3],
  ]);
});

test('les outils se trient par nombre d apparitions, et dans un outil la panne la plus frequente d abord', () => {
  // Arrange
  const alerts = reel();
  // Act
  const { tools } = layoutPannes(alerts);
  // Assert
  expect(tools.map(t => [t.tool, t.label, t.total])).toEqual([
    ['Bash', 'Shell (Bash)', 15],
    ['WebFetch', 'Lecture de page web', 4],
    ['PowerShell', 'PowerShell', 3],
  ]);
  expect(tools[0]!.causes.map(g => g.episodes.length)).toEqual([11, 3, 1]);
});

test('un outil vu une seule fois rejoint « Vues une seule fois », la plus recente d abord', () => {
  // Arrange
  const alerts = reel();
  // Act
  const { once } = layoutPannes(alerts);
  // Assert
  expect(once.map(g => causeTool(g))).toEqual(['mcp__ccd_turn__wrap_up', 'Edit']);
});

test('les comptes : pannes a traiter, apparitions, et les pannes acquittees mises a part', () => {
  // Arrange
  const alerts = reel();
  // Act
  const { toTreatCount, appearances, acked } = layoutPannes(alerts);
  // Assert
  expect(toTreatCount).toBe(8);
  expect(appearances, 'la somme des episodes des pannes a traiter').toBe(24);
  expect(acked.map(g => causeTool(g))).toEqual(['Grep']);
});

test('le chiffre d une panne compte aussi ses episodes deja acquittes', () => {
  // Arrange
  const alerts = [...episodes(10, T0 - JOUR, { acknowledged: true }), alerte({ id: 'nouveau', createdAt: T0 })];
  // Act
  const { top, appearances, acked } = layoutPannes(alerts);
  // Assert
  expect(top[0]!.episodes.length).toBe(11);
  expect(appearances).toBe(11);
  expect(acked.length, 'un episode non acquitte suffit a la garder a traiter').toBe(0);
});

test('les alertes stuck ne sont ni comptees ni rangees', () => {
  // Arrange
  const stuck = alerte({ id: 's', type: 'stuck', toolName: '', standing: true });
  // Act
  const vide = layoutPannes([stuck]);
  // Assert
  expect([vide.toTreatCount, vide.appearances]).toEqual([0, 0]);
  expect(vide.tools.length + vide.once.length + vide.acked.length + vide.top.length).toBe(0);
});
