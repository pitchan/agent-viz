// Formatters for the observatory pages. Pure — no DOM, no fetch.
import { expect, test } from 'vitest';
import {
  formatUsd, formatBytes, formatDuration, confidenceLabel, costBasisLabel, costLabel, basisTitle,
  formatDayMonth, periodLabel, basisLabel, periodHeader, scanProgressLabel, formatTokens,
  formatUsdPerMTok, formatShare, formatUsdExact, modelLabel, summaryHeadline, summaryDetails,
  decisionLine, returnBanner,
} from '../../src/web/observatory/format.ts';
import type { Recommendation, Summary } from '../../src/web/observatory/format.ts';

// DecisionFields (format.ts) n'est pas exporte : chaque fixture ci-dessous ne
// porte que le sous-ensemble que la fonction lit reellement, jamais la forme
// entiere de Recommendation — d'ou le cast plutot qu'un objet complet.
type DecisionRec = Parameters<typeof decisionLine>[0];

test('formatUsd uses a French decimal comma and two digits', () => {
  expect(formatUsd(0.4213)).toBe('0,42 $');
  expect(formatUsd(12)).toBe('12,00 $');
  expect(formatUsd(0)).toBe('0,00 $');
});

test('formatBytes goes from bytes to kilo and mega octets', () => {
  expect(formatBytes(512)).toBe('512 o');
  expect(formatBytes(2048)).toBe('2 Ko');
  expect(formatBytes(5 * 1024 * 1024)).toBe('5,0 Mo');
});

test('durations are shown in minutes, then hours, and never faked', () => {
  expect(formatDuration('2026-07-01T10:00:00.000Z', '2026-07-01T10:12:00.000Z')).toBe('12 min');
  expect(formatDuration('2026-07-01T10:00:00.000Z', '2026-07-01T11:05:00.000Z')).toBe('1 h 05');
  expect(formatDuration(null, '2026-07-01T11:05:00.000Z')).toBe('—');
  expect(formatDuration('2026-07-01T10:00:00.000Z', null)).toBe('—');
  expect(formatDuration('pas-une-date', '2026-07-01T11:05:00.000Z')).toBe('—');
});

test('confidence levels are shown in plain French', () => {
  expect(confidenceLabel('fait')).toBe('Fait mesuré');
  expect(confidenceLabel('correlation')).toBe('Corrélation');
  expect(confidenceLabel('hypothese')).toBe('Hypothèse');
  expect(confidenceLabel('autre')).toBe('Inconnu');
});

test('each cost basis has a label that says what the figure is worth', () => {
  expect(costBasisLabel('jetons-mesures')).toBe('jetons mesurés');
  expect(costBasisLabel('octets-approx-4o-par-jeton')).toBe('estimé depuis les octets (≈ 4 octets par jeton)');
});

test('the cost label always states how the figure was obtained', () => {
  expect(costLabel({ estimatedCostUsd: 2.5, costBasis: 'jetons-mesures', evidence: { costComplete: true } } as Recommendation)).toBe('2,50 $ — jetons mesurés');
});

test('a partially-priced recommendation says so, never a silent total', () => {
  expect(costLabel({ estimatedCostUsd: 3, costBasis: 'jetons-mesures', evidence: { costComplete: false } } as Recommendation)).toBe('3,00 $ — jetons mesurés (coût partiel : une part des messages n’a pas pu être tarifée)');
});

test('each basis block has a title that warns against comparing across blocks', () => {
  expect(basisTitle('jetons-mesures')).toMatch(/jetons mesurés/i);
  expect(basisTitle('octets-approx-4o-par-jeton')).toMatch(/estimé/i);
  expect(basisTitle('non-chiffre')).toMatch(/non chiffré/i);
  expect(basisTitle('jetons-mesures')).not.toBe(basisTitle('octets-approx-4o-par-jeton'));
});

// R8/R9/R10 : un coût jamais calculé n'a pas de dollar à montrer, jamais un 0,00 $.
test('costLabel for the non-chiffre basis names no dollar amount, even without costComplete', () => {
  expect(costLabel({ estimatedCostUsd: 0, costBasis: 'non-chiffre', evidence: {} } as Recommendation)).toBe('non chiffré');
  expect(costLabel({ estimatedCostUsd: 0, costBasis: 'non-chiffre', evidence: { costComplete: false } } as Recommendation)).toBe('non chiffré');
});

