// Every rule's numbers, translated into French sentences. A rule with no line
// here would be a recommendation without evidence — forbidden by the spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceLines } from '../../src/web/observatory/evidence.js';

test('R1 states the sessions, the rebuilt-prefix tokens and the journaled marker', () => {
  assert.deepEqual(
    evidenceLines({ ruleId: 'R1', evidence: { sessions: ['a', 'b'], prefixChangeTokens: 50000,
      markerTokens: { modelSwitch: 40000, toolsAppeared: 0, noMarker: 10000 }, dominantMarker: 'modelSwitch',
      depthTokens: { facade: 5000, d10to50: 40000, d50to90: 5000, tail: 0 }, dominantDepth: 'd10to50',
      shareOfNetPercent: 12 } }),
    ['2 sessions concernées', '50k jetons de préfixe reconstruit',
      'marqueur dominant : changement de modèle — mécanisme certain, un cache par modèle (40k jetons)',
      'cassure entre 10 et 50 % de profondeur (40k jetons)',
      '12 % des jetons nets de ces sessions']);
});

// Corrected 2026-08-05: "cause dominante" asserted causality the measurement
// does not carry. Only modelSwitch has a proven mechanism; toolsAppeared is a
// temporal coincidence (official docs: deferred tool loading preserves the
// cache), so the wording must not read as a cause.
test('R1 presents toolsAppeared as an observed coincidence, never as a cause', () => {
  const lines = evidenceLines({ ruleId: 'R1', evidence: { sessions: ['a'], prefixChangeTokens: 50000,
    markerTokens: { modelSwitch: 0, toolsAppeared: 50000, noMarker: 0 }, dominantMarker: 'toolsAppeared',
    depthTokens: { facade: 50000, d10to50: 0, d50to90: 0, tail: 0 }, dominantDepth: 'facade',
    shareOfNetPercent: 30 } });
  assert.equal(lines[2],
    'marqueur dominant : chargement d’outils différés — coïncidence observée, sans mécanisme établi (50k jetons)');
  assert.ok(!lines.some(l => l.includes('cause dominante')));
});

// The case that made the fix necessary: no journaled cause must read as such,
// never as a model switch measured at zero.
test('R1 says so plainly when no marker explains the break', () => {
  assert.deepEqual(
    evidenceLines({ ruleId: 'R1', evidence: { sessions: ['a'], prefixChangeTokens: 25261379,
      markerTokens: { modelSwitch: 0, toolsAppeared: 31117, noMarker: 25261379 }, dominantMarker: 'noMarker',
      depthTokens: { facade: 5754305, d10to50: 16971946, d50to90: 2469673, tail: 96572 },
      dominantDepth: 'd10to50', shareOfNetPercent: 54 } }),
    ['1 session concernée', '25.3M jetons de préfixe reconstruit',
      'marqueur dominant : aucun marqueur journalisé (25.3M jetons)',
      'cassure entre 10 et 50 % de profondeur (17.0M jetons)',
      '54 % des jetons nets de ces sessions']);
});

test('R2 states loaded versus called, and that the inventory is a snapshot', () => {
  assert.deepEqual(
    evidenceLines({ ruleId: 'R2', evidence: { sessions: ['a'], loadedSessions: 10, usedSessions: 0,
      inventorySnapshot: true } }),
    ['1 session concernée', 'chargé dans 10 sessions, appelé dans 0',
      'configuration actuelle appliquée à la période (photo, pas historique)']);
});

test('R3 names the volume and the repetition', () => {
  assert.deepEqual(
    evidenceLines({ ruleId: 'R3', evidence: { sessions: ['a'], bytes: 204800, count: 6,
      shareOfToolBytesPercent: 20 } }),
    ['1 session concernée', '6 occurrences', '200 Ko de sortie', '20 % des sorties d’outils de la période']);
});

test('R4 names the duplicated volume and its share', () => {
  assert.deepEqual(
    evidenceLines({ ruleId: 'R4', evidence: { sessions: ['a'], duplicateBytes: 512000,
      duplicateCount: 12, shareOfReadBytesPercent: 25 } }),
    ['1 session concernée', '500 Ko relus par un autre agent', '12 relectures', '25 % du volume lu']);
});

test('R5 counts compactions and never turns an unknown into a zero', () => {
  assert.deepEqual(
    evidenceLines({ ruleId: 'R5', evidence: { sessions: ['a'], compactions: 4,
      compactionsWithoutTokenCount: 1, reprocessedTokens: 250000 } }),
    ['1 session concernée', '4 compactions', '250k jetons re-traités',
      '1 compaction dont le volume est inconnu (non comptée)']);
});

// Token counts go through formatTokens, the formatter the canvas view already
// uses: 1800 reads "1.8k" everywhere in the product, never "1800" here and
// "1.8k" one panel away.
test('R6 states the spawns, the median duration and the subagent tokens', () => {
  assert.deepEqual(
    evidenceLines({ ruleId: 'R6', evidence: { sessions: ['a', 'b'], spawns: 3,
      medianDurationSeconds: 120, subagentTokens: 1800 } }),
    ['2 sessions concernées', '3 sous-agents lancés', 'sessions de 120 s (médiane)',
      '1.8k jetons de sous-agents']);
});

test('several compactions of unknown volume agree in the plural', () => {
  const lines = evidenceLines({ ruleId: 'R5', evidence: { sessions: ['a'], compactions: 5,
    compactionsWithoutTokenCount: 2, reprocessedTokens: 100000 } });
  assert.equal(lines.at(-1), '2 compactions dont le volume est inconnu (non comptées)');
});

