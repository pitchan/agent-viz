// R7 — modifications laissées sans vérification. Le fait vient du champ
// verification du rapport stocké ; une session d'avant SCAN_VERSION 8 ne l'a
// pas et est écartée, jamais devinée.

import { expect, test } from 'vitest';
import * as r7 from '../../src/server/observatory/rules/r7-unverified-tail.ts';
import { THRESHOLDS } from '../../src/server/observatory/rules/thresholds.ts';
import type { Session } from '../../src/server/observatory/rules/types.ts';

type Verification = NonNullable<Session['report']['verification']>;

function session(id: string, verification: Verification | undefined, { project = 'F--proj', netTokens = 100000, costUsd = 10, costComplete = true } = {}) {
  return {
    id, project, startedAt: '2026-08-01T10:00:00.000Z', endedAt: '2026-08-01T11:00:00.000Z',
    sessionKind: 'interactive', netTokens, costUsd, costComplete,
    report: { verification },
  } as unknown as Session;
}
const stats = (over: Partial<Verification> = {}): Verification => ({
  verifications: 1, verificationsFailed: 0,
  lastVerification: { at: '2026-08-01T10:30:00.000Z', kind: 'test', ok: true, command: 'npm test' },
  editsTotal: 3, editsAfterLastVerification: 0, filesAfterLastVerificationTotal: 0,
  tokensAfterLastVerification: 0, ...over,
});
const ctx = (sessions: Session[]) => ({ sessions, configItems: [] });

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
  expect(recs.length).toBe(1);
  expect(recs[0]!.ruleId).toBe('R7');
  expect(recs[0]!.subject).toBe('F--proj');
  expect(recs[0]!.confidence).toBe('fait');
  expect(recs[0]!.costBasis).toBe('jetons-mesures');
  expect(recs[0]!.evidence.sessions).toEqual(['s1', 's2', 's3']);
  expect(recs[0]!.evidence.sessionsNoVerification).toBe(1);
  expect(recs[0]!.evidence.sessionsWithTail).toBe(2);
  expect(recs[0]!.evidence.filesUnverifiedBySession).toBe(5);
  expect(recs[0]!.evidence.tokensAfterLastVerification).toBe(100000);
  expect(recs[0]!.evidence.excludedPendingRescan).toBe(0);
  expect(recs[0]!.estimatedCostUsd, 'au taux de session 0.0001 $/jeton').toBe(10);
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
  expect(recs.length).toBe(1);
  expect(recs[0]!.evidence.excludedPendingRescan).toBe(1);
  expect(recs[0]!.evidence.sessions).toEqual(['s1', 's2', 's3']);
  expect(recs[0]!.evidence.sessionsNoVerification).toBe(1);
  expect(recs[0]!.evidence.sessionsWithTail).toBe(2);
  expect(recs[0]!.evidence.filesUnverifiedBySession).toBe(5);
  expect(recs[0]!.evidence.tokensAfterLastVerification).toBe(100000);
  expect(recs[0]!.estimatedCostUsd, 'la session ecartee ne pese pas dans le cout').toBe(10);
});

// La regle ne filtre JAMAIS sur la fin de session — aucun
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
  expect(!/termin|clos/i.test(recs[0]!.title), `le titre affirme une fin de session non mesuree : « ${recs[0]!.title} »`).toBeTruthy();
  expect(recs[0]!.title).toBe('Sessions laissant des modifications non vérifiées');
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
  expect(r7.evaluate(ctx(deux))).toEqual([]);
});

test('R7 ignore les sessions sans edition et les queues sous le seuil', () => {
  // Arrange
  const sessions = [
    session('s1', stats({ verifications: 0, lastVerification: null, editsTotal: 0 })),
    session('s2', stats({ editsAfterLastVerification: THRESHOLDS.R7.minEditsAfterLastVerification - 1 })),
    session('s3', stats()),
  ];
  // Act + Assert
  expect(r7.evaluate(ctx(sessions))).toEqual([]);
});

test('R7 ecarte une session stockee avant SCAN_VERSION 8, jamais devinee', () => {
  // Arrange — seules des sessions pre-v8 : le compteur d exclusion ne vit que
  // dans une reco emise, il ne fabrique donc aucune carte a lui seul.
  const sessions = [session('s1', undefined), session('s2', undefined)];
  // Act + Assert
  expect(r7.evaluate(ctx(sessions))).toEqual([]);
});
