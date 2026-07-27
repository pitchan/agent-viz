// Every rule's numbers, translated into French sentences. A rule with no line
// here would be a recommendation without evidence — forbidden by the spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceLines } from '../../public/observatory/evidence.js';

test('R1 states the sessions and the rebuilt-prefix tokens', () => {
  assert.deepEqual(
    evidenceLines({ ruleId: 'R1', evidence: { sessions: ['a', 'b'], prefixChangeTokens: 50000,
      modelSwitchTokens: 40000, shareOfNetPercent: 12 } }),
    ['2 sessions concernées', '50k jetons de préfixe reconstruit', 'dont 40k après un changement de modèle',
      '12 % des jetons nets de ces sessions']);
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

test('an unknown rule still lists its session count instead of nothing', () => {
  assert.deepEqual(evidenceLines({ ruleId: 'RX', evidence: { sessions: ['a'] } }),
    ['1 session concernée']);
});
