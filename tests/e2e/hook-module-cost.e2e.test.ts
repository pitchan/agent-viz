// Le hook se lance à chaque événement d'agent : charger un module lourd s'y paie à chaque
// fois. `node:crypto` en est un, et le verrou de session n'en a pas besoin pour son jeton.

import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const HOOK = pathToFileURL(fileURLToPath(new URL('../../src/server/hook.ts', import.meta.url))).href;

test('charger le hook ne charge pas node:crypto', () => {
  // Arrange
  const sonde = `await import(${JSON.stringify(HOOK)}); console.log(JSON.stringify(process.moduleLoadList));`;
  // Act
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', sonde], { encoding: 'utf8' });
  // Assert
  const charges: string[] = JSON.parse(r.stdout);
  expect(charges, 'la sonde n’a rien relevé : le test ne prouve rien').toContain('NativeModule fs');
  expect(charges).not.toContain('NativeModule crypto');
});
