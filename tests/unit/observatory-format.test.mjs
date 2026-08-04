// Formatters for the observatory pages. Pure — no DOM, no fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatUsd, formatBytes, formatDuration, confidenceLabel, costBasisLabel, costLabel, basisTitle,
  formatDayMonth, periodLabel, basisLabel, periodHeader, scanProgressLabel, formatTokens,
} from '../../public/observatory/format.js';

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

test('formatDayMonth renders JJ/MM', () => {
  // Midday timestamp: no timezone edge can move the date (anti-flaky).
  assert.equal(formatDayMonth('2026-08-03T12:00:00.000Z'), '03/08');
});

test('periodLabel says the window, or says it does not know', () => {
  assert.equal(
    periodLabel({ periodFrom: '2026-07-04T12:00:00.000Z', periodTo: '2026-08-03T12:00:00.000Z' }),
    'constaté du 04/07 au 03/08');
  assert.equal(periodLabel({ periodFrom: null, periodTo: null }),
    'période du constat non enregistrée (re-scanner)');
});

test('basisLabel states the human/machine composition of the announced basis', () => {
  assert.equal(
    basisLabel({ counts: { interactive: 12, headless: 640, unknown: 3 }, includeMachine: false }),
    '12 sessions humaines · 640 machines exclues · 3 indéterminées exclues');
  assert.equal(
    basisLabel({ counts: { interactive: 12, headless: 640, unknown: 3 }, includeMachine: true }),
    '12 sessions humaines · 640 machines incluses · 3 indéterminées incluses');
  assert.equal(basisLabel(null), '');
});

test('periodHeader names the window and its bounds', () => {
  assert.equal(
    periodHeader({ days: 30, from: '2026-07-04T12:00:00.000Z', to: '2026-08-03T12:00:00.000Z' }),
    'Fenêtre : 30 j — du 04/07 au 03/08');
  assert.equal(periodHeader(null), '');
});

test('scanProgressLabel counts every handled session, silent when idle or done', () => {
  assert.equal(scanProgressLabel({ phase: 'start', total: 809, scanned: 0, skipped: 0, failed: 0 }),
    'Analyse en cours — 0/809 sessions');
  assert.equal(scanProgressLabel({ phase: 'progress', total: 809, scanned: 500, skipped: 20, failed: 3 }),
    'Analyse en cours — 523/809 sessions');
  assert.equal(scanProgressLabel({ phase: 'done', total: 809, scanned: 809, skipped: 0, failed: 0 }), '');
  assert.equal(scanProgressLabel(null), '');
});

// formatTokens is not redefined by the observatory — it is re-exported from
// viz-state.js. Pinned here so a page never quietly gets two token formats.
test('formatTokens comes from viz-state and keeps its existing rendering', async () => {
  const { formatTokens } = await import('../../public/observatory/format.js');
  const { formatTokens: original } = await import('../../public/viz-state.js');
  assert.equal(formatTokens, original);
  assert.equal(formatTokens(1234567), '1.2M');
});

test('costLabel leads with measured tokens when the cost is partial', () => {
  const rec = {
    ruleId: 'R1', estimatedCostUsd: 0.02, costBasis: 'jetons-mesures',
    evidence: { costComplete: false, prefixChangeTokens: 1_200_000 },
  };
  const label = costLabel(rec);
  assert.ok(label.startsWith(`${formatTokens(1_200_000)} jetons mesurés`));
  assert.ok(label.includes('au moins 0,02 $'));
});

test('costLabel leads with measured bytes for byte-based rules when partial', () => {
  const rec = {
    ruleId: 'R3', estimatedCostUsd: 1.5, costBasis: 'octets-approx-4o-par-jeton',
    evidence: { costComplete: false, bytes: 2 * 1024 * 1024 },
  };
  const label = costLabel(rec);
  assert.ok(label.startsWith(`${formatBytes(2 * 1024 * 1024)} mesurés`));
  assert.ok(label.includes('au moins 1,50 $'));
});

test('costLabel keeps the current partial wording when the rule carries no quantity', () => {
  const rec = {
    ruleId: 'R2', estimatedCostUsd: 3, costBasis: 'jetons-mesures',
    evidence: { costComplete: false },
  };
  assert.ok(costLabel(rec).includes('coût partiel'));
});

test('costLabel is unchanged when the cost is complete', () => {
  const rec = {
    ruleId: 'R1', estimatedCostUsd: 48.48, costBasis: 'jetons-mesures',
    evidence: { costComplete: true, prefixChangeTokens: 9 },
  };
  assert.equal(costLabel(rec), '48,48 $ — jetons mesurés');
});