test('formatDayMonth renders JJ/MM', () => {
  // Midday timestamp: no timezone edge can move the date (anti-flaky).
  expect(formatDayMonth('2026-08-03T12:00:00.000Z')).toBe('03/08');
});

test('periodLabel says the window, or says it does not know', () => {
  expect(periodLabel({ periodFrom: '2026-07-04T12:00:00.000Z', periodTo: '2026-08-03T12:00:00.000Z' } as Recommendation)).toBe('constaté du 04/07 au 03/08');
  expect(periodLabel({ periodFrom: null, periodTo: null } as Recommendation)).toBe('période du constat non enregistrée (re-scanner)');
});

test('basisLabel states the human/machine composition of the announced basis', () => {
  expect(basisLabel({ counts: { interactive: 12, headless: 640, unknown: 3 }, includeMachine: false })).toBe('12 sessions humaines · 640 machines exclues · 3 indéterminées exclues');
  expect(basisLabel({ counts: { interactive: 12, headless: 640, unknown: 3 }, includeMachine: true })).toBe('12 sessions humaines · 640 machines incluses · 3 indéterminées incluses');
  expect(basisLabel(null)).toBe('');
});

test('periodHeader names the window and its bounds', () => {
  expect(periodHeader({ days: 30, from: '2026-07-04T12:00:00.000Z', to: '2026-08-03T12:00:00.000Z' })).toBe('Fenêtre : 30 j — du 04/07 au 03/08');
  expect(periodHeader(null)).toBe('');
});

test('scanProgressLabel counts every handled session, silent when idle or done', () => {
  expect(scanProgressLabel({ phase: 'start', total: 809, scanned: 0, skipped: 0, failed: 0 })).toBe('Analyse en cours — 0/809 sessions');
  expect(scanProgressLabel({ phase: 'progress', total: 809, scanned: 500, skipped: 20, failed: 3 })).toBe('Analyse en cours — 523/809 sessions');
  expect(scanProgressLabel({ phase: 'done', total: 809, scanned: 809, skipped: 0, failed: 0 })).toBe('');
  expect(scanProgressLabel(null)).toBe('');
});

// formatTokens is not redefined by the observatory — it is re-exported from
// viz-state.ts. Pinned here so a page never quietly gets two token formats.
test('formatTokens comes from viz-state and keeps its existing rendering', async () => {
  const { formatTokens } = await import('../../src/web/observatory/format.ts');
  const { formatTokens: original } = await import('../../src/web/viz-state.ts');
  expect(formatTokens).toBe(original);
  expect(formatTokens(1234567)).toBe('1.2M');
});

test('costLabel leads with measured tokens when the cost is partial', () => {
  const rec = {
    ruleId: 'R1', estimatedCostUsd: 0.02, costBasis: 'jetons-mesures',
    evidence: { costComplete: false, prefixChangeTokens: 1_200_000 },
  } as Recommendation;
  const label = costLabel(rec);
  expect(label.startsWith(`${formatTokens(1_200_000)} jetons mesurés`)).toBeTruthy();
  expect(label.includes('au moins 0,02 $')).toBeTruthy();
});

test('costLabel leads with measured bytes for byte-based rules when partial', () => {
  const rec = {
    ruleId: 'R3', estimatedCostUsd: 1.5, costBasis: 'octets-approx-4o-par-jeton',
    evidence: { costComplete: false, bytes: 2 * 1024 * 1024 },
  } as Recommendation;
  const label = costLabel(rec);
  expect(label.startsWith(`${formatBytes(2 * 1024 * 1024)} mesurés`)).toBeTruthy();
  expect(label.includes('au moins 1,50 $')).toBeTruthy();
});

test('costLabel leads with measured bytes for R11 when partial', () => {
  const rec = {
    ruleId: 'R11', estimatedCostUsd: 1.5, costBasis: 'octets-approx-4o-par-jeton',
    evidence: { costComplete: false, bytes: 80000 },
  } as Recommendation;
  const label = costLabel(rec);
  expect(label.startsWith(`${formatBytes(80000)} mesurés`)).toBeTruthy();
  expect(label.includes('au moins 1,50 $')).toBeTruthy();
});

