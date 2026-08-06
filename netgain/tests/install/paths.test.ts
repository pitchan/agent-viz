import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import {
  canonicalProjectKey,
  missingDistFiles,
  resolveInstallPaths,
  resolveNetgainRoot,
  samePath,
} from '../../src/install/paths.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'netgain-paths-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('canonicalProjectKey', () => {
  test('normalise en chemin absolu POSIX — le format de clé que lit/écrit Claude Code actuel (vérifié par claude mcp add, essai réel 2026-07-13)', () => {
    expect(canonicalProjectKey('F:\\DEV\\VANLIFE')).toBe('F:/DEV/VANLIFE');
    expect(canonicalProjectKey('F:/DEV/VANLIFE')).toBe('F:/DEV/VANLIFE');
  });

  test('résout un chemin relatif depuis le cwd', () => {
    expect(canonicalProjectKey('.')).toBe(process.cwd().replace(/\\/g, '/'));
  });
});

describe('samePath', () => {
  test('séparateurs mélangés = même chemin', () => {
    expect(samePath('F:/DEV/VANLIFE', 'F:\\DEV\\VANLIFE')).toBe(true);
  });

  test('casse différente = même chemin (win32)', () => {
    expect(samePath('F:/dev/vanlife', 'F:\\DEV\\VANLIFE')).toBe(true);
  });

  test('chemins différents ne matchent pas', () => {
    expect(samePath('F:/DEV/VANLIFE', 'F:/DEV/oms3')).toBe(false);
  });
});

describe('resolveInstallPaths', () => {
  test('NETGAIN_HOME redirige la racine home vers $NETGAIN_HOME/.claude.json', () => {
    const p = resolveInstallPaths('F:/DEV/VANLIFE', { NETGAIN_HOME: 'D:\\fakehome' });
    expect(p.claudeJsonPath).toBe('D:\\fakehome\\.claude.json');
    expect(p.settingsLocalPath).toBe('F:\\DEV\\VANLIFE\\.claude\\settings.local.json');
    expect(p.repoDir).toBe('F:\\DEV\\VANLIFE');
  });

  test('sans NETGAIN_HOME, .claude.json est à la RACINE du home (pas sous ~/.claude/)', () => {
    const p = resolveInstallPaths('.', {});
    expect(p.claudeJsonPath).toBe(path.join(homedir(), '.claude.json'));
  });
});

describe('resolveNetgainRoot', () => {
  test('remonte à la racine du paquet netgain (contient package.json)', () => {
    const root = resolveNetgainRoot();
    expect(root).toBe(path.resolve(import.meta.dirname, '..', '..'));
    expect(existsSync(path.join(root, 'package.json'))).toBe(true);
  });
});

describe('missingDistFiles', () => {
  test('liste les fichiers dist requis manquants, puis se vide quand ils existent', () => {
    expect(missingDistFiles(scratch)).toEqual(['dist/cli.js', 'dist/mcp/main.js']);

    mkdirSync(path.join(scratch, 'dist', 'mcp'), { recursive: true });
    writeFileSync(path.join(scratch, 'dist', 'cli.js'), '');
    expect(missingDistFiles(scratch)).toEqual(['dist/mcp/main.js']);

    writeFileSync(path.join(scratch, 'dist', 'mcp', 'main.js'), '');
    expect(missingDistFiles(scratch)).toEqual([]);
  });
});
