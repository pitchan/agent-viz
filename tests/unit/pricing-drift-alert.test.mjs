// Tests unitaires de src/web/viz-pricing-drift-alert.ts : l'alerte que la vigie
// tarifaire lève dans l'onglet. La pastille et la notification lisent n'importe
// quel champ sans savoir d'où vient l'alerte : la forme entière est le contrat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pricingDriftAlert } from '../../src/web/viz-pricing-drift-alert.ts';

const T = 1_700_000_000_000;

test('une dérive produit une alerte complète, hors session, en état', () => {
  // Arrange
  const derive = { model: 'claude-opus-6', kind: 'modele-nouveau' };

  // Act
  const alerte = pricingDriftAlert(derive, T);

  // Assert
  assert.deepEqual(alerte, {
    id: 'pricingDrift:claude-opus-6',
    type: 'pricingDrift',
    sessionId: '', agentId: '', agentType: '', cwd: '',
    toolName: 'claude-opus-6', subject: '', patternId: '',
    count: 1,
    createdAt: T,
    standing: true,
    occurrences: [], tools: [],
    message: 'Vigie tarifaire : claude-opus-6 existe chez LiteLLM mais pas dans la table embarquée',
    acknowledged: false,
  });
});

test('un modèle nouveau et un tarif différent ne disent pas la même phrase', () => {
  // Arrange
  const natures = ['modele-nouveau', 'tarif-different'];

  // Act
  const phrases = natures.map(kind => pricingDriftAlert({ model: 'claude-opus-6', kind }, T).message);

  // Assert
  assert.deepEqual(phrases, [
    'Vigie tarifaire : claude-opus-6 existe chez LiteLLM mais pas dans la table embarquée',
    'Vigie tarifaire : le tarif de claude-opus-6 diffère entre LiteLLM et la table embarquée',
  ]);
});
