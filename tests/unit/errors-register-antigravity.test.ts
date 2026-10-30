// Ce que ce fichier protege : le « N reussis depuis » du registre d'erreurs sur une session
// Antigravity, dont un outil annonce d'abord sa fin sans verdict puis, a la fin de l'appel au
// modele, son echec. Les evenements sont produits par le code du hook, dans l'ordre d'ecriture.

import { beforeEach, expect, test } from 'vitest';

import { NORMALIZERS } from '../../src/server/hook-normalize.ts';
import { lateFailures } from '../../src/server/hook-antigravity-verdicts.ts';
import { recordError, recordSuccess, getErrors, getErrorsSummary, resetErrors } from '../../src/web/viz-errors.ts';

const CONV = '07f1a74b-0000-4000-8000-000000000001';
const TRANSCRIPT = 'C:/t.jsonl';

function brut(stepIdx: number, name: string, args: Record<string, unknown>, error = '') {
  return {
    conversationId: CONV, stepIdx, error,
    toolCall: { name, args }, workspacePaths: ['C:\\projet'], transcriptPath: TRANSCRIPT,
  };
}

function resultat(step_index: number, phrase: string) {
  return {
    step_index, source: 'MODEL', type: 'GENERIC', status: 'DONE',
    content: `Created At: 2026-10-02T16:55:28+02:00\nCompleted At: 2026-10-02T16:55:39+02:00\n\n${phrase}\nStdout:\n\nStderr:\n\n`,
  };
}

// Le fichier d'evenements tel que le hook l'ecrit, puis les echecs que PostInvocation y ajoute.
// `error` est l'echec qu'agy annonce lui-meme a la fin de l'outil.
type Outil = { stepIdx: number; name: string; args: Record<string, unknown>; phrase: string; error?: string };

function invocation(outils: Outil[]) {
  const ecrits = outils.flatMap(o => [
    NORMALIZERS.antigravity(brut(o.stepIdx, o.name, o.args), 'PreToolUse'),
    NORMALIZERS.antigravity(brut(o.stepIdx, o.name, o.args, o.error), 'PostToolUse'),
  ]);
  const evenements = ecrits.map(e => JSON.stringify(e)).join('\n') + '\n';
  const transcript = outils.map(o => JSON.stringify(resultat(o.stepIdx, o.phrase))).join('\n') + '\n';
  return [...ecrits, ...lateFailures(evenements, transcript)];
}

function rejoue(evenements: Record<string, unknown>[]) {
  for (const evt of evenements) {
    recordSuccess(evt as never);
    recordError(evt as never);
  }
}

const echecPrecedent = {
  hook_event_name: 'PostToolUseFailure', session_id: CONV, tool_use_id: `${CONV}:1`,
  tool_name: 'view_file', tool_input: { AbsolutePath: 'C:\\projet\\absent.txt' }, error: 'file not found',
};

beforeEach(resetErrors);

test('un outil Antigravity en echec tardif ne compte pas comme reussi depuis l erreur precedente', () => {
  // Arrange
  recordError(echecPrecedent);
  const evenements = invocation([
    { stepIdx: 2, name: 'run_command', args: { CommandLine: 'cmd /c exit 3' }, phrase: 'The command exited with code 3.' },
  ]);
  // Act
  rejoue(evenements);
  // Assert
  expect(evenements.map(e => e.hook_event_name)).toEqual(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']);
  expect(getErrors().map(e => e.successesSince)).toEqual([0, 0]);
  expect(getErrorsSummary().lastFailed).toBe(true);
});

test('un outil reussi apres l outil en echec tardif compte comme reussi depuis cet echec', () => {
  // Arrange
  const evenements = invocation([
    { stepIdx: 2, name: 'run_command', args: { CommandLine: 'cmd /c exit 3' }, phrase: 'The command exited with code 3.' },
    { stepIdx: 3, name: 'run_command', args: { CommandLine: 'git status' }, phrase: 'The command exited with code 0.' },
  ]);
  // Act
  rejoue(evenements);
  // Assert
  expect(getErrors().map(e => [e.toolUseId, e.successesSince])).toEqual([[`${CONV}:2`, 1]]);
  expect(getErrorsSummary().lastFailed).toBe(false);
});

test('une erreur qui revient en echec tardif repart de son occurrence, pas de la fin de l invocation', () => {
  // Arrange
  const commande = { name: 'run_command', args: { CommandLine: 'cmd /c exit 3' }, phrase: 'The command exited with code 3.' };
  rejoue(invocation([{ stepIdx: 2, ...commande }]));
  // Act
  rejoue(invocation([
    { stepIdx: 4, ...commande },
    { stepIdx: 5, name: 'run_command', args: { CommandLine: 'git status' }, phrase: 'The command exited with code 0.' },
  ]));
  // Assert
  expect(getErrors().map(e => [e.count, e.successesSince])).toEqual([[2, 1]]);
});

test('une erreur survenue apres l outil en echec tardif garde les succes qui l ont suivie', () => {
  // Arrange
  const evenements = invocation([
    { stepIdx: 2, name: 'run_command', args: { CommandLine: 'cmd /c exit 3' }, phrase: 'The command exited with code 3.' },
    { stepIdx: 3, name: 'view_file', args: { AbsolutePath: 'C:\projet\absent.txt' }, phrase: 'File not found.', error: 'file not found' },
    { stepIdx: 4, name: 'run_command', args: { CommandLine: 'git status' }, phrase: 'The command exited with code 0.' },
  ]);
  // Act
  rejoue(evenements);
  // Assert
  expect(getErrors().map(e => [e.toolUseId, e.successesSince])).toEqual([[`${CONV}:3`, 1], [`${CONV}:2`, 1]]);
});

test('deux echecs tardifs dans la meme invocation gardent chacun les succes qui les ont suivis', () => {
  // Arrange
  const evenements = invocation([
    { stepIdx: 2, name: 'run_command', args: { CommandLine: 'cmd /c exit 3' }, phrase: 'The command exited with code 3.' },
    { stepIdx: 3, name: 'run_command', args: { CommandLine: 'git status' }, phrase: 'The command exited with code 0.' },
    { stepIdx: 4, name: 'run_command', args: { CommandLine: 'cmd /c exit 4' }, phrase: 'The command exited with code 4.' },
  ]);
  // Act
  rejoue(evenements);
  // Assert
  expect(getErrors().map(e => [e.toolUseId, e.successesSince])).toEqual([[`${CONV}:2`, 1], [`${CONV}:4`, 0]]);
  expect(getErrorsSummary().lastFailed).toBe(true);
});