// R7 (jetons mesurés, comme R1/R5/R6) a son entrée dans la table des quantités de
// tête : sans elle, sa carte perdait sa quantité mesurée dès qu'un modèle sans
// tarif rendait les dollars partiels, au moment où ce chiffre porte seul le constat.
test('costLabel leads with the measured tokens at risk for R7 when partial', () => {
  const rec = {
    ruleId: 'R7', estimatedCostUsd: 12.5, costBasis: 'jetons-mesures',
    evidence: { costComplete: false, tokensAfterLastVerification: 18_276_640 },
  } as Recommendation;
  const label = costLabel(rec);
  expect(label.startsWith(`${formatTokens(18_276_640)} jetons mesurés`), `la quantite de tete R7 manque : ${label}`).toBeTruthy();
  expect(label.includes('au moins 12,50 $')).toBeTruthy();
});

test('costLabel keeps the current partial wording when the rule carries no quantity', () => {
  const rec = {
    ruleId: 'R2', estimatedCostUsd: 3, costBasis: 'jetons-mesures',
    evidence: { costComplete: false },
  } as Recommendation;
  expect(costLabel(rec).includes('coût partiel')).toBeTruthy();
});

test('costLabel is unchanged when the cost is complete', () => {
  const rec = {
    ruleId: 'R1', estimatedCostUsd: 48.48, costBasis: 'jetons-mesures',
    evidence: { costComplete: true, prefixChangeTokens: 9 },
  } as Recommendation;
  expect(costLabel(rec)).toBe('48,48 $ — jetons mesurés');
});

test('formatUsdPerMTok speaks per million tokens with a French decimal comma', () => {
  expect(formatUsdPerMTok(3e-6)).toBe('3,00 $ le million');
  expect(formatUsdPerMTok(1.25e-5)).toBe('12,50 $ le million');
  expect(formatUsdPerMTok(5e-7)).toBe('0,50 $ le million');
});

test('formatShare renders a percentage with one decimal, French comma', () => {
  expect(formatShare(0.1234)).toBe('12,3 %');
  expect(formatShare(1)).toBe('100,0 %');
  expect(formatShare(0)).toBe('0,0 %');
});

test('formatUsdExact forbids the false zero: sub-cent non-zero shows as < 0,01 $', () => {
  expect(formatUsdExact(0.004)).toBe('< 0,01 $');
  expect(formatUsdExact(0)).toBe('0,00 $');
  expect(formatUsdExact(12.97)).toBe('12,97 $');
  expect(formatUsdExact(0.01)).toBe('0,01 $');
});

test('summaryHeadline : la periode, les sessions, le cout — en francais clair', () => {
  const s = { period: { days: 30 }, sessions: 77, costUsd: 1888.91 } as Summary;
  expect(summaryHeadline(s)).toBe('Sur 30 jours : 77 sessions, 1888,91 $ de coût équivalent API');
  expect(summaryHeadline(null)).toBe('');
  expect(summaryHeadline({ sessions: 3 } as Summary), 'sans periode, pas de phrase inventee').toBe('');
});

test('summaryDetails : jetons nets, cache relu et source de prix, chacun etiquete', () => {
  const s = {
    netTokens: 67_700_000, cacheReadTokens: 1_660_400_000,
    priceSource: 'netgain-table-embarquee', costComplete: true,
  } as Summary;
  const d = summaryDetails(s);
  expect(d).toMatch(/jetons nets/);
  expect(d).toMatch(/relus depuis le cache/);
  expect(d).toMatch(/prix : netgain-table-embarquee/);
  expect(d).not.toMatch(/coût partiel/);
  expect(summaryDetails({ ...s, costComplete: false })).toMatch(/coût partiel/);
  expect(summaryDetails(null)).toBe('');
});

test('modelLabel derives readable labels, Claude 5 single-digit families included', () => {
  expect(modelLabel('claude-opus-5')).toBe('Opus 5');
  expect(modelLabel('claude-fable-5')).toBe('Fable 5');
  expect(modelLabel('claude-opus-4-7')).toBe('Opus 4.7');
  expect(modelLabel('claude-haiku-4-5')).toBe('Haiku 4.5');
  // Anything the rule does not cover keeps its raw id — never invented.
  expect(modelLabel('<synthetic>')).toBe('<synthetic>');
  expect(modelLabel('ministral-3:latest')).toBe('ministral-3:latest');
  expect(modelLabel('')).toBe('');
});

