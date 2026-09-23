// Ce que ce fichier protege : ce que DIT la pastille TOTAL du bandeau, la seule.
// Elle parle de la session entiere, sous-agents compris : la somme des tailles de
// conversation (cache compris) et le cout.
//
// Le module est pur : aucun test unitaire de ce repo ne rend le DOM, c'est donc ici
// que les chiffres et les mots de cette pastille sont epingles.

import { expect, test } from 'vitest';
import { budgetPresentation, type BudgetPresentation } from '../../src/web/viz-budget-format.ts';
import type { TokenBucket } from '../../src/web/viz-state.ts';

// Un seau tel que le serveur l'envoie ; chaque test ne nomme que ce qui l'en ecarte.
const seau = (champs: Partial<TokenBucket> = {}): TokenBucket => ({
  in: 0, out: 0, cacheCreate: 0, cacheRead: 0,
  lastIn: 0, lastCacheCreate: 0, lastCacheRead: 0,
  lastModel: 'claude-opus-5-5', contextMax: 1_000_000, costUsd: 0,
  costComplete: true, unknownModels: [], malformedUsageMessages: 0,
  ...champs,
});

const jetons = (main: TokenBucket | null, agents: TokenBucket[] = [], etat: { tokensSupported?: boolean | null; transcriptMissing?: boolean } = {}) => ({
  main,
  perAgent: new Map(agents.map((b, i): [string, TokenBucket] => [`agent-${i}`, b])),
  tokensSupported: true as boolean | null,
  transcriptMissing: false,
  ...etat,
});

function mesure(p: BudgetPresentation) {
  if (p.kind !== 'measured') throw new Error(`attendu « measured », recu « ${p.kind} »`);
  return p;
}

// ─── Les jetons : la somme des tailles de conversation ──────────────────────

test('sans sous-agent, les jetons de TOTAL egalent la taille de la conversation, cache compris', () => {
  // Arrange — le cumul (in, cacheRead...) est enorme et ne doit pas compter
  const t = jetons(seau({
    lastIn: 2, lastCacheCreate: 928, lastCacheRead: 95_070,
    in: 32, cacheCreate: 54_280, cacheRead: 1_395_775, out: 6_248,
  }));
  // Act
  const p = mesure(budgetPresentation(t));
  // Assert — 2 + 928 + 95 070 ; le cumul donnerait 1.5M
  expect(p.tokens).toBe('96k');
});

test('TOTAL additionne la taille de conversation du fil principal et de chaque sous-agent', () => {
  // Arrange
  const t = jetons(
    seau({ lastIn: 1_000, lastCacheRead: 95_000 }),
    [seau({ lastCacheCreate: 20_000, lastCacheRead: 500 }), seau({ lastIn: 14_500, cacheRead: 9_000_000 })],
  );
  // Act
  const p = mesure(budgetPresentation(t));
  // Assert — 96 000 + 20 500 + 14 500
  expect(p.tokens).toBe('131k');
});

test('l infobulle donne le total en entier puis une ligne par conversation avec son modele', () => {
  // Arrange
  const t = jetons(
    seau({ lastIn: 96_012, lastModel: 'claude-opus-5-5' }),
    [seau({ lastIn: 20_540, lastModel: 'claude-haiku-4-5' })],
  );
  // Act
  const p = mesure(budgetPresentation(t));
  // Assert
  expect(p.title).toContain(`Jetons (taille des conversations, cache compris) : ${(116_552).toLocaleString()}`);
  expect(p.title).toContain(`fil principal (Opus 5.5) : ${(96_012).toLocaleString()}`);
  expect(p.title).toContain(`sous-agent (Haiku 4.5) : ${(20_540).toLocaleString()}`);
});

test('l infobulle nomme combien de sous-agents elle couvre', () => {
  // Arrange
  const trois = jetons(seau(), [seau(), seau(), seau()]);
  const un = jetons(seau(), [seau()]);
  const aucun = jetons(seau());
  // Act
  const titres = [trois, un, aucun].map(t => mesure(budgetPresentation(t)).title);
  // Assert
  expect(titres[0]).toContain('fil principal + 3 sous-agents');
  expect(titres[1]).toContain('fil principal + 1 sous-agent\n');
  expect(titres[2]).toContain('fil principal, aucun sous-agent');
});

// ─── Le cout : la session entiere ───────────────────────────────────────────

test('TOTAL additionne le cout du fil principal et de chaque sous-agent', () => {
  // Arrange
  const t = jetons(seau({ costUsd: 1.12 }), [seau({ costUsd: 2.00 }), seau({ costUsd: 0.09 })]);
  // Act
  const p = mesure(budgetPresentation(t));
  // Assert
  expect(p.cost).toBe('$3.21');
});

test('un sous-agent sans tarif rend le cout de TOTAL partiel et nomme le modele', () => {
  // Arrange
  const t = jetons(
    seau({ costUsd: 1.12 }),
    [seau({ costUsd: 0.5, costComplete: false, unknownModels: ['claude-inconnu'] })],
  );
  // Act
  const p = mesure(budgetPresentation(t));
  // Assert
  expect(p.cost).toBe('au moins $1.62');
  expect(p.title).toContain('claude-inconnu');
});

test('un usage inexploitable previent que les jetons et le cout reels peuvent etre plus eleves', () => {
  // Arrange
  const t = jetons(seau({ costUsd: 1 }), [seau({ costUsd: 1, costComplete: false, malformedUsageMessages: 2 })]);
  // Act
  const p = mesure(budgetPresentation(t));
  // Assert
  expect(p.title).toContain('Les jetons et le coût réels peuvent être plus élevés.');
});

// ─── Les etats ou il n'y a rien a mesurer ───────────────────────────────────

test('fournisseur sans jetons : la pastille le dit', () => {
  // Arrange
  const t = jetons(null, [], { tokensSupported: false });
  // Act
  const p = budgetPresentation(t);
  // Assert
  expect(p).toMatchObject({ kind: 'unavailable', text: 'Tokens N/A' });
});

test('transcript introuvable : la pastille le dit', () => {
  // Arrange
  const t = jetons(null, [], { transcriptMissing: true });
  // Act
  const p = budgetPresentation(t);
  // Assert
  expect(p).toMatchObject({ kind: 'unavailable', text: 'Transcript N/A' });
});

test('avant le premier message du modele, aucune pastille', () => {
  expect(budgetPresentation(jetons(null)).kind).toBe('hidden');
  expect(budgetPresentation(jetons(seau({ lastModel: undefined }))).kind).toBe('hidden');
});
