// Formatters for the observatory pages. Pure — no DOM, no fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatUsd, formatBytes, formatDuration, confidenceLabel, costBasisLabel, costLabel, basisTitle,
  formatDayMonth, periodLabel, basisLabel, periodHeader, scanProgressLabel, formatTokens,
  formatUsdPerMTok, formatShare, formatUsdExact, modelLabel, summaryHeadline, summaryDetails,
  decisionLine, returnBanner,
} from '../../src/web/observatory/format.js';

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
  const { formatTokens } = await import('../../src/web/observatory/format.js');
  const { formatTokens: original } = await import('../../src/web/viz-state.js');
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

// R7 (doc/41) chiffre en jetons mesurés comme R1/R5/R6 : sans entrée dans la
// table des quantités de tête, sa carte perdait sa quantité mesurée dès qu'un
// modèle sans tarif rendait les dollars partiels — le chiffre qui porte le
// constat disparaissait au moment précis où les dollars ne valaient plus rien.
test('costLabel leads with the measured tokens at risk for R7 when partial', () => {
  const rec = {
    ruleId: 'R7', estimatedCostUsd: 12.5, costBasis: 'jetons-mesures',
    evidence: { costComplete: false, tokensAfterLastVerification: 18_276_640 },
  };
  const label = costLabel(rec);
  assert.ok(label.startsWith(`${formatTokens(18_276_640)} jetons mesurés`),
    `la quantite de tete R7 manque : ${label}`);
  assert.ok(label.includes('au moins 12,50 $'));
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

test('formatUsdPerMTok speaks per million tokens with a French decimal comma', () => {
  assert.equal(formatUsdPerMTok(3e-6), '3,00 $ le million');
  assert.equal(formatUsdPerMTok(1.25e-5), '12,50 $ le million');
  assert.equal(formatUsdPerMTok(5e-7), '0,50 $ le million');
});

test('formatShare renders a percentage with one decimal, French comma', () => {
  assert.equal(formatShare(0.1234), '12,3 %');
  assert.equal(formatShare(1), '100,0 %');
  assert.equal(formatShare(0), '0,0 %');
});

test('formatUsdExact forbids the false zero: sub-cent non-zero shows as < 0,01 $', () => {
  assert.equal(formatUsdExact(0.004), '< 0,01 $');
  assert.equal(formatUsdExact(0), '0,00 $');
  assert.equal(formatUsdExact(12.97), '12,97 $');
  assert.equal(formatUsdExact(0.01), '0,01 $');
});

test('summaryHeadline : la periode, les sessions, le cout — en francais clair', () => {
  const s = { period: { days: 30 }, sessions: 77, costUsd: 1888.91 };
  assert.equal(summaryHeadline(s), 'Sur 30 jours : 77 sessions, 1888,91 $ de coût équivalent API');
  assert.equal(summaryHeadline(null), '');
  assert.equal(summaryHeadline({ sessions: 3 }), '', 'sans periode, pas de phrase inventee');
});

test('summaryDetails : les memes chiffres qu avant, etiquetes, rien de supprime', () => {
  const s = {
    netTokens: 67_700_000, cacheReadTokens: 1_660_400_000,
    priceSource: 'netgain-table-embarquee', costComplete: true,
  };
  const d = summaryDetails(s);
  assert.match(d, /jetons nets/);
  assert.match(d, /relus depuis le cache/);
  assert.match(d, /prix : netgain-table-embarquee/);
  assert.doesNotMatch(d, /coût partiel/);
  assert.match(summaryDetails({ ...s, costComplete: false }), /coût partiel/);
  assert.equal(summaryDetails(null), '');
});

test('modelLabel derives readable labels, Claude 5 single-digit families included', () => {
  assert.equal(modelLabel('claude-opus-5'), 'Opus 5');
  assert.equal(modelLabel('claude-fable-5'), 'Fable 5');
  assert.equal(modelLabel('claude-opus-4-7'), 'Opus 4.7');
  assert.equal(modelLabel('claude-haiku-4-5'), 'Haiku 4.5');
  // Anything the rule does not cover keeps its raw id — never invented.
  assert.equal(modelLabel('<synthetic>'), '<synthetic>');
  assert.equal(modelLabel('ministral-3:latest'), 'ministral-3:latest');
  assert.equal(modelLabel(''), '');
});

// ─── Le journal des décisions (doc/44) : une ligne par carte décidée ───────

test('decisionLine : un refus porte la date en JJ/MM/AAAA puis la raison, en français', () => {
  assert.equal(
    decisionLine({ status: 'arbitrated', statusAt: '2026-08-08T12:00:00.000Z', statusReason: 'tests vérifiés au terminal, hors session' }),
    'Refusé le 08/08/2026 — tests vérifiés au terminal, hors session');
});

test('decisionLine : une adoption annonce sa surveillance', () => {
  assert.equal(
    decisionLine({ status: 'accepted', statusAt: '2026-08-08T12:00:00.000Z', statusReason: null }),
    'Adopté le 08/08/2026 — reviendra si le coût regrossit malgré tout');
});

test('decisionLine : une mise en veille annonce son seuil de retour', () => {
  assert.equal(
    decisionLine({ status: 'ignored', statusAt: '2026-08-08T12:00:00.000Z', statusReason: null }),
    'Mis en veille le 08/08/2026 — reviendra si le coût regrossit de moitié');
});

test('decisionLine sans raison consignée n’invente rien', () => {
  assert.equal(decisionLine({ status: 'arbitrated', statusAt: '2026-08-08T12:00:00.000Z', statusReason: null }),
    'Refusé le 08/08/2026');
});

test('decisionLine sans date consignée le dit, sans deviner', () => {
  assert.equal(decisionLine({ status: 'arbitrated', statusAt: null, statusReason: 'déjà pesé' }),
    'Refusé (date non consignée) — déjà pesé');
});

// ─── Le bandeau de retour (doc/44) : une carte décidée qui re-surface ──────

test('returnBanner : une adoption revenue interpelle sur le geste, pourcentage arrondi', () => {
  assert.equal(
    returnBanner({ status: 'accepted', statusAt: '2026-08-08T12:00:00.000Z', estimatedCostUsd: 16, costAtStatusUsd: 10 }),
    'Adopté le 08/08/2026 — le coût a pourtant regrossi de 60 % depuis. Le geste a-t-il pris ?');
});

test('returnBanner : une mise en veille revenue constate, sans interpeller', () => {
  assert.equal(
    returnBanner({ status: 'ignored', statusAt: '2026-08-08T12:00:00.000Z', estimatedCostUsd: 15, costAtStatusUsd: 10 }),
    'Mis en veille le 08/08/2026 — le coût a regrossi de 50 % depuis.');
});

test('returnBanner : une carte neuve n’a pas de bandeau', () => {
  assert.equal(returnBanner({ status: 'new', estimatedCostUsd: 15, costAtStatusUsd: null }), '');
});

test('returnBanner sans coût de référence exploitable ne chiffre rien', () => {
  // Un zéro au moment du clic rend le pourcentage indéfini : le bandeau
  // constate le retour sans inventer un chiffre.
  assert.equal(
    returnBanner({ status: 'ignored', statusAt: '2026-08-08T12:00:00.000Z', estimatedCostUsd: 15, costAtStatusUsd: 0 }),
    'Mis en veille le 08/08/2026 — le coût a regrossi depuis.');
});
