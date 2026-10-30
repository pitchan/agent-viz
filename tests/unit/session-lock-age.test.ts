// Un verrou trop vieux est abandonné, même si son pid répond : un pid peut avoir été redonné
// à un autre processus, alors qu'une prise légitime du verrou dure quelques millisecondes.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { withSessionLockSync } from '../../src/server/session-lock.ts';

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-session-lock-age-'));
afterAll(() => { fs.rmSync(RACINE, { recursive: true, force: true }); });

test('un verrou de plus de 30 s au pid vivant est repris', () => {
  // Arrange
  const fp = path.join(RACINE, 'vieux.jsonl');
  const verrou = `${fp}.lock`;
  fs.writeFileSync(verrou, `${process.pid} jeton-d-un-detenteur-disparu`);
  const ilYaUneMinute = new Date(Date.now() - 60_000);
  fs.utimesSync(verrou, ilYaUneMinute, ilYaUneMinute);
  // Act
  const prendre = () => withSessionLockSync(fp, () => 'pris');
  // Assert
  expect(prendre()).toBe('pris');
});
