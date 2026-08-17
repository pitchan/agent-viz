'use strict';
// R7 — modifications laissées sans vérification (doc/41). Le fait vient du champ
// verification du rapport stocké ; une session d'avant SCAN_VERSION 8 ne l'a
// pas et est écartée, jamais devinée.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const r7 = require('../../src/server/observatory/rules/r7-unverified-tail.ts');
const { THRESHOLDS } = require('../../src/server/observatory/rules/thresholds.ts');

function session(id, verification, { project = 'F--proj', netTokens = 100000, costUsd = 10, costComplete = true } = {}) {
  return {
    id, project, startedAt: '2026-08-01T10:00:00.000Z', endedAt: '2026-08-01T11:00:00.000Z',
    sessionKind: 'interactive', netTokens, costUsd, costComplete,
    report: { verification },
  };
}
const stats = over => ({
  verifications: 1, verificationsFailed: 0,
  lastVerification: { at: '2026-08-01T10:30:00.000Z', kind: 'test', ok: true, command: 'npm test' },
  editsTotal: 3, editsAfterLastVerification: 0, filesAfterLastVerificationTotal: 0,
  tokensAfterLastVerification: 0, ...over,
});
const ctx = sessions => ({ sessions, configItems: [] });

test('R7 vise la session editant sans aucune verification et la queue au-dessus du seuil', () => {
  // Arrange
  const sessions = [
    session('s1', stats({ verifications: 0, lastVerification: null,
      editsAfterLastVerification: 3, filesAfterLastVerificationTotal: 2, tokensAfterLastVerification: 50000 })),
    session('s2', stats({ editsAfterLastVerification: THRESHOLDS.R7.minEditsAfterLastVerification,
      filesAfterLastVerificationTotal: 1, tokensAfterLastVerification: 25000 })),
    session('s3', stats({ editsAfterLastVerification: 2,
      filesAfterLastVerificationTotal: 2, tokensAfterLastVerification: 25000 })),
  ];
  // Act
  const recs = r7.evaluate(ctx(sessions));
  // Assert
  assert.equal(recs.length, 1);
  assert.equal(recs[0].ruleId, 'R7');
  assert.equal(recs[0].subject, 'F--proj');
  assert.equal(recs[0].confidence, 'fait');
  assert.equal(recs[0].costBasis, 'jetons-mesures');
  assert.deepEqual(recs[0].evidence.sessions, ['s1', 's2', 's3']);
  assert.equal(recs[0].evidence.sessionsNoVerification, 1);
  assert.equal(recs[0].evidence.sessionsWithTail, 2);
  assert.equal(recs[0].evidence.filesUnverifiedBySession, 5);
  assert.equal(recs[0].evidence.tokensAfterLastVerification, 100000);
  assert.equal(recs[0].evidence.excludedPendingRescan, 0);
  assert.equal(recs[0].estimatedCostUsd, 10, 'au taux de session 0.0001 $/jeton');
});

test('R7 compte les sessions ecartees faute du champ v8 dans la reco qu elle emet', () => {
  // Arrange — la session ecartee vient EN PREMIER : l agregat du projet doit
  // naitre du point d ecartement sans entrer dans les sessions concernees.
  const sessions = [
    session('vieille', undefined),
    session('s1', stats({ verifications: 0, lastVerification: null,
      editsAfterLastVerification: 3, filesAfterLastVerificationTotal: 2, tokensAfterLastVerification: 50000 })),
    session('s2', stats({ editsAfterLastVerification: 1,
      filesAfterLastVerificationTotal: 1, tokensAfterLastVerification: 25000 })),
    session('s3', stats({ editsAfterLastVerification: 2,
      filesAfterLastVerificationTotal: 2, tokensAfterLastVerification: 25000 })),
  ];
  // Act
  const recs = r7.evaluate(ctx(sessions));
  // Assert
  assert.equal(recs.length, 1);
  assert.equal(recs[0].evidence.excludedPendingRescan, 1);
  assert.deepEqual(recs[0].evidence.sessions, ['s1', 's2', 's3']);
  assert.equal(recs[0].evidence.sessionsNoVerification, 1);
  assert.equal(recs[0].evidence.sessionsWithTail, 2);
  assert.equal(recs[0].evidence.filesUnverifiedBySession, 5);
  assert.equal(recs[0].evidence.tokensAfterLastVerification, 100000);
  assert.equal(recs[0].estimatedCostUsd, 10, 'la session ecartee ne pese pas dans le cout');
});

// F1 (revue doc/41) : la regle ne filtre JAMAIS sur la fin de session — aucun
// test d'endedAt ci-dessus. Une session encore vivante peut donc entrer dans la
// reco, et le titre ne peut pas affirmer une cloture que rien ne mesure.
test('R7 ne titre pas une cloture de session, un fait qu elle ne mesure pas', () => {
  // Arrange
  const sessions = [
    session('s1', stats({ verifications: 0, lastVerification: null,
      editsAfterLastVerification: 3, filesAfterLastVerificationTotal: 2, tokensAfterLastVerification: 50000 })),
    session('s2', stats({ editsAfterLastVerification: 1,
      filesAfterLastVerificationTotal: 1, tokensAfterLastVerification: 25000 })),
    session('s3', stats({ editsAfterLastVerification: 2,
      filesAfterLastVerificationTotal: 2, tokensAfterLastVerification: 25000 })),
  ];
  // Act
  const recs = r7.evaluate(ctx(sessions));
  // Assert
  assert.ok(!/termin|clos/i.test(recs[0].title),
    `le titre affirme une fin de session non mesuree : « ${recs[0].title} »`);
  assert.equal(recs[0].title, 'Sessions laissant des modifications non vérifiées');
});

test('R7 reste muette sous le plancher de sessions par projet', () => {
  // Arrange — DEUX sessions qualifiantes : la frontiere 2 < 3 est exercee, pas
  // le cas trivial d'une seule session.
  const deux = [
    session('s1', stats({ verifications: 0, lastVerification: null,
      editsAfterLastVerification: 3, tokensAfterLastVerification: 50000 })),
    session('s2', stats({ editsAfterLastVerification: 2, tokensAfterLastVerification: 25000 })),
  ];
  // Act + Assert (minSessions vaut 3 par calibration)
  assert.deepEqual(r7.evaluate(ctx(deux)), []);
});

test('R7 ignore les sessions sans edition et les queues sous le seuil', () => {
  // Arrange
  const sessions = [
    session('s1', stats({ verifications: 0, lastVerification: null, editsTotal: 0 })),
    session('s2', stats({ editsAfterLastVerification: THRESHOLDS.R7.minEditsAfterLastVerification - 1 })),
    session('s3', stats()),
  ];
  // Act + Assert
  assert.deepEqual(r7.evaluate(ctx(sessions)), []);
});

test('R7 ecarte une session stockee avant SCAN_VERSION 8, jamais devinee', () => {
  // Arrange — seules des sessions pre-v8 : le compteur d exclusion ne vit que
  // dans une reco emise, il ne fabrique donc aucune carte a lui seul.
  const sessions = [session('s1', undefined), session('s2', undefined)];
  // Act + Assert
  assert.deepEqual(r7.evaluate(ctx(sessions)), []);
});
