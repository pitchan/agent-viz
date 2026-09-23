// Tests unitaires de src/web/viz-pricing-drift-alert.ts : l'alerte que la vigie
// tarifaire lève dans l'onglet. La pastille et la notification lisent n'importe
// quel champ sans savoir d'où vient l'alerte : la forme entière est le contrat.
import { expect, test } from 'vitest';
import { pricingDriftAlert } from '../../src/web/viz-pricing-drift-alert.ts';
import type { Drift } from '../../src/server/pricing.ts';

const T = 1_700_000_000_000;
const LITELLM = { input: 4e-6, output: 2e-5, cacheCreate: 5e-6, cacheRead: 2e-7 };
const EMBARQUE = { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7 };
type DerivePortee = Pick<Drift, 'model' | 'kind' | 'litellm' | 'embedded'>;

test('une dérive produit une alerte complète, hors session, en état', () => {
  // Arrange
  const derive: DerivePortee = { model: 'claude-opus-6', kind: 'modele-nouveau', litellm: LITELLM, embedded: null };

  // Act
  const alerte = pricingDriftAlert(derive, T);

  // Assert
  expect(alerte).toEqual({
    id: 'pricingDrift:claude-opus-6',
    type: 'pricingDrift',
    sessionId: '', agentId: '', agentType: '', cwd: '',
    toolName: 'claude-opus-6',
    subject: 'LiteLLM, $ par million : entrée 4,00 · sortie 20,00 · écriture cache 5,00 · relecture cache 0,20',
    patternId: '',
    count: 1,
    createdAt: T,
    standing: true,
    occurrences: [], tools: [],
    message: 'Vigie tarifaire : claude-opus-6 existe chez LiteLLM mais pas dans la table embarquée',
    acknowledged: false,
  });
});

test('un tarif différent montre aussi le tarif embarqué', () => {
  // Arrange
  const derive: DerivePortee = { model: 'claude-opus-5', kind: 'tarif-different', litellm: LITELLM, embedded: EMBARQUE };

  // Act
  const alerte = pricingDriftAlert(derive, T);

  // Assert
  expect(alerte.subject).toBe(
    'LiteLLM, $ par million : entrée 4,00 · sortie 20,00 · écriture cache 5,00 · relecture cache 0,20'
    + ' — embarqué : entrée 5,00 · sortie 25,00 · écriture cache 6,25 · relecture cache 0,50');
});

test('un modèle nouveau et un tarif différent ne disent pas la même phrase', () => {
  // Arrange
  const natures: Drift['kind'][] = ['modele-nouveau', 'tarif-different'];

  // Act
  const phrases = natures.map(kind => pricingDriftAlert({ model: 'claude-opus-6', kind, litellm: LITELLM, embedded: EMBARQUE }, T).message);

  // Assert
  expect(phrases).toEqual([
    'Vigie tarifaire : claude-opus-6 existe chez LiteLLM mais pas dans la table embarquée',
    'Vigie tarifaire : le tarif de claude-opus-6 diffère entre LiteLLM et la table embarquée',
  ]);
});
