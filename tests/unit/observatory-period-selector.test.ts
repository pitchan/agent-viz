// Le panneau Skills n'offre que les fenêtres <= maxDays ; le clic doit comparer
// à la MÊME valeur bornée que le surlignage, sinon le bouton déjà actif
// redéclenche un setPeriodDays qui fait chuter silencieusement les autres
// panneaux (période partagée).

import { expect, test } from 'vitest';
import { clampedPeriodDays } from '../../src/web/observatory/period-selector.ts';

test('la période bornée vaut la période partagée quand elle tient sous la borne', () => {
  // Arrange
  const periodDays = 30;
  const maxDays = 90;
  // Act
  const result = clampedPeriodDays(periodDays, maxDays);
  // Assert
  expect(result).toBe(30);
});

test('la période bornée plafonne à maxDays quand la période partagée la dépasse', () => {
  // Arrange
  const periodDays = 90;
  const maxDays = 30;
  // Act
  const result = clampedPeriodDays(periodDays, maxDays);
  // Assert
  expect(result).toBe(30);
});
