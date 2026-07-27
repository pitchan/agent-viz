// Formatters for the observatory pages. Pure — no DOM, no fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatUsd, formatBytes, formatDuration, confidenceLabel, costBasisLabel, costLabel, basisTitle }
  from '../../public/observatory/format.js';

test('formatUsd uses a French decimal comma and two digits', () => {
  assert.equal(formatUsd(0.4213), '0,42 $');
  assert.equal(formatUsd(12), '12,00 $');
  assert.equal(formatUsd(0), '0,00 $');
});

test('formatBytes goes from bytes to kilo and mega octets', () => {
  assert.equal(formatBytes(512), '512 o');
  assert.equal(formatBytes(2048), '2 Ko');
  assert.equal(formatBytes(5 * 1024 * 1024), '5,0 Mo');
});

test('durations are shown in minutes, then hours, and never faked', () => {
  assert.equal(formatDuration('2026-07-01T10:00:00.000Z', '2026-07-01T10:12:00.000Z'), '12 min');
  assert.equal(formatDuration('2026-07-01T10:00:00.000Z', '2026-07-01T11:05:00.000Z'), '1 h 05');
  assert.equal(formatDuration(null, '2026-07-01T11:05:00.000Z'), '—');
  assert.equal(formatDuration('2026-07-01T10:00:00.000Z', null), '—');
  assert.equal(formatDuration('pas-une-date', '2026-07-01T11:05:00.000Z'), '—');
});

test('confidence levels are shown in plain French', () => {
  assert.equal(confidenceLabel('fait'), 'Fait mesuré');
  assert.equal(confidenceLabel('correlation'), 'Corrélation');
  assert.equal(confidenceLabel('hypothese'), 'Hypothèse');
  assert.equal(confidenceLabel('autre'), 'Inconnu');
});

test('each cost basis has a label that says what the figure is worth', () => {
  assert.equal(costBasisLabel('jetons-mesures'), 'jetons mesurés');
  assert.equal(costBasisLabel('octets-approx-4o-par-jeton'),
    'estimé depuis les octets (≈ 4 octets par jeton)');
});

test('the cost label always states how the figure was obtained', () => {
  assert.equal(
    costLabel({ estimatedCostUsd: 2.5, costBasis: 'jetons-mesures', evidence: { costComplete: true } }),
    '2,50 $ — jetons mesurés');
});

test('a partially-priced recommendation says so, never a silent total', () => {
  assert.equal(
    costLabel({ estimatedCostUsd: 3, costBasis: 'jetons-mesures', evidence: { costComplete: false } }),
    '3,00 $ — jetons mesurés (coût partiel : un modèle sans tarif connu)');
});

test('each basis block has a title that warns against comparing across blocks', () => {
  assert.match(basisTitle('jetons-mesures'), /jetons mesurés/i);
  assert.match(basisTitle('octets-approx-4o-par-jeton'), /estimé/i);
  assert.notEqual(basisTitle('jetons-mesures'), basisTitle('octets-approx-4o-par-jeton'));
});

// formatTokens is not redefined by the observatory — it is re-exported from
// viz-state.js. Pinned here so a page never quietly gets two token formats.
test('formatTokens comes from viz-state and keeps its existing rendering', async () => {
  const { formatTokens } = await import('../../public/observatory/format.js');
  const { formatTokens: original } = await import('../../public/viz-state.js');
  assert.equal(formatTokens, original);
  assert.equal(formatTokens(1234567), '1.2M');
});
