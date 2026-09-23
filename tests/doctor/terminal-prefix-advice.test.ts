// Les conseils affichés quand le préfixe modifié domine les causes réelles.
import { expect, test } from 'vitest';
import { emptyChurnCauses, emptyPrefixBreakdown } from '../../src/engine/doctor/aggregators/context.ts';
import { renderPrefixAdvice } from '../../src/engine/doctor/report/terminal.ts';

const n = (x: number): string => x.toLocaleString('fr-FR');

test('prefixChange à zéro → null (rien à conseiller)', () => {
  expect(renderPrefixAdvice(emptyChurnCauses(), emptyPrefixBreakdown())).toBeNull();
});

test('non dominant (expiration plus grosse) → null', () => {
  const causes = emptyChurnCauses();
  causes.prefixChange = { events: 2, tokens: 50000 };
  causes.expiration = { events: 3, tokens: 80000 };
  expect(renderPrefixAdvice(causes, emptyPrefixBreakdown())).toBeNull();
});

test('dominant → étiquette laboratoire + les 3 gestes', () => {
  const causes = emptyChurnCauses();
  causes.prefixChange = { events: 5, tokens: 200000 };
  causes.expiration = { events: 1, tokens: 40000 };
  const lines = renderPrefixAdvice(causes, emptyPrefixBreakdown());
  expect(lines).not.toBeNull();
  const s = lines!.join('\n');
  expect(s).toContain('conseil');
  expect(s).toContain('mesurés en laboratoire');
  expect(s).toContain('pas déduits de ces journaux');
  expect(s).toContain('ne pas changer de modèle en cours de session');
  expect(s).toContain('bascules de modèle silencieuses');
  expect(s).toContain('reprises rapides');
  expect(s).toContain('rebâtie à la reprise');
});

test('égalité avec une cause réelle → s’affiche (dominance large, ≥)', () => {
  const causes = emptyChurnCauses();
  causes.prefixChange = { events: 1, tokens: 50000 };
  causes.compaction = { events: 1, tokens: 50000 };
  expect(renderPrefixAdvice(causes, emptyPrefixBreakdown())).not.toBeNull();
});

test('modelSwitch vu dans CES journaux → le compte est ajouté à la ligne modèle', () => {
  const causes = emptyChurnCauses();
  causes.prefixChange = { events: 3, tokens: 150000 };
  const b = emptyPrefixBreakdown();
  b.markers.modelSwitch = { events: 2, tokens: 103000 };
  const s = renderPrefixAdvice(causes, b)!.join('\n');
  expect(s).toContain(`vu ici ×2 (${n(103000)} tk)`);
});

test('sans modelSwitch local, pas de « vu ici » (aucun chiffre inventé)', () => {
  const causes = emptyChurnCauses();
  causes.prefixChange = { events: 3, tokens: 150000 };
  const s = renderPrefixAdvice(causes, emptyPrefixBreakdown())!.join('\n');
  expect(s).not.toContain('vu ici');
});

test('growth (fausse alerte) plus gros n’empêche pas le conseil — exclu du gate', () => {
  const causes = emptyChurnCauses();
  causes.prefixChange = { events: 1, tokens: 50000 };
  causes.growth = { events: 10, tokens: 900000 };
  causes.unknown = { events: 4, tokens: 400000 };
  expect(renderPrefixAdvice(causes, emptyPrefixBreakdown())).not.toBeNull();
});
