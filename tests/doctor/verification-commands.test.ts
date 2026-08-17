// Le classement déclaratif des commandes de vérification (doc/41) : la table
// est la spec, ces cas sont les frontières mesurées avant la sonde. La règle
// qui les gouverne toutes : nommer un outil n'est pas l'exécuter — une fausse
// preuve se paie (doc/41, D4).
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
    'npm run build', 'cargo build', 'make check'];
  // Act
  const kinds = commands.map(classifyVerification);
  // Assert
  assert.deepEqual(kinds, ['typecheck', 'lint', 'lint', 'build', 'build', 'build']);
});

test('chaque cible de make est classee dans son genre, pas en bloc', () => {
  // Arrange — `make test` est une vérification de test, pas un build.
  const commands = ['make test', 'make lint', 'make check'];
  // Act
  const kinds = commands.map(classifyVerification);
  // Assert
  assert.deepEqual(kinds, ['test', 'lint', 'build']);
});

test('les seuls prefixes toleres en tete de segment sont les variables d environnement et npx', () => {
  // Arrange
  const commands = ['PORT=4123 npm test', './node_modules/.bin/vitest run', 'python3 -m pytest'];
  // Act
  const kinds = commands.map(classifyVerification);
  // Assert
  assert.deepEqual(kinds, ['test', 'test', 'test']);
});

test('une commande enchainee est classee au premier segment apparie', () => {
  // Arrange
  const command = 'cd F:/DEV/agent-viz && npm test';
  // Act
  const kind = classifyVerification(command);
  // Assert
  assert.equal(kind, 'test');
});

test('entre segments, c est l ordre de la commande qui arbitre, pas l ordre de la table', () => {
  // Arrange
  const commands = ['npm run build && npm test', 'git status && npx vitest run'];
  // Act
  const kinds = commands.map(classifyVerification);
  // Assert
  assert.deepEqual(kinds, ['build', 'test']);
});

test('nommer un outil n est pas l executer', () => {
  // Arrange — installer, chercher ou localiser un outil ne produit aucun rouge/vert.
  const commands = ['npm install --save-dev vitest', 'npm i -D jest @types/jest',
    'npm uninstall vitest', 'rg vitest src/', 'grep -rn vitest src', 'which tsc', 'npm ls vitest'];
  // Act
  const kinds = commands.map(classifyVerification);
  // Assert
  assert.deepEqual(kinds, [null, null, null, null, null, null, null]);
});

test('interroger un outil sur sa version ou son aide n est pas une verification', () => {
  // Arrange
  const commands = ['npx vitest --version', 'npx jest --help'];
  // Act
  const kinds = commands.map(classifyVerification);
  // Assert
  assert.deepEqual(kinds, [null, null]);
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

test('une entree qui n est pas une chaine rend null', () => {
  // Arrange — la sonde (doc/41) lit du JSON de transcript non type.
  const notCommands = [undefined, null, 42, { command: 'npm test' }] as unknown as string[];
  // Act
  const kinds = notCommands.map(classifyVerification);
  // Assert
  assert.deepEqual(kinds, [null, null, null, null]);
});