// ─── Le journal des décisions : une ligne par carte décidée ────────────────

test('decisionLine : un refus porte la date en JJ/MM/AAAA puis la raison, en français', () => {
  expect(decisionLine({ status: 'arbitrated', statusAt: '2026-08-08T12:00:00.000Z', statusReason: 'tests vérifiés au terminal, hors session' } as DecisionRec)).toBe('Refusé le 08/08/2026 — tests vérifiés au terminal, hors session');
});

test('decisionLine : une adoption annonce sa surveillance', () => {
  expect(decisionLine({ status: 'accepted', statusAt: '2026-08-08T12:00:00.000Z', statusReason: null } as DecisionRec)).toBe('Adopté le 08/08/2026 — reviendra si le coût regrossit malgré tout');
});

test('decisionLine : une mise en veille annonce son seuil de retour', () => {
  expect(decisionLine({ status: 'ignored', statusAt: '2026-08-08T12:00:00.000Z', statusReason: null } as DecisionRec)).toBe('Mis en veille le 08/08/2026 — reviendra si le coût regrossit de moitié');
});

test('decisionLine sans raison consignée n’invente rien', () => {
  expect(decisionLine({ status: 'arbitrated', statusAt: '2026-08-08T12:00:00.000Z', statusReason: null } as DecisionRec)).toBe('Refusé le 08/08/2026');
});

test('decisionLine sans date consignée le dit, sans deviner', () => {
  expect(decisionLine({ status: 'arbitrated', statusAt: null, statusReason: 'déjà pesé' } as DecisionRec)).toBe('Refusé (date non consignée) — déjà pesé');
});

test('decisionLine : un non-chiffré adopté ne promet aucun retour', () => {
  // Un non-chiffré ne revient jamais tout seul (isEligible, ranking.ts, exige
  // un coût mesuré) : la veille annoncée aux bases chiffrées mentirait ici.
  expect(decisionLine({
    status: 'accepted', statusAt: '2026-08-08T12:00:00.000Z', statusReason: null, costBasis: 'non-chiffre',
  } as DecisionRec)).toBe('Adopté le 08/08/2026');
});

test('decisionLine : une base chiffrée garde sa promesse de retour', () => {
  expect(decisionLine({
    status: 'accepted', statusAt: '2026-08-08T12:00:00.000Z', statusReason: null, costBasis: 'jetons-mesures',
  } as DecisionRec)).toBe('Adopté le 08/08/2026 — reviendra si le coût regrossit malgré tout');
});

// ─── Le bandeau de retour : une carte décidée qui re-surface ───────────────

test('returnBanner : une adoption revenue interpelle sur le geste, pourcentage arrondi', () => {
  expect(returnBanner({ status: 'accepted', statusAt: '2026-08-08T12:00:00.000Z', estimatedCostUsd: 16, costAtStatusUsd: 10 } as Recommendation)).toBe('Adopté le 08/08/2026 — le coût a pourtant regrossi de 60 % depuis. Le geste a-t-il pris ?');
});

test('returnBanner : une mise en veille revenue constate, sans interpeller', () => {
  expect(returnBanner({ status: 'ignored', statusAt: '2026-08-08T12:00:00.000Z', estimatedCostUsd: 15, costAtStatusUsd: 10 } as Recommendation)).toBe('Mis en veille le 08/08/2026 — le coût a regrossi de 50 % depuis.');
});

test('returnBanner : une carte neuve n’a pas de bandeau', () => {
  expect(returnBanner({ status: 'new', estimatedCostUsd: 15, costAtStatusUsd: null } as Recommendation)).toBe('');
});

test('returnBanner sans coût de référence exploitable ne chiffre rien', () => {
  // Un zéro au moment du clic rend le pourcentage indéfini : le bandeau
  // constate le retour sans inventer un chiffre.
  expect(returnBanner({ status: 'ignored', statusAt: '2026-08-08T12:00:00.000Z', estimatedCostUsd: 15, costAtStatusUsd: 0 } as Recommendation)).toBe('Mis en veille le 08/08/2026 — le coût a regrossi depuis.');
});
