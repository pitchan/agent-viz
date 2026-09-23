import { expect, test } from 'vitest';
import { addUsage, emptyUsageBucket } from '../../src/engine/core/usage.ts';

// Les gardes de l'usage vivent a un seul endroit : le serveur (src/server/tokens.ts,
// `accumulateUsage`) et les agregateurs du moteur importent ces fonctions, donc une garde
// changee ici change les deux cotes a la fois.

test('accumule les six champs', () => {
  const b = emptyUsageBucket();
  addUsage(b, {
    input_tokens: 10, output_tokens: 5,
    cache_creation_input_tokens: 100, cache_read_input_tokens: 7,
    cache_creation: { ephemeral_1h_input_tokens: 60, ephemeral_5m_input_tokens: 40 },
  });
  expect(b).toEqual({ in: 10, out: 5, cacheCreate: 100, cacheRead: 7, cacheCreate1h: 60, cacheCreate5m: 40 });
});

test('cumule d\'un message a l\'autre', () => {
  const b = emptyUsageBucket();
  addUsage(b, { input_tokens: 10 });
  addUsage(b, { input_tokens: 5 });
  expect(b.in).toBe(15);
});

test('un champ absent ou nul vaut zero', () => {
  const b = emptyUsageBucket();
  addUsage(b, {});
  addUsage(b, { input_tokens: undefined, output_tokens: undefined });
  expect(b).toEqual(emptyUsageBucket());
});

// Un champ qui n'est pas un compte (entier >= 0) vaut zero : ni `|| 0`, qui laisse passer
// une chaine, ni `?? 0`, qui laisse passer NaN, ne couvrent tous les poisons.
test('NaN vaut zero, il n\'empoisonne pas le seau', () => {
  const b = emptyUsageBucket();
  addUsage(b, { input_tokens: NaN, output_tokens: 5 });
  addUsage(b, { input_tokens: 10 });
  expect(b.in).toBe(10);
  expect(Number.isNaN(b.in)).toBe(false);
});

// `1e999` est du JSON valide et s'analyse en Infinity, la ou le litteral `NaN` est
// refuse : c'est le poison numerique qu'un transcript peut vraiment porter.
test('Infinity vaut zero — c\'est le poison qu\'un JSON valide peut porter', () => {
  const b = emptyUsageBucket();
  expect(JSON.parse('{"input_tokens":1e999}').input_tokens).toBe(Infinity);
  addUsage(b, JSON.parse('{"input_tokens":1e999,"output_tokens":5}'));
  expect(b.in).toBe(0);
  expect(b.out).toBe(5);
});

// `0 + "100"` concatene : sans cette garde, le seau passerait en texte pour toute la
// session, jusque dans l'enveloppe SSE. Un nombre en chaine est un champ malforme.
test('un nombre en chaine vaut zero, il ne transforme pas le seau en texte', () => {
  const b = emptyUsageBucket();
  addUsage(b, { input_tokens: '100' as unknown as number, output_tokens: 5 });
  expect(b.in).toBe(0);
  expect(typeof b.in).toBe('number');
});

// Additionner un negatif retrancherait des jetons comptes sur d'autres
// messages : le total ne serait plus une borne inferieure.
test('un nombre negatif n\'est pas un compte : il vaut zero', () => {
  // Arrange
  const b = emptyUsageBucket();

  // Act
  addUsage(b, { input_tokens: -10, output_tokens: 5 });

  // Assert
  expect(b.in).toBe(0);
  expect(b.out).toBe(5);
});

test('la ventilation de cache est independante du total de creation', () => {
  // Le moteur suit les deux fenetres SANS que leur somme doive valoir
  // cache_creation_input_tokens : ce sont deux champs bruts distincts, et la
  // primitive ne reconcilie rien.
  const b = emptyUsageBucket();
  addUsage(b, { cache_creation_input_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: 10 } });
  expect(b.cacheCreate).toBe(100);
  expect(b.cacheCreate1h).toBe(10);
  expect(b.cacheCreate5m).toBe(0);
});
