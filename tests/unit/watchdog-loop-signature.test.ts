// Ce qui fait que deux appels sont « le même appel » pour le détecteur.
//
// Claude Code joint à chaque commande un libellé (`description`) que le modèle
// réécrit d'un appel à l'autre : il ne change rien à ce que la commande FAIT,
// donc il ne doit pas séparer deux répétitions. Tout autre champ, lui, compte.

import { expect, test } from 'vitest';
import { createWatchdog, type Alert } from '../../src/engine/watchdog/detector.ts';

const T = 1_700_000_000_000;
const SID = 'sess-1';
const RANGS = ['1st', '2nd', '3rd', '4th', '5th'];

interface Appel { tool: string; input: Record<string, unknown>; }

const pre = (i: number, { tool, input }: Appel) => ({
  hook_event_name: 'PreToolUse', session_id: SID, tool_name: tool,
  tool_use_id: `t${i}`, tool_input: input, cwd: 'f:\\p',
  _ts: new Date(T + i * 2000).toISOString(),
});
const fail = (i: number, { tool, input }: Appel) => ({
  hook_event_name: 'PostToolUseFailure', session_id: SID, tool_name: tool,
  tool_use_id: `t${i}`, tool_input: input, cwd: 'f:\\p',
  _ts: new Date(T + i * 2000 + 500).toISOString(),
});

// Les cinq appels relevés sur une session réelle : même commande, libellé qui change.
const gitStatus = (tool = 'Bash'): Appel[] => RANGS.map(rang => ({
  tool, input: { command: 'git status', description: `Check git status (${rang} run)` },
}));

function alertesDe(evenements: object[]): Alert[] {
  const wd = createWatchdog({ now: () => T + 60_000 });
  return evenements.flatMap(evt => wd.processEvent(evt).newAlerts);
}

test('une commande Bash relancee sous un libelle different a chaque fois est une boucle', () => {
  // Arrange
  const evenements = gitStatus().map((appel, i) => pre(i, appel));

  // Act
  const alertes = alertesDe(evenements);

  // Assert
  expect(alertes.map(a => a.type)).toEqual(['loop']);
  expect(alertes[0]!.subject).toBe('git status');
  expect(alertes[0]!.count, 'l alerte se leve au seuil, au quatrieme appel').toBe(4);
});

test('une commande PowerShell relancee sous un libelle different est une boucle elle aussi', () => {
  // Arrange
  const evenements = gitStatus('PowerShell').map((appel, i) => pre(i, appel));

  // Act
  const alertes = alertesDe(evenements);

  // Assert
  expect(alertes.map(a => a.type)).toEqual(['loop']);
});

test('des commandes Bash differentes sous le meme libelle ne sont pas une boucle', () => {
  // Arrange
  const evenements = RANGS.map((_, i) => pre(i, {
    tool: 'Bash', input: { command: `git show HEAD~${i}`, description: 'Inspect history' },
  }));

  // Act
  const alertes = alertesDe(evenements);

  // Assert
  expect(alertes).toEqual([]);
});

test('lire le meme fichier a des positions differentes n est pas une boucle', () => {
  // Arrange
  const evenements = RANGS.map((_, i) => pre(i, {
    tool: 'Read', input: { file_path: 'f:\\p\\gros.log', offset: i * 2000, limit: 2000 },
  }));

  // Act
  const alertes = alertesDe(evenements);

  // Assert
  expect(alertes).toEqual([]);
});

test('hors des outils a libelle, un champ description distingue toujours deux appels', () => {
  // Arrange
  const evenements = RANGS.map((rang, i) => pre(i, {
    tool: 'Agent', input: { prompt: 'Explore', description: `Passe ${rang}` },
  }));

  // Act
  const alertes = alertesDe(evenements);

  // Assert
  expect(alertes).toEqual([]);
});

test('la meme commande qui echoue sous des libelles differents ne leve que la boucle', () => {
  // Arrange
  const evenements = gitStatus().flatMap((appel, i) => [pre(i, appel), fail(i, appel)]);

  // Act
  const alertes = alertesDe(evenements);

  // Assert
  expect(alertes.map(a => a.type), 'retryStorm doit reconnaitre la repetition que loop compte').toEqual(['loop']);
});
