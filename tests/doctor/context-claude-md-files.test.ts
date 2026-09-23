// findClaudeMdFiles remonte les CLAUDE.md qui existent, avec leur taille disque : ce sont
// eux qui occupent le début de contexte. Le dossier temporaire est créé et supprimé ici.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { findClaudeMdFiles } from '../../src/engine/doctor/aggregators/context.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'netgain-ctx-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test('remonte les CLAUDE.md existants (cwd, cwd/.claude, claudeDir) avec leur taille disque', () => {
  const cwd = path.join(dir, 'proj');
  const claudeDir = path.join(dir, 'home-claude');
  mkdirSync(path.join(cwd, '.claude'), { recursive: true });
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(path.join(cwd, 'CLAUDE.md'), 'x'.repeat(1234));
  writeFileSync(path.join(claudeDir, 'CLAUDE.md'), 'y'.repeat(50));
  const found = findClaudeMdFiles(cwd, claudeDir);
  expect(found).toEqual([
    { path: path.join(cwd, 'CLAUDE.md'), bytes: 1234 },
    { path: path.join(claudeDir, 'CLAUDE.md'), bytes: 50 },
  ]);
});

test('cwd null → seulement le CLAUDE.md global éventuel', () => {
  const claudeDir = path.join(dir, 'home-claude2');
  mkdirSync(claudeDir, { recursive: true });
  expect(findClaudeMdFiles(null, claudeDir)).toEqual([]);
});
