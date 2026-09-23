// recognizeCommand et familyOf rangent une commande observée dans une famille :
// c'est cette reconnaissance qui permet de compter les outils par nature.
import { expect, test } from 'vitest';
import { familyOf, recognizeCommand } from '../../src/engine/doctor/aggregators/recognizers.ts';

test('reconnaît les reporters ciblés par le futur gate', () => {
  expect(recognizeCommand('npx vitest run tests/foo.test.ts')).toBe('vitest');
  expect(recognizeCommand('yarn jest --coverage')).toBe('jest');
  expect(recognizeCommand('npx tsc --noEmit')).toBe('tsc');
  expect(recognizeCommand('eslint src/ --fix')).toBe('eslint');
  expect(recognizeCommand('ng build --configuration production')).toBe('ng');
  expect(recognizeCommand('git log --oneline -n 20')).toBe('git-log');
  expect(recognizeCommand('git diff HEAD~1')).toBe('git-diff');
  expect(recognizeCommand('git status')).toBe('git-status');
  expect(recognizeCommand('python -m pytest tests/')).toBe('pytest');
  expect(recognizeCommand('npm install')).toBe('npm');
});

test('le spécifique gagne sur le générique, l’inconnu rend null', () => {
  expect(recognizeCommand('npm exec vitest run')).toBe('vitest');
  expect(recognizeCommand('cargo build --release')).toBeNull();
});

test('Bash : premier token + sous-commande pour git/npm/npx/yarn/pnpm, args supprimés', () => {
  expect(familyOf('Bash', { command: 'git log --oneline -n 20' })).toBe('git log');
  expect(familyOf('Bash', { command: 'npx vitest run tests/a.test.ts' })).toBe('npx vitest');
  expect(familyOf('Bash', { command: 'npm run build' })).toBe('npm run');
  expect(familyOf('Bash', { command: 'ls -la src/' })).toBe('ls');
});

test('préfixe « cd X && » ignoré pour la famille', () => {
  expect(familyOf('Bash', { command: 'cd "/f/proj" && npm test' })).toBe('npm test');
});

test('outils non-Bash : la famille est le nom de l’outil', () => {
  expect(familyOf('Read', { file_path: 'C:\\x.ts' })).toBe('Read');
  expect(familyOf('mcp__codesight__query', {})).toBe('mcp__codesight__query');
});

test('input sans command → nom de l’outil', () => {
  expect(familyOf('Bash', {})).toBe('Bash');
});
