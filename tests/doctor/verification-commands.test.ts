// Le classement déclaratif des commandes de vérification (doc/41) : la table
// est la spec, ces cas sont les frontières mesurées avant la sonde.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyVerification } from '../../src/engine/doctor/verification-commands.ts';

test('les lanceurs de test directs sont des vérifications « test »', () => {
  // Arrange
  const commands = ['npx vitest run tests/doctor/reads.test.ts', 'vitest run', 'jest --ci',
    'python -m pytest tests/', 'cargo test', 'go test ./...', 'node --test "tests/**"'];
  // Act
  const kinds = commands.map(classifyVerification);
  // Assert
  assert.deepEqual(kinds, ['test', 'test', 'test', 'test', 'test', 'test', 'test']);
});

test('les scripts npm/pnpm/yarn/bun de test sont des vérifications « test »', () => {
  // Arrange
  const commands = ['npm test', 'npm run test:node', 'pnpm test', 'yarn test', 'bun run test'];
  // Act
  const kinds = commands.map(classifyVerification);
  // Assert
  assert.deepEqual(kinds, ['test', 'test', 'test', 'test', 'test']);
});

test('typecheck, lint et build sont classés dans leur genre', () => {
  // Arrange
  const commands = ['tsc --noEmit -p tsconfig.node.json', 'npx eslint src/', 'ruff check .',
    'npm run build', 'cargo build', 'make test'];
  // Act
  const kinds = commands.map(classifyVerification);
  // Assert
  assert.deepEqual(kinds, ['typecheck', 'lint', 'lint', 'build', 'build', 'build']);
});

test('une commande enchainee est classee au premier motif apparie', () => {
  // Arrange
  const command = 'cd F:/DEV/agent-viz && npm test';
  // Act
  const kind = classifyVerification(command);
  // Assert
  assert.equal(kind, 'test');
});

test('un nom cite entre guillemets n est pas une verification', () => {
  // Arrange
  const commands = ['git commit -m "npm test vert, 12 cas"', "echo 'vitest run ok'"];
  // Act
  const kinds = commands.map(classifyVerification);
  // Assert
  assert.deepEqual(kinds, [null, null]);
});

test('un nom d outil colle a un suffixe de fichier n est pas une verification', () => {
  // Arrange — le piege reel : lire une config n est pas lancer l outil.
  const commands = ['cat vitest.config.mts', 'ls jest.config.js', 'cat tsconfig.json'];
  // Act
  const kinds = commands.map(classifyVerification);
  // Assert
  assert.deepEqual(kinds, [null, null, null]);
});

test('le tout-venant du shell rend null', () => {
  // Arrange
  const commands = ['git status', 'ls -la', 'npm install', 'node bin/agent-viz.js status', ''];
  // Act
  const kinds = commands.map(classifyVerification);
  // Assert
  assert.deepEqual(kinds, [null, null, null, null, null]);
});
