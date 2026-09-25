// normalizeModel réduit un identifiant de modèle à sa forme canonique : c'est cette
// réduction que le moteur applique avant de chercher un tarif. Ce qui en sort inchangé
// et hors table est dit inconnu, jamais tarifé par défaut.
import { expect, test } from 'vitest';
import { computeCost, normalizeModel, pricingKindOf } from '../../src/engine/core/pricing.ts';

test('retire suffixe [1m], préfixes transport, dates et versions', () => {
  expect(normalizeModel('claude-opus-4-8[1m]')).toBe('claude-opus-4-8');
  expect(normalizeModel('anthropic/claude-opus-4-8')).toBe('claude-opus-4-8');
  expect(normalizeModel('bedrock/claude-opus-4-7-v1:0')).toBe('claude-opus-4-7');
  expect(normalizeModel('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5');
  expect(normalizeModel('claude-haiku-4-5@20251001')).toBe('claude-haiku-4-5');
  expect(normalizeModel(null)).toBeNull();
  expect(normalizeModel('')).toBeNull();
});

// Le serveur et le moteur tarifent avec CETTE normalisation (src/server/pricing.ts
// l'importe) : un identifiant de routage régional ou de transport (Bedrock, Vertex) doit
// s'y réduire à sa forme canonique, sinon son coût est dit inconnu.
test('retire le préfixe de routeur régional', () => {
  expect(normalizeModel('us.anthropic.claude-opus-4-7')).toBe('claude-opus-4-7');
  expect(normalizeModel('eu.anthropic.claude-haiku-4-5')).toBe('claude-haiku-4-5');
  expect(normalizeModel('global.anthropic.claude-sonnet-4-5')).toBe('claude-sonnet-4-5');
  expect(normalizeModel('au.anthropic.claude-opus-5')).toBe('claude-opus-5');
});

test('retire DEUX préfixes empilés, pas seulement le premier', () => {
  // Une alternance appliquée une seule fois retirerait `bedrock/` et laisserait
  // `anthropic.` : l'identifiant resterait inconnu.
  expect(normalizeModel('bedrock/anthropic.claude-opus-4-7-v1:0')).toBe('claude-opus-4-7');
  expect(normalizeModel('vertex_ai/anthropic.claude-opus-5')).toBe('claude-opus-5');
});

test('retire un suffixe de version -vN seul, pas seulement -vN:M', () => {
  expect(normalizeModel('claude-opus-4-5-v1')).toBe('claude-opus-4-5');
  expect(normalizeModel('claude-opus-4-5-v1:0')).toBe('claude-opus-4-5');
});

test('TÉMOIN NÉGATIF : élargir la normalisation ne rend pas tout connu', () => {
  // Sans ce témoin on écrirait « les identifiants régionaux sont reconnus »,
  // plus large que le fait : ce qui est reconnu, c'est le PRÉFIXE, et le
  // modèle dessous doit toujours figurer à la table.
  expect(normalizeModel('us.anthropic.claude-opus-99-9')).toBe('claude-opus-99-9');
  expect(pricingKindOf('us.anthropic.claude-opus-99-9', undefined, undefined)).toBe('inconnu');
  expect(computeCost({ input_tokens: 10 }, 'us.anthropic.claude-opus-99-9').known).toBe(false);
  // Et un préfixe qui n'est pas un routeur connu n'est pas retiré.
  expect(normalizeModel('zz.anthropic.claude-opus-5')).toBe('zz.anthropic.claude-opus-5');
});

test('un identifiant régional est tarifé comme sa forme canonique', () => {
  const usage = { input_tokens: 1000, output_tokens: 500 };
  const regional = computeCost(usage, 'us.anthropic.claude-opus-4-7');
  const canonique = computeCost(usage, 'claude-opus-4-7');
  expect(regional.known).toBe(true);
  expect(regional.usd).toBe(canonique.usd);
  expect(pricingKindOf('us.anthropic.claude-opus-4-7', undefined, undefined)).toBe('tarife');
});
