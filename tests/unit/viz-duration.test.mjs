// C8 (audit de qualité de code, docs/audit-qualite-code.md) : la même durée
// était formatée par trois fonctions différentes — `calcDuration`
// (viz-layout.js), `formatSessionDuration` (viz-narrator.js) et une expression
// sans nom dans `updateLiveDurations` (viz-ui.js). Aucun test ne les couvrait.
//
// Une sonde différentielle les a mises côte à côte sur la même grille : sur le
// domaine nominal (0 → 1 h) les trois répondent EXACTEMENT la même chose. Elles
// ne divergeaient que hors contrat, et là brutalement — sur une date illisible,
// deux d'entre elles affichaient `NaNm` à l'écran, la troisième `?`.
//
// D'où le partage retenu : le module dit ce qu'est une durée et comment on
// l'écrit ; il rend `null` pour ce qui n'en est pas une, et chaque appelant
// garde SON mot pour ce cas — `null` pour la carte du graphe, `?` pour le
// narrateur. Le format est commun, la phrase de repli ne l'est pas.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration } from '../../src/web/viz-duration.mjs';

test('sous la seconde, la durée s écrit en millisecondes entières', () => {
  assert.equal(formatDuration(0), '0ms');
  assert.equal(formatDuration(1), '1ms');
  assert.equal(formatDuration(999), '999ms');
});

test('à partir d une seconde, elle passe aux secondes avec une décimale', () => {
  assert.equal(formatDuration(1000), '1.0s');
  assert.equal(formatDuration(1500), '1.5s');
  // 59 999 ms donne « 60.0s » et non « 1.0m » : l arrondi de la décimale se fait
  // APRÈS le choix de l unité. Les trois implémentations d origine partageaient
  // ce comportement au caractère près ; le partager n était pas le corriger.
  assert.equal(formatDuration(59_999), '60.0s');
});

test('à partir de la minute, elle passe aux minutes avec une décimale', () => {
  assert.equal(formatDuration(60_000), '1.0m');
  assert.equal(formatDuration(3_600_000), '60.0m');
});

test('ce qui n est pas une durée ne reçoit pas de mot ici', () => {
  // Arrange — les trois entrées que les appelants peuvent produire : une date
  // illisible (NaN), une borne absente, une horloge qui recule.
  const horsContrat = [NaN, Infinity, -Infinity, -1, -5000, undefined, null];

  // Act
  const rendus = horsContrat.map(formatDuration);

  // Assert — `null`, pas une chaîne : c est à l appelant de dire « ? », « — »
  // ou rien du tout. Avant C8, deux des trois écrivaient `NaNm` à l écran.
  assert.deepEqual(rendus, horsContrat.map(() => null));
});
