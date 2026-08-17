// La queue non vérifiée par session (doc/41) : fusion inter-agents par
// horodatage, dédup d'usage par message.id, une édition en erreur n'a rien
// modifié, un événement sans horodatage est compté — jamais classé au hasard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VerificationAggregator } from '../../src/engine/doctor/aggregators/verification.ts';

const T = (m: number) => `2026-08-17T10:${String(m).padStart(2, '0')}:00.000Z`;

function assistant(over: Record<string, unknown> = {}) {
  return { kind: 'assistant' as const, msgId: null, model: null, usage: null,
    toolUses: [], textChars: 0, isSidechain: false, ...over };
}
function toolResult(over: Record<string, unknown> = {}) {
  return { kind: 'tool_result' as const, toolUseId: 'x', bytes: 0,
    isError: false, contentHash: null, ...over };
}
const edit = (id: string, path: string, at: string) =>
  assistant({ timestamp: at, toolUses: [{ id, name: 'Edit', input: { file_path: path } }] });
const bash = (id: string, command: string, at: string) =>
  assistant({ timestamp: at, toolUses: [{ id, name: 'Bash', input: { command } }] });

test('une edition suivie d un test vert ne laisse aucune queue', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(edit('e1', 'F:/proj/a.ts', T(1)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'e1', timestamp: T(1) }) as never);
  agg.addAssistant(bash('v1', 'npm test', T(5)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'v1', timestamp: T(6) }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.editsTotal, 1);
  assert.equal(stats.verifications, 1);
  assert.equal(stats.editsAfterLastVerification, 0);
  assert.equal(stats.lastVerification?.ok, true);
  assert.equal(stats.lastVerification?.kind, 'test');
});

test('une edition posterieure a la derniere verification est la queue', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(bash('v1', 'npx vitest run', T(1)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'v1', timestamp: T(2) }) as never);
  agg.addAssistant(edit('e1', 'F:/proj/a.ts', T(5)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'e1', timestamp: T(5) }) as never);
  agg.addAssistant(edit('e2', 'F:/proj/a.ts', T(7)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'e2', timestamp: T(7) }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.editsAfterLastVerification, 2);
  assert.deepEqual(stats.filesAfterLastVerification, ['F:/proj/a.ts']);
  assert.equal(stats.filesAfterLastVerificationTotal, 1);
});

test('sans aucune verification, tout est la queue - jetons compris', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(edit('e1', 'F:/proj/a.ts', T(1)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'e1', timestamp: T(1) }) as never);
  agg.addAssistant(assistant({ msgId: 'm1', timestamp: T(2),
    usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 999 } }) as never, 'main');
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.verifications, 0);
  assert.equal(stats.editsAfterLastVerification, 1);
  assert.equal(stats.tokensAfterLastVerification, 160, 'net = in + cacheCreate + out, cacheRead exclu');
});

test('la chronologie inter-agents suit l horodatage, pas l ordre de lecture', () => {
  // Arrange — le scan lit main PUIS le sous-agent ; ici le sous-agent a vérifié APRÈS les éditions de main.
  const agg = new VerificationAggregator();
  agg.addAssistant(edit('e1', 'F:/proj/a.ts', T(10)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'e1', timestamp: T(10) }) as never);
  agg.addAssistant(bash('v1', 'npm test', T(20)) as never, 'agent-01');
  agg.addToolResult(toolResult({ toolUseId: 'v1', timestamp: T(21) }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.editsAfterLastVerification, 0, 'le test du sous-agent couvre l edition de main');
});

test('une verification rouge reste une verification, comptee en echec', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(bash('v1', 'npm test', T(1)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'v1', timestamp: T(2), isError: true }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.verifications, 1);
  assert.equal(stats.verificationsFailed, 1);
  assert.equal(stats.lastVerification?.ok, false);
});

test('une edition en erreur n a rien modifie, une commande non classee n est rien', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(edit('e1', 'F:/proj/a.ts', T(1)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'e1', timestamp: T(1), isError: true }) as never);
  agg.addAssistant(bash('b1', 'git status', T(2)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'b1', timestamp: T(2) }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.editsTotal, 0);
  assert.equal(stats.verifications, 0);
});

test('l usage d un meme message.id repete par bloc de contenu compte une fois', () => {
  // Arrange
  const agg = new VerificationAggregator();
  const usage = { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  agg.addAssistant(assistant({ msgId: 'm1', timestamp: T(1), usage }) as never, 'main');
  agg.addAssistant(assistant({ msgId: 'm1', timestamp: T(1), usage }) as never, 'main');
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.tokensAfterLastVerification, 150);
});

test('un evenement sans horodatage est compte unordered, jamais classe', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(edit('e1', 'F:/proj/a.ts', undefined as never) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'e1' }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.editsTotal, 0);
  assert.equal(stats.unordered, 1);
});

test('PowerShell est un porteur de commande au meme titre que Bash', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(assistant({ timestamp: T(1),
    toolUses: [{ id: 'v1', name: 'PowerShell', input: { command: 'npm test' } }] }) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'v1', timestamp: T(2) }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.verifications, 1);
});
