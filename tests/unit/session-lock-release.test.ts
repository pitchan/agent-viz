// Rendre le verrou d'une session : le détenteur ne supprime que son propre verrou, et un
// verrou déjà disparu n'est pas une erreur. Le verrou vit à côté du fichier, en `<fichier>.lock`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { withSessionLock, withSessionLockSync } from '../../src/server/session-lock.ts';

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-session-lock-'));
afterAll(() => { fs.rmSync(RACINE, { recursive: true, force: true }); });

test('un verrou disparu pendant qu’on le tient se rend sans erreur', () => {
  // Arrange
  const fp = path.join(RACINE, 'disparu.jsonl');
  // Act
  const rendre = () => withSessionLockSync(fp, () => fs.unlinkSync(`${fp}.lock`));
  // Assert
  expect(rendre).not.toThrow();
});

test('rendre son verrou ne supprime pas celui qu’un autre a pris entre-temps', async () => {
  // Arrange
  const fp = path.join(RACINE, 'repris.jsonl');
  const verrou = `${fp}.lock`;
  // Act
  await withSessionLock(fp, async () => {
    fs.unlinkSync(verrou);
    fs.writeFileSync(verrou, 'un autre détenteur');
  });
  // Assert
  expect(fs.readFileSync(verrou, 'utf8'), 'le verrou d’un autre a été supprimé').toBe('un autre détenteur');
});
