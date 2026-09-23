// Tests unitaires de src/web/viz-pricing-adopted-alert.ts : l'alerte qu'un tarif
// Anthropic appliqué lève dans l'onglet. La pastille et la notification lisent
// n'importe quel champ sans savoir d'où vient l'alerte : la forme entière est le contrat.
import { expect, test } from 'vitest';
import { pricingAdoptedAlert } from '../../src/web/viz-pricing-adopted-alert.ts';
import { adoptedOf } from '../helpers/pricing-adopted.ts';

const T = 1_700_000_000_000;

test('un tarif appliqué produit une alerte complète, hors session, en état', () => {
  // Arrange
  const applique = adoptedOf('claude-opus-6', 'modele-nouveau');

  // Act
  const alerte = pricingAdoptedAlert(applique, T);

  // Assert
  expect(alerte).toEqual({
    id: 'pricingAdopted:claude-opus-6',
    type: 'pricingAdopted',
    sessionId: '', agentId: '', agentType: '', cwd: '',
    toolName: 'claude-opus-6',
    subject: '$ par million : entrée 4,00 · sortie 20,00 · écriture cache 5,00 · relecture cache 0,20',
    patternId: '',
    count: 1,
    createdAt: T,
    standing: true,
    occurrences: [], tools: [],
    message: 'Tarif Anthropic appliqué : nouveau modèle Opus 6',
    acknowledged: false,
  });
});

test('un modèle nouveau et un tarif changé ne disent pas la même phrase', () => {
  // Arrange
  const natures = ['modele-nouveau', 'tarif-different'] as const;

  // Act
  const phrases = natures.map(kind => pricingAdoptedAlert(adoptedOf('claude-opus-6', kind), T).message);

  // Assert
  expect(phrases).toEqual([
    'Tarif Anthropic appliqué : nouveau modèle Opus 6',
    'Tarif Anthropic mis à jour : Opus 6',
  ]);
});
