import { expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanInstalled } from '../../src/server/install-hooks/scopes.ts';
import type { ResolvedTarget } from '../../src/server/install-hooks/types.ts';

test('scanInstalled ne garde que les cibles existantes reconnues par installedIn', () => {
  // Arrange
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
  const yes = path.join(dir, 'a.json'); fs.writeFileSync(yes, '{}');
  const no = path.join(dir, 'b.json'); fs.writeFileSync(no, '{}');
  const targets: ResolvedTarget[] = [
    { scope: 'user', file: yes, projectRoot: null },
    { scope: 'project', file: no, projectRoot: dir },
    { scope: 'local', file: path.join(dir, 'absent.json'), projectRoot: dir },
  ];
  // Act
  const got = scanInstalled(targets, (f) => f === yes);
  // Assert
  expect(got).toEqual({ installed: [{ scope: 'user', file: yes }], unreadable: [] });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scanInstalled compte a part une cible que installedIn ne sait pas lire', () => {
  // Arrange
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
  const sain = path.join(dir, 'sain.json'); fs.writeFileSync(sain, '{}');
  const casse = path.join(dir, 'casse.json'); fs.writeFileSync(casse, '{');
  const targets: ResolvedTarget[] = [
    { scope: 'user', file: sain, projectRoot: null },
    { scope: 'project', file: casse, projectRoot: dir },
  ];
  // Act
  const got = scanInstalled(targets, (f) => {
    if (f === casse) throw new Error(`${f} invalide : Unexpected end of JSON input`);
    return true;
  });
  // Assert
  expect(got.installed, 'la portee saine reste installee malgre la voisine illisible').toEqual([{ scope: 'user', file: sain }]);
  expect(got.unreadable.map(u => u.scope), 'la cible illisible est comptee a part, jamais comme « pas de hook »').toEqual(['project']);
  expect(got.unreadable[0]?.error).toMatch(/Unexpected end of JSON input/);
  fs.rmSync(dir, { recursive: true, force: true });
});
