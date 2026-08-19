import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanInstalled } from '../../src/server/install-hooks/scopes.ts';

test('scanInstalled ne garde que les cibles existantes reconnues par installedIn', () => {
  // Arrange
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
  const yes = path.join(dir, 'a.json'); fs.writeFileSync(yes, '{}');
  const no = path.join(dir, 'b.json'); fs.writeFileSync(no, '{}');
  const targets = [
    { scope: 'user', file: yes, projectRoot: null },
    { scope: 'project', file: no, projectRoot: dir },
    { scope: 'local', file: path.join(dir, 'absent.json'), projectRoot: dir },
  ];
  // Act
  const got = scanInstalled(targets, (f) => f === yes);
  // Assert
  assert.deepEqual(got, [{ scope: 'user', file: yes }]);
  fs.rmSync(dir, { recursive: true, force: true });
});
