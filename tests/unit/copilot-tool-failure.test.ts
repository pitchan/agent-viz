// Copilot CLI ne signale un outil en échec que par son événement PostToolUseFailure
// (PostToolUse ne suit qu'un succès) : sans cet abonnement, l'échec n'arrive jamais.
import { afterEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install } from '../../src/server/install-hooks.ts';

const dossiers: string[] = [];

function dossierTemporaire(prefixe: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefixe));
  dossiers.push(d);
  return d;
}

afterEach(() => {
  for (const d of dossiers.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

test('le fichier de hooks Copilot écrit abonne agent-viz aux outils en échec', () => {
  // Arrange
  const projectRoot = dossierTemporaire('avtest-copilot-echec-');
  fs.mkdirSync(path.join(projectRoot, '.git'));
  const packageRoot = dossierTemporaire('avtest-pkg-copilot-echec-');

  // Act
  const result = install({ target: 'copilot', scope: 'project', cwd: projectRoot, packageRoot });

  // Assert
  const file = (result.copilot as { target: { file: string } }).target.file;
  const hooks = JSON.parse(fs.readFileSync(file, 'utf8')).hooks;
  expect(Object.keys(hooks)).toContain('PostToolUseFailure');
  expect(hooks.PostToolUseFailure[0].bash).toContain('hook --source=copilot');
});
