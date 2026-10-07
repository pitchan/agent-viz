// Formes de lignes reprises de transcripts Codex réels (rollout-*.jsonl, 0.135 à 0.155),
// contenu remplacé. Une ligne `token_count` porte le cumul de la session et le dernier appel.
import { expect, test } from 'vitest';
import { TRANSCRIPT_ADAPTERS, getAdapter } from '../../src/server/transcript-adapters/index.ts';
import { ensureTokens } from '../../src/server/tokens.ts';

const codex = TRANSCRIPT_ADAPTERS.codex;
const HORODATAGE = '2026-09-21T10:14:00.000Z';

interface Compteurs {
  input_tokens: number; cached_input_tokens: number; cache_write_input_tokens: number;
  output_tokens: number; reasoning_output_tokens: number; total_tokens: number;
}

function compteurs(input: number, cached: number, output: number): Compteurs {
  return {
    input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0,
    output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output,
  };
}

function tour(model: string): string {
  return JSON.stringify({ timestamp: HORODATAGE, type: 'turn_context', payload: { turn_id: 't1', model } });
}

function jetons(cumul: Compteurs, appel: Compteurs): string {
  return JSON.stringify({
    timestamp: HORODATAGE, type: 'event_msg',
    payload: { type: 'token_count', info: { total_token_usage: cumul, last_token_usage: appel, model_context_window: 258400 } },
  });
}

function session(): { tokens: any } {
  const rec: { tokens: any } = { tokens: null };
  ensureTokens(rec);
  return rec;
}

function lis(rec: { tokens: any }, lignes: string[]): boolean[] {
  return lignes.map(l => codex.parseUsageLine(l, rec));
}

const APPEL_1 = compteurs(1000, 400, 50);
const APPEL_2 = compteurs(2000, 1500, 80);
const CUMUL_2 = compteurs(3000, 1900, 130);

test('une session Codex est lue par le lecteur Codex, qui sait compter les jetons', () => {
  // Arrange — le registre importé ci-dessus
  // Act
  const adapter = getAdapter('codex');
  // Assert
  expect(adapter).toBe(codex);
  expect(adapter.tokensSupported).toBe(true);
  expect(adapter.usageSnapshot).toBe(null);
});

test('un appel Codex est compté, le cache séparé de l’entrée', () => {
  // Arrange
  const rec = session();
  // Act
  const rendus = lis(rec, [tour('gpt-5.5'), jetons(APPEL_1, APPEL_1)]);
  // Assert
  expect(rendus).toEqual([false, true]);
  expect(rec.tokens.main.in).toBe(600);
  expect(rec.tokens.main.cacheRead).toBe(400);
  expect(rec.tokens.main.out).toBe(50);
});

test('deux appels Codex donnent le cumul que Codex déclare', () => {
  // Arrange
  const rec = session();
  // Act
  lis(rec, [tour('gpt-5.5'), jetons(APPEL_1, APPEL_1), jetons(CUMUL_2, APPEL_2)]);
  // Assert
  const { in: entree, cacheRead, out } = rec.tokens.main;
  expect(entree + cacheRead + out).toBe(CUMUL_2.total_tokens);
});

test('une ligne de jetons répétée par Codex n’est comptée qu’une fois', () => {
  // Arrange
  const rec = session();
  // Act
  const rendus = lis(rec, [tour('gpt-5.5'), jetons(APPEL_1, APPEL_1), jetons(APPEL_1, APPEL_1)]);
  // Assert
  expect(rendus).toEqual([false, true, false]);
  expect(rec.tokens.main.out).toBe(50);
});

test('relire le transcript depuis le début ne double pas les jetons', () => {
  // Arrange
  const rec = session();
  const lignes = [tour('gpt-5.5'), jetons(APPEL_1, APPEL_1), jetons(CUMUL_2, APPEL_2)];
  lis(rec, lignes);
  // Act
  lis(rec, lignes);
  // Assert
  expect(rec.tokens.main.out).toBe(130);
});

test('un premier cumul hérité d’un fil parent n’est pas compté', () => {
  // Arrange
  const rec = session();
  const herite = compteurs(90000, 60000, 1000);
  const dernierAppelDuParent = compteurs(30000, 19000, 300);
  const cumulApres = compteurs(91000, 60400, 1050);
  // Act
  const rendus = lis(rec, [tour('gpt-5.5'), jetons(herite, dernierAppelDuParent), jetons(cumulApres, APPEL_1)]);
  // Assert
  expect(rendus).toEqual([false, false, true]);
  expect(rec.tokens.main.in).toBe(600);
  expect(rec.tokens.main.out).toBe(50);
});

test('une ligne de jetons sans compteurs ne compte rien', () => {
  // Arrange
  const rec = session();
  const sansInfo = JSON.stringify({ timestamp: HORODATAGE, type: 'event_msg', payload: { type: 'token_count', info: null } });
  // Act
  const rendus = lis(rec, [tour('gpt-5.5'), sansInfo]);
  // Assert
  expect(rendus).toEqual([false, false]);
  expect(rec.tokens.main.in).toBe(0);
});

test('un appel dont le modèle n’est pas encore connu n’est pas compté', () => {
  // Arrange
  const rec = session();
  // Act
  const rendus = lis(rec, [jetons(APPEL_1, APPEL_1)]);
  // Assert
  expect(rendus).toEqual([false]);
  expect(rec.tokens.main.in).toBe(0);
});

test('le coût d’une session Codex est déclaré incomplet, pas nul', () => {
  // Arrange
  const rec = session();
  // Act
  lis(rec, [tour('gpt-5.5'), jetons(APPEL_1, APPEL_1)]);
  // Assert
  expect(rec.tokens.main.costComplete).toBe(false);
  expect(rec.tokens.main.costUsd).toBe(0);
});

test('la taille de contexte est celle du dernier appel Codex', () => {
  // Arrange
  const rec = session();
  // Act
  lis(rec, [tour('gpt-5.5'), jetons(APPEL_1, APPEL_1), jetons(CUMUL_2, APPEL_2)]);
  // Assert
  const { lastIn, lastCacheRead, lastCacheCreate } = rec.tokens.main;
  expect(lastIn + lastCacheRead + lastCacheCreate).toBe(APPEL_2.input_tokens);
});

test('une session Codex trouve son transcript dans le premier événement', () => {
  // Arrange
  const premier = { _source: 'codex', transcript_path: 'C:/Users/x/.codex/sessions/2026/09/21/rollout-a.jsonl' };
  // Act
  const chemin = codex.discoverPath(premier);
  // Assert
  expect(chemin).toBe(premier.transcript_path);
});

test('la question est le premier texte de l’utilisateur, hors blocs injectés', () => {
  // Arrange
  const injecte = '<environment_context>\n  <cwd>C:/projet</cwd>\n</environment_context>';
  const transcript = [
    JSON.stringify({ type: 'session_meta', payload: { id: 's1', cwd: 'C:/projet' } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'consignes du harnais' }] } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: injecte }, { type: 'input_text', text: 'Corrige le test qui échoue' }] } }),
  ].join('\n');
  // Act
  const question = codex.extractPrompt(transcript);
  // Assert
  expect(question).toBe('Corrige le test qui échoue');
});
