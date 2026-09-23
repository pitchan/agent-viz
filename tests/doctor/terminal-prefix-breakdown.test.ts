// La sous-ligne qui ventile le « début de contexte modifié ».
import { expect, test } from 'vitest';
import { emptyPrefixBreakdown } from '../../src/engine/doctor/aggregators/context.ts';
import { renderPrefixBreakdown } from '../../src/engine/doctor/report/terminal.ts';

const n = (x: number): string => x.toLocaleString('fr-FR');

test('affiche les marqueurs puis la profondeur, cases non vides seulement, dans un ordre fixe', () => {
  const b = emptyPrefixBreakdown();
  b.markers.modelSwitch = { events: 1, tokens: 50000 };
  b.markers.noMarker = { events: 2, tokens: 80000 };
  b.depth.facade = { events: 2, tokens: 100000 };
  b.depth.tail = { events: 1, tokens: 30000 };
  const s = renderPrefixBreakdown(b);
  expect(s).not.toBeNull();
  expect(s).toContain('préfixe modifié');
  expect(s).toContain(`modèle changé ×1 (${n(50000)} tk)`);
  expect(s).toContain(`sans marqueur ×2 (${n(80000)} tk)`);
  expect(s).not.toContain('outils apparus');
  expect(s).toContain(`façade (≤ 10 % relu) ×2 (${n(100000)} tk)`);
  expect(s).toContain(`queue (> 90 % relu) ×1 (${n(30000)} tk)`);
  expect(s).not.toContain('10–50 % relu');
  // Les marqueurs (l'attribution) s'affichent avant la profondeur (l'indice de localisation).
  expect(s!.indexOf('modèle changé')).toBeLessThan(s!.indexOf('façade'));
});

test('les marqueurs diagnostiqués (cache_miss_reason) ont chacun leur étiquette', () => {
  const b = emptyPrefixBreakdown();
  b.markers.systemChanged = { events: 1, tokens: 40000 };
  b.markers.toolsChanged = { events: 2, tokens: 30000 };
  b.markers.messagesChanged = { events: 1, tokens: 20000 };
  const s = renderPrefixBreakdown(b);
  expect(s).toContain(`bloc système modifié ×1 (${n(40000)} tk)`);
  expect(s).toContain(`bloc d’outils modifié ×2 (${n(30000)} tk)`);
  expect(s).toContain(`historique modifié ×1 (${n(20000)} tk)`);
});

test('tout à zéro → null (pas de ligne)', () => {
  expect(renderPrefixBreakdown(emptyPrefixBreakdown())).toBeNull();
});
