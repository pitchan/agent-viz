// Smoke tests for pure helpers in src/web/viz-state.ts. No DOM access here,
// so the module imports cleanly under Node ESM.

import { expect, test } from 'vitest';
import { parseMcpName, state, tokenContext } from '../../src/web/viz-state.ts';

test('parseMcpName: plugin_ prefix stripped + repeated segments dedup', () => {
  expect(parseMcpName('mcp__plugin_playwright_playwright__browser_click')).toEqual({ label: 'browser_click', sub: 'playwright' });
});

test('parseMcpName: server segments preserved when no known prefix', () => {
  expect(parseMcpName('mcp__Claude_in_Chrome__navigate')).toEqual({ label: 'navigate', sub: 'Claude_in_Chrome' });
});

test('parseMcpName: non-mcp tool name passes through with empty sub', () => {
  expect(parseMcpName('Bash')).toEqual({ label: 'Bash', sub: '' });
});

test('parseMcpName: null/empty falls back to "MCP"', () => {
  expect(parseMcpName(null)).toEqual({ label: 'MCP', sub: '' });
  expect(parseMcpName('')).toEqual({ label: 'MCP', sub: '' });
});

test('state.tokens.tokensSupported defaults to null (unknown until first SSE)', () => {
  // Null — not true, not false — so the UI can distinguish "haven't heard
  // from the server yet" from "server told us tokens are unavailable".
  // Booting straight to true would briefly show a fake gauge for Copilot.
  expect(state.tokens.tokensSupported).toBe(null);
});

test('state.tokens.transcriptMissing defaults to false', () => {
  // No "transcript not located" placeholder until the server actually says so.
  expect(state.tokens.transcriptMissing).toBe(false);
});

test('tokenContext: Infinity on one field does not poison the sum (countOrZero guard)', () => {
  // Arrange — Infinity passes an `|| 0` guard untouched.
  const t = { lastIn: Infinity, lastCacheCreate: 1, lastCacheRead: 1 };

  // Act
  const r = tokenContext(t);

  // Assert — a `(t.lastIn || 0) + ...` guard would render Infinity here.
  expect(r).toBe(2);
});

// ---------------------------------------------------------------------------
// La complétude du coût, agrégée côté navigateur : le dernier maillon avant
// l'affichage en direct.
// ---------------------------------------------------------------------------
import { costCompleteness } from '../../src/web/viz-state.ts';

test('des seaux tous complets donnent un total complet', () => {
  const r = costCompleteness([
    { costComplete: true, unknownModels: [] },
    { costComplete: true, unknownModels: [] },
  ]);
  expect(r.complete).toBe(true);
  expect(r.unknownModels).toEqual([]);
});

test('UN SEUL seau incomplet suffit à rendre le total incomplet', () => {
  // Le cas réel : le fil principal tourne sur un modèle tarifé, un sous-agent
  // part sur un modèle hors table. Le total de la pastille additionne les deux.
  const r = costCompleteness([
    { costComplete: true, unknownModels: [] },
    { costComplete: false, unknownModels: ['claude-opus-6'] },
  ]);
  expect(r.complete).toBe(false);
  expect(r.unknownModels).toEqual(['claude-opus-6']);
});

test('les modèles inconnus sont réunis, dédupliqués et triés', () => {
  const r = costCompleteness([
    { costComplete: false, unknownModels: ['zzz-modele', 'claude-opus-6'] },
    { costComplete: false, unknownModels: ['claude-opus-6'] },
  ]);
  expect(r.unknownModels).toEqual(['claude-opus-6', 'zzz-modele']);
});

test('un seau SANS le champ compte comme complet (enveloppe additive)', () => {
  // TÉMOIN : `undefined` n'est pas `false`. Un instantané sans le champ
  // `costComplete` n'affiche pas « au moins » sur toutes ses sessions.
  const r = costCompleteness([{ costUsd: 1.5 }, null, undefined]);
  expect(r.complete).toBe(true);
  expect(r.unknownModels).toEqual([]);
});

test('les messages au usage inexploitable s’additionnent sur tous les seaux', () => {
  // Arrange
  const seaux = [
    { costComplete: false, unknownModels: [], malformedUsageMessages: 2 },
    { costComplete: false, unknownModels: [], malformedUsageMessages: 1 },
  ];

  // Act
  const r = costCompleteness(seaux);

  // Assert
  expect(r.malformedUsageMessages).toBe(3);
});

test('un seau sans le compte des messages inexploitables n’en ajoute aucun (enveloppe additive)', () => {
  // Arrange
  const seaux = [{ costUsd: 1.5 }, { costComplete: false, malformedUsageMessages: 1 }, null, undefined];

  // Act
  const r = costCompleteness(seaux);

  // Assert
  expect(r.malformedUsageMessages).toBe(1);
});

// Les raisons d'un coût partiel, dans l'ordre où la pastille et le panneau les listent.
import { costReasons } from '../../src/web/viz-state.ts';

test('un coût complet n’a aucune raison à afficher', () => {
  expect(costReasons({ unknownModels: [], malformedUsageMessages: 0 })).toEqual([]);
});

test('des messages au usage inexploitable sont une raison à eux seuls', () => {
  expect(costReasons({ unknownModels: [], malformedUsageMessages: 2 })).toEqual(['2 message(s) au champ usage inexploitable']);
});

test('les deux raisons sont listées : les modèles sans tarif, puis les messages inexploitables', () => {
  expect(costReasons({ unknownModels: ['claude-opus-6', 'zzz-modele'], malformedUsageMessages: 1 })).toEqual(['sans tarif : claude-opus-6, zzz-modele', '1 message(s) au champ usage inexploitable']);
});

// Trois énoncés, trois vérités. Le troisième existe parce que
// « au moins $0 » est vrai et ne prétend rien : quand RIEN n'est tarifé, il
// faut avouer l'absence, pas produire une borne inutile.
import { formatCostBound } from '../../src/web/viz-state.ts';

test('complet : le montant nu', () => {
  expect(formatCostBound(4.172108, true)).toBe('$4.17');
  expect(formatCostBound(0, true)).toBe('$0');
});

test('partiel avec une part connue : une BORNE INFÉRIEURE, et son sens', () => {
  expect(formatCostBound(4.172108, false)).toBe('au moins $4.17');
  // Même une part minuscule reste une information : elle se dit.
  expect(formatCostBound(0.0004, false)).toBe('au moins $0.0004');
});

test('partiel sans aucune part connue : l’absence s’avoue', () => {
  expect(formatCostBound(0, false)).toBe('coût indisponible');
});
