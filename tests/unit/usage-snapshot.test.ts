// Les jetons d'un agent qui les tient hors du transcript, appliqués à l'état d'une session.
import { expect, test } from 'vitest';
import { applyUsageSnapshot } from '../../src/server/usage-snapshot.ts';
import { ensureTokens } from '../../src/server/tokens.ts';
import type { UsageSnapshot, UsageSnapshotSource } from '../../src/server/transcript-adapters/types.ts';

function jetons(): any {
  const rec: { tokens?: any } = {};
  ensureTokens(rec);
  return rec.tokens;
}

const APPEL_1 = { id: 'bot-a', model: 'gemini-3.8-flash', usage: { input_tokens: 12087, output_tokens: 749, cache_read_input_tokens: 0 } };
const APPEL_2 = { id: 'bot-b', model: 'gemini-3.8-flash', usage: { input_tokens: 3044, output_tokens: 2571, cache_read_input_tokens: 16264 } };

// Une source dont le test fixe l'empreinte et la lecture de chaque passage.
function source(passages: Array<{ stamp: string | null; read?: UsageSnapshot | Error }>): UsageSnapshotSource & { lectures: number } {
  let i = 0;
  const s = {
    lectures: 0,
    stamp: () => passages[Math.min(i, passages.length - 1)]!.stamp,
    read: () => {
      s.lectures += 1;
      const resultat = passages[Math.min(i, passages.length - 1)]!.read;
      i += 1;
      if (resultat instanceof Error) throw resultat;
      if (!resultat) throw new Error('lecture non prévue par le test');
      return resultat;
    },
  };
  return s;
}

test('les appels lus sont cumulés, et le dernier donne la taille du contexte', () => {
  // Arrange
  const t = jetons();
  const s = source([{ stamp: 'a', read: { ok: true, calls: [APPEL_1, APPEL_2] } }]);
  // Act
  const change = applyUsageSnapshot('session-1', t, s, '/t.jsonl', () => {});
  // Assert
  expect(change).toBe(true);
  expect(t.main.in).toBe(12087 + 3044);
  expect(t.main.out).toBe(749 + 2571);
  expect(t.main.cacheRead).toBe(16264);
  expect(t.main.lastIn + t.main.lastCacheRead).toBe(3044 + 16264);
  expect(t.main.lastModel).toBe('gemini-3.8-flash');
});

test('un modèle sans tarif connu laisse le coût incomplet plutôt que nul', () => {
  // Arrange
  const t = jetons();
  const s = source([{ stamp: 'a', read: { ok: true, calls: [APPEL_1] } }]);
  // Act
  applyUsageSnapshot('session-1', t, s, '/t.jsonl', () => {});
  // Assert
  expect(t.main.costComplete).toBe(false);
  expect(t.main.unknownModels).toEqual(['gemini-3.8-flash']);
});

test('relire les mêmes appels avec un appel de plus ne compte que le nouveau', () => {
  // Arrange
  const t = jetons();
  const s = source([
    { stamp: 'a', read: { ok: true, calls: [APPEL_1] } },
    { stamp: 'b', read: { ok: true, calls: [APPEL_1, APPEL_2] } },
  ]);
  applyUsageSnapshot('session-1', t, s, '/t.jsonl', () => {});
  // Act
  applyUsageSnapshot('session-1', t, s, '/t.jsonl', () => {});
  // Assert
  expect(t.main.in).toBe(12087 + 3044);
});

test('une empreinte inchangée ne déclenche aucune relecture', () => {
  // Arrange
  const t = jetons();
  const s = source([{ stamp: 'a', read: { ok: true, calls: [APPEL_1] } }]);
  applyUsageSnapshot('session-1', t, s, '/t.jsonl', () => {});
  // Act
  const change = applyUsageSnapshot('session-1', t, s, '/t.jsonl', () => {});
  // Assert
  expect(change).toBe(false);
  expect(s.lectures).toBe(1);
});

test('un format refusé bascule la session sur « non disponible » et le journalise', () => {
  // Arrange
  const t = jetons();
  const journal: string[] = [];
  const s = source([{ stamp: 'a', read: { ok: false, reason: 'appel 3 : champ inconnu .1.4.12' } }]);
  // Act
  const change = applyUsageSnapshot('session-1', t, s, '/t.jsonl', l => journal.push(l));
  // Assert
  expect(change).toBe(true);
  expect(t.unsupported).toBe(true);
  expect(journal).toEqual(['[tokens] session-: usage snapshot rejected — appel 3 : champ inconnu .1.4.12']);
});

test('après un format refusé, plus aucune lecture n\'est tentée', () => {
  // Arrange
  const t = jetons();
  const s = source([
    { stamp: 'a', read: { ok: false, reason: 'bloc illisible' } },
    { stamp: 'b', read: { ok: true, calls: [APPEL_1] } },
  ]);
  applyUsageSnapshot('session-1', t, s, '/t.jsonl', () => {});
  // Act
  const change = applyUsageSnapshot('session-1', t, s, '/t.jsonl', () => {});
  // Assert
  expect(change).toBe(false);
  expect(t.main.in).toBe(0);
});

test('une lecture qui échoue garde l\'état et sera retentée à l\'événement suivant', () => {
  // Arrange
  const t = jetons();
  const journal: string[] = [];
  const s = source([
    { stamp: 'a', read: new Error('database is locked') },
    { stamp: 'a', read: { ok: true, calls: [APPEL_1] } },
  ]);
  applyUsageSnapshot('session-1', t, s, '/t.jsonl', l => journal.push(l));
  // Act
  const change = applyUsageSnapshot('session-1', t, s, '/t.jsonl', l => journal.push(l));
  // Assert
  expect(change).toBe(true);
  expect(t.main.in).toBe(12087);
  expect(t.unsupported).toBeUndefined();
  expect(journal).toEqual(['[tokens] session-: usage snapshot unreadable — database is locked']);
});

test('tant que la base n\'existe pas, rien n\'est lu ni diffusé', () => {
  // Arrange
  const t = jetons();
  const s = source([{ stamp: null }]);
  // Act
  const change = applyUsageSnapshot('session-1', t, s, '/t.jsonl', () => {});
  // Assert
  expect(change).toBe(false);
  expect(s.lectures).toBe(0);
});
