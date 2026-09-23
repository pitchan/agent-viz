// Un prix adopté s'ajoute à la table embarquée sans jamais la contredire :
// la table reprend la main dès qu'elle couvre le modèle ou change le tarif remplacé.
import { expect, test } from 'vitest';
import { createPricing } from '../../src/engine/core/pricing.ts';
import type { AdoptedPrice } from '../../src/engine/core/pricing.ts';

const usage = { input_tokens: 1_000_000 };
const OPUS_5 = { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7 };

function adoption(over: Partial<AdoptedPrice> = {}): AdoptedPrice {
  return {
    prices: { input: 4e-6, output: 2e-5, cacheCreate: 5e-6, cacheRead: 2e-7 },
    maxInput: 1_000_000, from: null, replaces: null,
    adoptedAt: '2026-09-23T10:00:00.000Z', source: 'anthropic', ...over,
  };
}

test('un modèle nouveau adopté est tarifé pour tout message', () => {
  // Arrange
  const pricing = createPricing({ 'claude-opus-6': [adoption()] });

  // Act
  const r = pricing.computeCost(usage, 'claude-opus-6', '2020-01-01T00:00:00.000Z');

  // Assert
  expect(r).toMatchObject({ known: true, model: 'claude-opus-6' });
  expect(r.usd).toBeCloseTo(4, 12);
});

test('une adoption « modèle nouveau » est ignorée dès que la table embarquée porte le modèle', () => {
  // Arrange
  const pricing = createPricing({ 'claude-opus-5': [adoption()] });

  // Act
  const r = pricing.computeCost(usage, 'claude-opus-5');

  // Assert
  expect(r.usd).toBeCloseTo(5, 12);
});

test('un tarif différent adopté vaut à partir de `from`', () => {
  // Arrange
  const pricing = createPricing({ 'claude-opus-5': [adoption({ from: '2026-09-20T00:00:00.000Z', replaces: OPUS_5 })] });

  // Act
  const r = pricing.computeCost(usage, 'claude-opus-5', '2026-09-21T00:00:00.000Z');

  // Assert
  expect(r.usd).toBeCloseTo(4, 12);
});

test('avant `from`, le tarif embarqué reste appliqué', () => {
  // Arrange
  const pricing = createPricing({ 'claude-opus-5': [adoption({ from: '2026-09-20T00:00:00.000Z', replaces: OPUS_5 })] });

  // Act
  const r = pricing.computeCost(usage, 'claude-opus-5', '2026-09-19T00:00:00.000Z');

  // Assert
  expect(r.usd).toBeCloseTo(5, 12);
});

test('un tarif différent est ignoré quand le tarif embarqué n’est plus celui qu’il remplaçait', () => {
  // Arrange
  const autre = { ...OPUS_5, input: 9e-6 };
  const pricing = createPricing({ 'claude-opus-5': [adoption({ from: '2026-09-20T00:00:00.000Z', replaces: autre })] });

  // Act
  const r = pricing.computeCost(usage, 'claude-opus-5', '2026-09-21T00:00:00.000Z');

  // Assert
  expect(r.usd).toBeCloseTo(5, 12);
});

test('priceTable liste le modèle adopté, marqué, avec un libellé lisible', () => {
  // Arrange
  const pricing = createPricing({ 'claude-opus-6': [adoption()] });

  // Act
  const e = pricing.priceTable().entries.find((x) => x.model === 'claude-opus-6');

  // Assert
  expect(e).toMatchObject({
    label: 'Opus 6', maxInput: 1_000_000, history: [],
    adopted: { source: 'anthropic', adoptedAt: '2026-09-23T10:00:00.000Z', from: null },
  });
});

test('priceTable range l’ancien tarif d’un tarif différent adopté dans l’historique', () => {
  // Arrange
  const pricing = createPricing({ 'claude-opus-5': [adoption({ from: '2026-09-20T00:00:00.000Z', replaces: OPUS_5 })] });

  // Act
  const e = pricing.priceTable().entries.find((x) => x.model === 'claude-opus-5');

  // Assert
  expect(e?.current.input).toBe(4e-6);
  expect(e?.history).toEqual([{ until: '2026-09-20T00:00:00.000Z', prices: OPUS_5 }]);
});

test('un modèle non adopté porte `adopted: null`', () => {
  // Arrange
  const pricing = createPricing({});

  // Act
  const e = pricing.priceTable().entries.find((x) => x.model === 'claude-opus-5');

  // Assert
  expect(e?.adopted).toBeNull();
});

test('un id qui est une propriété héritée d’objet reste inconnu', () => {
  // Arrange
  const pricing = createPricing({});

  // Act
  const r = pricing.computeCost(usage, 'constructor');

  // Assert
  expect(r).toMatchObject({ usd: null, known: false });
});

test('la frontière `from` est inclusive : un message à l’instant même prend le nouveau tarif', () => {
  // Arrange
  const pricing = createPricing({ 'claude-opus-5': [adoption({ from: '2026-09-20T00:00:00.000Z', replaces: OPUS_5 })] });

  // Act
  const r = pricing.computeCost(usage, 'claude-opus-5', '2026-09-20T00:00:00.000Z');

  // Assert
  expect(r.usd).toBeCloseTo(4, 12);
});
