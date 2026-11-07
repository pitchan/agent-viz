// Un sous-agent en arrière-plan que la fin du tour laisse ouvert ne se ferme, sans compte rendu,
// qu'à la fin de session : l'écran ne la lit que si l'installation abonne Claude Code à SessionEnd.

import { expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install, _internals } from '../../src/server/install-hooks.ts';

test('EVENTS: Claude Code est abonné à la fin de session', () => {
  // Arrange
  const agent = 'claude';
  // Act
  const evenements = _internals.eventsFor(agent);
  // Assert
  expect(evenements).toContain('SessionEnd');
});

test('install: une installation de Claude Code écrit le hook de fin de session', () => {
  // Arrange
  const projet = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-sessionend-'));
  const paquet = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-pkg-'));
  fs.mkdirSync(path.join(projet, '.git'));
  // Act
  install({ target: 'claude', scope: 'project', cwd: projet, packageRoot: paquet });
  // Assert
  const ecrit = JSON.parse(fs.readFileSync(path.join(projet, '.claude', 'settings.json'), 'utf8'));
  fs.rmSync(projet, { recursive: true, force: true });
  fs.rmSync(paquet, { recursive: true, force: true });
  expect(ecrit.hooks.SessionEnd?.[0]?.hooks?.[0]?.command).toMatch(/hook/);
});
