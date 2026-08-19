// Le contrat qui rend l'ajout d'un 3e agent falsifiable : chaque entrée du
// registre expose les 6 méthodes d'AgentInstaller. Sans sweepTargets et
// installedIn, findInstalledScopes rebrancherait sur le nom d'agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTALLERS } from '../../src/server/install-hooks/registry.ts';

const METHODS = ['install', 'uninstall', 'audit', 'detect', 'sweepTargets', 'installedIn'];

test('chaque adaptateur du registre expose le contrat AgentInstaller complet', () => {
  // Arrange — le registre importé ci-dessus
  // Act
  const agents = Object.keys(INSTALLERS).sort();
  // Assert
  assert.deepEqual(agents, ['claude', 'copilot']);
  for (const [name, inst] of Object.entries(INSTALLERS)) {
    for (const m of METHODS) {
      assert.equal(typeof inst[m], 'function', `${name}.${m} doit être une fonction`);
    }
  }
});
