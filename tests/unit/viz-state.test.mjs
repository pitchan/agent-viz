// Smoke tests for pure helpers in public/viz-state.js. No DOM access here,
// so the module imports cleanly under Node ESM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMcpName, state } from '../../src/web/viz-state.js';

test('parseMcpName: plugin_ prefix stripped + repeated segments dedup', () => {
  assert.deepEqual(
    parseMcpName('mcp__plugin_playwright_playwright__browser_click'),
    { label: 'browser_click', sub: 'playwright' }
  );
});

test('parseMcpName: server segments preserved when no known prefix', () => {
  assert.deepEqual(
    parseMcpName('mcp__Claude_in_Chrome__navigate'),
    { label: 'navigate', sub: 'Claude_in_Chrome' }
  );
});

test('parseMcpName: non-mcp tool name passes through with empty sub', () => {
  assert.deepEqual(parseMcpName('Bash'), { label: 'Bash', sub: '' });
});

test('parseMcpName: null/empty falls back to "MCP"', () => {
  assert.deepEqual(parseMcpName(null), { label: 'MCP', sub: '' });
  assert.deepEqual(parseMcpName(''), { label: 'MCP', sub: '' });
});

test('state.tokens.tokensSupported defaults to null (unknown until first SSE)', () => {
  // Null — not true, not false — so the UI can distinguish "haven't heard
  // from the server yet" from "server told us tokens are unavailable".
  // Booting straight to true would briefly show a fake gauge for Copilot.
  assert.equal(state.tokens.tokensSupported, null);
});

test('state.tokens.transcriptMissing defaults to false', () => {
  // No "transcript not located" placeholder until the server actually says so.
  assert.equal(state.tokens.transcriptMissing, false);
});

// ---------------------------------------------------------------------------
// C4 (2026-08-11) — la complétude du coût, agrégée côté navigateur.
// C'est le dernier maillon de la cible : « propager cette information jusqu'à
// l'affichage en direct ».
// ---------------------------------------------------------------------------
import { costCompleteness } from '../../src/web/viz-state.js';

test('C4 — des seaux tous complets donnent un total complet', () => {
  const r = costCompleteness([
    { costComplete: true, unknownModels: [] },
    { costComplete: true, unknownModels: [] },
  ]);
  assert.equal(r.complete, true);
  assert.deepEqual(r.unknownModels, []);
});

test('C4 — UN SEUL seau incomplet suffit à rendre le total incomplet', () => {
  // Le cas réel : le fil principal tourne sur un modèle tarifé, un sous-agent
  // part sur un modèle hors table. Le total de la pastille additionne les deux.
  const r = costCompleteness([
    { costComplete: true, unknownModels: [] },
    { costComplete: false, unknownModels: ['claude-opus-6'] },
  ]);
  assert.equal(r.complete, false);
  assert.deepEqual(r.unknownModels, ['claude-opus-6']);
});

test('C4 — les modèles inconnus sont réunis, dédupliqués et triés', () => {
  const r = costCompleteness([
    { costComplete: false, unknownModels: ['zzz-modele', 'claude-opus-6'] },
    { costComplete: false, unknownModels: ['claude-opus-6'] },
  ]);
  assert.deepEqual(r.unknownModels, ['claude-opus-6', 'zzz-modele']);
});

test('C4 — un seau SANS le champ compte comme complet (enveloppe additive)', () => {
  // TÉMOIN qui borne la propriété : `undefined` n'est pas `false`. Un
  // navigateur rechargé face à un instantané antérieur à C4 ne doit pas
  // afficher « au moins » sur toutes ses sessions.
  const r = costCompleteness([{ costUsd: 1.5 }, null, undefined]);
  assert.equal(r.complete, true);
  assert.deepEqual(r.unknownModels, []);
});

// C4 — trois énoncés, trois vérités. Le troisième existe parce que
// « au moins $0 » est vrai et ne prétend rien : quand RIEN n'est tarifé, il
// faut avouer l'absence, pas produire une borne inutile.
import { formatCostBound } from '../../src/web/viz-state.js';

test('C4 — complet : le montant nu', () => {
  assert.equal(formatCostBound(4.172108, true), '$4.17');
  assert.equal(formatCostBound(0, true), '$0');
});

test('C4 — partiel avec une part connue : une BORNE INFÉRIEURE, et son sens', () => {
  assert.equal(formatCostBound(4.172108, false), 'au moins $4.17');
  // Même une part minuscule reste une information : elle se dit.
  assert.equal(formatCostBound(0.0004, false), 'au moins $0.0004');
});

test('C4 — partiel sans aucune part connue : l’absence s’avoue', () => {
  assert.equal(formatCostBound(0, false), 'coût indisponible');
});
