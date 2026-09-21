// Ce que ce fichier protege : ce que DISENT les deux pastilles de budget du bandeau.
// La premiere parle du fil principal seul (modele, contexte, cout) ; la seconde, TOTAL,
// de la session entiere, sous-agents compris (jetons nets, cout).
//
// Le module est pur : aucun test unitaire de ce repo ne rend le DOM, c'est donc ici
// que les chiffres et les mots de ces pastilles sont epingles.

import { expect, test } from 'vitest';
import { budgetPresentation, type BudgetPresentation } from '../../src/web/viz-budget-format.ts';
import type { TokenBucket } from '../../src/web/viz-state.ts';

// Un seau tel que le serveur l'envoie ; chaque test ne nomme que ce qui l'en ecarte.
const seau = (champs: Partial<TokenBucket> = {}): TokenBucket => ({
  in: 0, out: 0, cacheCreate: 0, cacheRead: 0,
  lastIn: 0, lastCacheCreate: 0, lastCacheRead: 0,
  lastModel: 'claude-opus-4-6', contextMax: 1_000_000, costUsd: 0,
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

// ─── Le cout : le fil principal d'un cote, la session entiere de l'autre ─────

test('la pastille 1 ne compte que le cout du fil principal', () => {
  // Arrange
  const t = jetons(seau({ costUsd: 1.12 }), [seau({ costUsd: 2.09 })]);
  // Act
  const p = mesure(budgetPresentation(t));
  // Assert — additionner le sous-agent donnerait $3.21
  expect(p.main.cost).toBe('$1.12');
});

test('TOTAL additionne le cout du fil principal et de chaque sous-agent', () => {
  // Arrange
  const t = jetons(seau({ costUsd: 1.12 }), [seau({ costUsd: 2.00 }), seau({ costUsd: 0.09 })]);
  // Act
  const p = mesure(budgetPresentation(t));
  // Assert
  expect(p.total.cost).toBe('$3.21');
});

test('sans sous-agent, TOTAL reste affichee et son cout egale celui de la pastille 1', () => {
  // Les jetons nets n'apparaissent nulle part ailleurs dans le bandeau : la pastille
  // n'est donc jamais un simple doublon, meme quand les deux couts coincident.
  // Arrange
  const t = jetons(seau({ costUsd: 1.12 }));
  // Act
  const p = mesure(budgetPresentation(t));
  // Assert
  expect(p.main.cost).toBe('$1.12');
  expect(p.total.cost).toBe('$1.12');
});

// ─── Les jetons de TOTAL : les nets, la relecture de cache a part ────────────

test('TOTAL compte les jetons nets de tous les fils, relecture de cache exclue', () => {
  // Arrange
  const t = jetons(
    seau({ in: 1000, out: 500, cacheCreate: 20000, cacheRead: 900000 }),
    [seau({ in: 2000, out: 1500, cacheCreate: 30000, cacheRead: 500000 })],
  );
  // Act
  const p = mesure(budgetPresentation(t));
  // Assert — 21 500 + 33 500 ; y ajouter la relecture donnerait 1.5M
  expect(p.total.tokens).toBe('55k nets');
});

test('l infobulle de TOTAL donne les jetons nets en entier et la relecture de cache a part', () => {
  // Arrange
  const t = jetons(
    seau({ in: 1000, out: 500, cacheCreate: 20000, cacheRead: 900000 }),
    [seau({ in: 2000, out: 1500, cacheCreate: 30000, cacheRead: 500000 })],
  );
  // Act
  const p = mesure(budgetPresentation(t));
  // Assert
  expect(p.total.title).toContain(`Jetons nets : ${(55000).toLocaleString()}`);
  expect(p.total.title).toContain(`Relus depuis le cache : ${(1400000).toLocaleString()}`);
});

test('l infobulle de TOTAL nomme combien de sous-agents elle couvre', () => {
  // Arrange
  const trois = jetons(seau(), [seau(), seau(), seau()]);
  const un = jetons(seau(), [seau()]);
  const aucun = jetons(seau());
  // Act
  const titres = [trois, un, aucun].map(t => mesure(budgetPresentation(t)).total.title);
  // Assert
  expect(titres[0]).toContain('fil principal + 3 sous-agents');
  expect(titres[1]).toContain('fil principal + 1 sous-agent\n');
  expect(titres[2]).toContain('fil principal, aucun sous-agent');
});

// ─── Le cout partiel : chaque pastille porte la reserve de ce qu'elle additionne ─

test('un sous-agent sans tarif rend TOTAL partiel sans toucher la pastille 1', () => {
  // Arrange
  const t = jetons(
    seau({ costUsd: 1.12 }),
    [seau({ costUsd: 0.5, costComplete: false, unknownModels: ['claude-inconnu'] })],
  );
  // Act
  const p = mesure(budgetPresentation(t));
  // Assert
  expect(p.main.cost).toBe('$1.12');
  expect(p.main.title).not.toContain('claude-inconnu');
  expect(p.total.cost).toBe('au moins $1.62');
  expect(p.total.title).toContain('claude-inconnu');
});

test('un fil principal sans tarif rend les deux pastilles partielles', () => {
  // Arrange
  const t = jetons(
    seau({ costUsd: 1.12, costComplete: false, unknownModels: ['claude-x'] }),
    [seau({ costUsd: 2.00 })],
  );
  // Act
  const p = mesure(budgetPresentation(t));
  // Assert
  expect(p.main.cost).toBe('au moins $1.12');
  expect(p.total.cost).toBe('au moins $3.12');
});

test('un usage inexploitable chez un sous-agent previent que les jetons de TOTAL sont un minimum', () => {
  // Arrange
  const t = jetons(seau({ costUsd: 1 }), [seau({ costUsd: 1, costComplete: false, malformedUsageMessages: 2 })]);
  // Act
  const p = mesure(budgetPresentation(t));
  // Assert
  expect(p.total.title).toContain('Les jetons et le coût réels peuvent être plus élevés.');
});

// ─── La pastille 1 : modele, contexte courant, infobulle ────────────────────

test('la pastille 1 affiche le modele sous son nom court', () => {
  expect(mesure(budgetPresentation(jetons(seau({ lastModel: 'claude-opus-4-6' })))).main.model).toBe('Opus 4.6');
});

test('la pastille 1 raccourcit aussi les familles Claude 5, a un ou deux numeros', () => {
  // L'identifiant brut « claude-opus-5 » prend la largeur qui manque a TOTAL sur un ecran de 1 280 px.
  const modele = (id: string) => mesure(budgetPresentation(jetons(seau({ lastModel: id })))).main.model;
  expect(modele('claude-opus-5')).toBe('Opus 5');
  expect(modele('claude-fable-5-1')).toBe('Fable 5.1');
});

test('fenetre connue : le contexte courant du fil principal, rapporte a la fenetre', () => {
  // Arrange — le dernier message seul, jamais le cumul ni les sous-agents
  const t = jetons(
    seau({ lastIn: 4000, lastCacheCreate: 10000, lastCacheRead: 70000, in: 9_000_000, contextMax: 1_000_000 }),
    [seau({ lastIn: 500000 })],
  );
  // Act
  const p = mesure(budgetPresentation(t));
  // Assert
  expect(p.main.ctx).toBe('84k / 1.0M (8.4%)');
  expect(p.main.ctxLevel).toBe('ok');
});

test('fenetre inconnue : la taille absolue, sans pourcentage invente', () => {
  // Arrange
  const t = jetons(seau({ lastIn: 4000, lastCacheCreate: 10000, lastCacheRead: 70000, contextMax: undefined }));
  // Act
  const p = mesure(budgetPresentation(t));
  // Assert
  expect(p.main.ctx).toBe('84k');
  expect(p.main.ctxLevel).toBe('ok');
});

test('le contexte passe en alerte a 70 % de la fenetre, en critique a 90 %', () => {
  // Arrange
  const a = (n: number) => jetons(seau({ lastIn: n, contextMax: 100000 }));
  // Act
  const niveaux = [69999, 70000, 89999, 90000].map(n => mesure(budgetPresentation(a(n))).main.ctxLevel);
  // Assert
  expect(niveaux).toEqual(['ok', 'warn', 'warn', 'crit']);
});

test('l infobulle de la pastille 1 borne son cout au fil principal', () => {
  expect(mesure(budgetPresentation(jetons(seau({ costUsd: 1.12 })))).main.title).toContain('Cost (main thread only): $1.12');
});

// ─── Les etats ou il n'y a rien a mesurer ───────────────────────────────────

test('fournisseur sans jetons : la pastille 1 le dit, TOTAL n existe pas', () => {
  // Arrange
  const t = jetons(null, [], { tokensSupported: false });
  // Act
  const p = budgetPresentation(t);
  // Assert
  expect(p).toMatchObject({ kind: 'unavailable', text: 'Tokens N/A' });
});

test('transcript introuvable : la pastille 1 le dit, TOTAL n existe pas', () => {
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
