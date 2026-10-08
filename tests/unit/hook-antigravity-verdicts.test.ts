// Les échecs d'outils d'Antigravity, lus dans son transcript à la fin d'un appel au modèle.
import { expect, test } from 'vitest';
import { lateFailures } from '../../src/server/hook-antigravity-verdicts.ts';
import { classify } from '../../src/engine/watchdog/invocation-patterns.ts';

const CONV = '07f1a74b';
const lignes = (...objets: unknown[]) => objets.map(o => JSON.stringify(o)).join('\n') + '\n';

function lance(stepIdx: number, tool_name = 'run_command', tool_input: unknown = { CommandLine: 'cmd /c exit 3' }) {
  return {
    hook_event_name: 'PreToolUse', session_id: CONV, tool_use_id: `${CONV}:${stepIdx}`, stepIdx,
    tool_name, tool_input, cwd: 'C:/projet', transcript_path: 'C:/t.jsonl',
  };
}

// Forme relevée sur un transcript réel d'agy 1.2.13.
function resultat(step_index: number, phrase: string, sortie = 'Stdout:\n\nStderr:\n\n') {
  return {
    step_index, source: 'MODEL', type: 'GENERIC', status: 'DONE',
    content: `Created At: 2026-10-02T16:55:28+02:00\nCompleted At: 2026-10-02T16:55:39+02:00\n\n${phrase}\n${sortie}`,
  };
}

// Bloc d'erreur rendu par Windows PowerShell 5.1 pour une commande inconnue, accents déjà
// abîmés comme agy les écrit dans son transcript.
const COMMANDE_INCONNUE = 'Output:\n'
  + 'Get-Trucmuche : Le terme �Get-Trucmuche� n\'est pas reconnu comme nom d\'applet de commande, fonction, fichier de script \r\n'
  + 'ou programme ex�cutable. V�rifiez l\'orthographe du nom, ou si un chemin d\'acc�s existe, v�rifiez que le chemin d\'acc�s \r\n'
  + 'est correct et r�essayez.\r\n'
  + 'Au caract�re Ligne:1 : 1\r\n'
  + '+ Get-Trucmuche -Nom x\r\n'
  + '+ ~~~~~~~~~~~~~\r\n'
  + '    + CategoryInfo          : ObjectNotFound: (Get-Trucmuche:String) [], CommandNotFoundException\r\n'
  + '    + FullyQualifiedErrorId : CommandNotFoundException\r\n'
  + ' \r\n';

test('une commande PowerShell en échec garde sa sortie, où la mauvaise invocation se reconnaît', () => {
  // Arrange
  const evenements = lignes(lance(2, 'run_command', { CommandLine: 'Get-Trucmuche -Nom x' }));
  const transcript = lignes(resultat(2, 'The command exited with code 1.', COMMANDE_INCONNUE));
  // Act
  const echecs = lateFailures(evenements, transcript);
  // Assert
  expect(classify(echecs[0]?.error)).toEqual({ id: 'inv-ps-command-not-found', class: 'invocation' });
});

test('la sortie d\'une commande en échec est bornée, et commence toujours par la phrase d\'agy', () => {
  // Arrange
  const sortie = 'Output:\n' + 'x'.repeat(20_000);
  const evenements = lignes(lance(2));
  const transcript = lignes(resultat(2, 'The command exited with code 1.', sortie));
  // Act
  const erreur = String(lateFailures(evenements, transcript)[0]?.error);
  // Assert
  expect(erreur.startsWith('The command exited with code 1.\nOutput:\nxxx')).toBe(true);
  expect(erreur.length).toBeLessThan(sortie.length);
});

test('une commande sortie en erreur donne un événement d\'échec qui reprend le texte d\'agy', () => {
  // Arrange
  const evenements = lignes(lance(2));
  const transcript = lignes(resultat(2, 'The command exited with code 1.'));
  // Act
  const echecs = lateFailures(evenements, transcript);
  // Assert
  expect(echecs).toEqual([{
    hook_event_name: 'PostToolUseFailure',
    _native_event: 'PostInvocation',
    session_id: CONV,
    tool_use_id: `${CONV}:2`,
    tool_name: 'run_command',
    tool_input: { CommandLine: 'cmd /c exit 3' },
    error: 'The command exited with code 1.\nStdout:\n\nStderr:',
    cwd: 'C:/projet',
    transcript_path: 'C:/t.jsonl',
  }]);
});

test('une commande sortie en 0 ne donne aucun échec', () => {
  // Arrange
  const evenements = lignes(lance(2));
  const transcript = lignes(resultat(2, 'The command exited with code 0.'));
  // Act
  const echecs = lateFailures(evenements, transcript);
  // Assert
  expect(echecs).toEqual([]);
});

test('une commande réussie dont la sortie cite un code d\'erreur n\'est pas prise pour un échec', () => {
  // Arrange
  const evenements = lignes(lance(2));
  const transcript = lignes(resultat(2, 'The command exited with code 0.', 'Output:\nThe command exited with code 3.\n'));
  // Act
  const echecs = lateFailures(evenements, transcript);
  // Assert
  expect(echecs).toEqual([]);
});

test('un appel refusé avant de s\'exécuter donne un échec qui porte la raison d\'agy', () => {
  // Arrange
  const evenements = lignes(lance(18, 'view_file', { AbsolutePath: 'C:/projet/inexistant.txt' }));
  const transcript = lignes({
    step_index: 18, source: 'MODEL', type: 'GENERIC', status: 'ERROR',
    error: 'Encountered error in step execution: file not found',
  });
  // Act
  const echecs = lateFailures(evenements, transcript);
  // Assert
  expect(echecs).toMatchObject([{
    tool_use_id: `${CONV}:18`, tool_name: 'view_file', error: 'Encountered error in step execution: file not found',
  }]);
});

test('un échec déjà écrit n\'est pas écrit une seconde fois', () => {
  // Arrange
  const evenements = lignes(lance(2), { hook_event_name: 'PostToolUseFailure', tool_use_id: `${CONV}:2` });
  const transcript = lignes(resultat(2, 'The command exited with code 1.'));
  // Act
  const echecs = lateFailures(evenements, transcript);
  // Assert
  expect(echecs).toEqual([]);
});

test('un outil dont le résultat n\'est pas encore dans le transcript est laissé tel quel', () => {
  // Arrange
  const evenements = lignes(lance(4));
  const transcript = lignes(resultat(2, 'The command exited with code 1.'));
  // Act
  const echecs = lateFailures(evenements, transcript);
  // Assert
  expect(echecs).toEqual([]);
});

test('le résultat est trouvé par son numéro d\'étape, quel que soit l\'ordre des lignes', () => {
  // Arrange
  const evenements = lignes(lance(2), lance(4));
  const transcript = lignes(resultat(4, 'The command exited with code 1.'), resultat(2, 'The command exited with code 0.'));
  // Act
  const echecs = lateFailures(evenements, transcript);
  // Assert
  expect(echecs.map(e => e.tool_use_id)).toEqual([`${CONV}:4`]);
});

test('une ligne coupée en cours d\'écriture n\'empêche pas de lire les autres', () => {
  // Arrange
  const evenements = lignes(lance(2));
  const transcript = lignes(resultat(2, 'The command exited with code 1.')) + '{"step_index":3,"sou';
  // Act
  const echecs = lateFailures(evenements, transcript);
  // Assert
  expect(echecs).toHaveLength(1);
});
