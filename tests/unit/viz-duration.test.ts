// Une seule écriture de la durée d'un intervalle en millisecondes, pour trois
// appelants : `calcDuration` (viz-layout.ts), `formatSessionDuration`
// (viz-narrator.ts) et `updateLiveDurations` (viz-ui.ts).
//
// Le module dit ce qu'est une durée et comment on l'écrit ; il rend `null` pour ce
// qui n'en est pas une, et chaque appelant garde SON mot pour ce cas — `null` pour
// la carte du graphe, `?` pour le narrateur. Le format est commun, le repli non.

import { expect, test } from 'vitest';
import { formatDuration } from '../../src/web/viz-duration.ts';

test('sous la seconde, la durée s écrit en millisecondes entières', () => {
  expect(formatDuration(0)).toBe('0ms');
  expect(formatDuration(1)).toBe('1ms');
  expect(formatDuration(999)).toBe('999ms');
});

test('à partir d une seconde, elle passe aux secondes avec une décimale', () => {
  expect(formatDuration(1000)).toBe('1.0s');
  expect(formatDuration(1500)).toBe('1.5s');
  // 59 999 ms donne « 60.0s » et non « 1.0m » : l arrondi de la décimale se fait
  // APRÈS le choix de l unité, comportement épinglé au caractère près.
  expect(formatDuration(59_999)).toBe('60.0s');
});

test('à partir de la minute, elle passe aux minutes avec une décimale', () => {
  expect(formatDuration(60_000)).toBe('1.0m');
  expect(formatDuration(3_600_000)).toBe('60.0m');
});

test('ce qui n est pas une durée ne reçoit pas de mot ici', () => {
  // Arrange — les trois entrées que les appelants peuvent produire : une date
  // illisible (NaN), une borne absente, une horloge qui recule.
  const horsContrat = [NaN, Infinity, -Infinity, -1, -5000, undefined, null];

  // Act
  const rendus = horsContrat.map((v) => formatDuration(v as any));

  // Assert — `null`, pas une chaîne : c est à l appelant de dire « ? », « — »
  // ou rien du tout, jamais `NaNm`.
  expect(rendus).toEqual(horsContrat.map(() => null));
});