test('R1 shows the earlyMcp line only when tokens are there, always with the étude label', () => {
  const base = {
    sessions: ['a'], prefixChangeTokens: 1000, dominantMarker: 'noMarker',
    markerTokens: { modelSwitch: 0, toolsAppeared: 0, noMarker: 800 },
    depthTokens: { facade: 800, d10to50: 0, d50to90: 0, tail: 0 }, dominantDepth: 'facade',
    shareOfNetPercent: 12,
  };
  const withEarly = evidenceLines({ ruleId: 'R1',
    evidence: { ...base, noMarkerDetailTokens: { earlyMcp: 600, other: 200 } } });
  const line = withEarly.find(l => l.includes('début de session à serveurs MCP'));
  assert.ok(line, 'the position line must appear');
  assert.ok(line.includes('cause probable (étude'), 'the study label is mandatory');
  assert.ok(line.includes('×6,3'), 'the correlation figure is named');

  const without = evidenceLines({ ruleId: 'R1',
    evidence: { ...base, noMarkerDetailTokens: { earlyMcp: 0, other: 800 } } });
  assert.ok(!without.some(l => l.includes('serveurs MCP')), 'zero earlyMcp: no line');

  const legacy = evidenceLines({ ruleId: 'R1', evidence: base });
  assert.ok(!legacy.some(l => l.includes('serveurs MCP')),
    'an M1-era evidence without the field never crashes nor lies');
});

test('an unknown rule still lists its session count instead of nothing', () => {
  assert.deepEqual(evidenceLines({ ruleId: 'RX', evidence: { sessions: ['a'] } }),
    ['1 session concernée']);
});

// Fixture autonome : la forme d'evidence R1 que consomme evidenceLines.
const recR1 = dominantMarker => ({
  ruleId: 'R1',
  evidence: {
    sessions: ['s1'],
    prefixChangeTokens: 1000, shareOfNetPercent: 10,
    dominantMarker,
    markerTokens: { modelSwitch: 600, toolsAppeared: 300, noMarker: 100 },
    dominantDepth: 'facade',
    depthTokens: { facade: 500, d10to50: 300, d50to90: 100, tail: 100 },
  },
});

test('les trois marqueurs R1 gardent leur statut epistemique — contractuel (doc/32)', () => {
  const attendus = {
    modelSwitch: /changement de modèle — mécanisme certain/,
    toolsAppeared: /coïncidence observée, sans mécanisme établi/,
    noMarker: /aucun marqueur journalisé/,
  };
  for (const [marker, motif] of Object.entries(attendus)) {
    const lignes = evidenceLines(recR1(marker));
    assert.ok(lignes.some(l => motif.test(l)),
      `${marker} : la formulation contractuelle a disparu — la causalite n'est permise que pour modelSwitch`);
  }
});

// Fixture autonome : la forme d'evidence R7 (doc/41) que consomme evidenceLines.
const recR7 = excludedPendingRescan => ({
  ruleId: 'R7',
  evidence: {
    sessions: ['s1', 's2', 's3'],
    sessionsNoVerification: 1,
    sessionsWithTail: 2,
    filesUnverifiedBySession: 7,
    tokensAfterLastVerification: 184000,
    excludedPendingRescan,
    costComplete: true,
  },
});

test('R7 met la queue non verifiee en francais, sans accuser de gaspillage', () => {
  // Arrange
  const rec = recR7(0);
  // Act
  const lines = evidenceLines(rec);
  // Assert
  assert.equal(lines[0], '3 sessions concernées');
  assert.ok(lines.some(l => l.includes('sans aucune vérification')));
  assert.ok(lines.some(l => l.includes('postérieures à la dernière vérification')));
  assert.ok(lines.some(l => l.includes('7 fichiers')));
  assert.ok(lines.some(l => l.includes('travail à risque, pas gaspillage prouvé')));
  assert.ok(!lines.some(l => l.includes('ré-analyse')),
    'aucune session ecartee : pas de ligne de re-analyse, pas de zero decoratif');
});

// F1 (revue doc/41) : « close » affirmait une cloture que le capteur ne mesure
// pas — la regle ne teste jamais la fin de session, une session encore vivante
// dont les dernieres editions ne sont pas verifiees entre dans sessionsWithTail.
test('R7 ne declare jamais la session close — la cloture n est pas mesuree', () => {
  // Arrange
  const rec = recR7(0);
  // Act
  const lines = evidenceLines(rec);
  // Assert
  assert.ok(!lines.some(l => l.includes('close')),
    `la carte affirme une cloture non mesuree : ${JSON.stringify(lines)}`);
  assert.ok(lines.includes('2 sessions avec des modifications postérieures à la dernière vérification'),
    `le fait lui-meme doit rester dit : ${JSON.stringify(lines)}`);
});

// Precedent R5 : un inconnu se dit, il ne se fond jamais dans un zero. Ces
// sessions sont indecidables par construction (stockees avant la re-analyse),
// donc la ligne ne les declare pas « concernees ».
test('R7 dit les sessions en attente de re-analyse au lieu de les taire', () => {
  // Arrange
  const rec = recR7(2);
  // Act
  const lines = evidenceLines(rec);
  // Assert
  assert.ok(lines.some(l => l.includes('2 sessions en attente de ré-analyse')),
    `la ligne de re-analyse manque : ${JSON.stringify(lines)}`);
});
