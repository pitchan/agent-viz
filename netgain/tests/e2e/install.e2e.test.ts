import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { canonicalProjectKey, missingDistFiles } from '../../src/install/paths.js';

const netgainRoot = path.resolve(import.meta.dirname, '..', '..');
const tsxCli = path.join(netgainRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const home = mkdtempSync(path.join(tmpdir(), 'netgain-install-home-'));
const repo = mkdtempSync(path.join(tmpdir(), 'netgain-install-repo-'));
afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

beforeAll(() => {
  // `on` exige dist présent (l'entrée MCP pointe dist/) — build si absent
  if (missingDistFiles(netgainRoot).length > 0) {
    execFileSync(process.execPath, [path.join(netgainRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'], {
      cwd: netgainRoot,
    });
  }
}, 120_000);

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [tsxCli, path.join(netgainRoot, 'src', 'cli.ts'), ...args], {
    encoding: 'utf8',
    cwd: netgainRoot,
    env: { ...process.env, NETGAIN_HOME: home },
  });
  return { code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

const claudeJsonPath = path.join(home, '.claude.json');
const settingsLocalPath = path.join(repo, '.claude', 'settings.local.json');
const canonicalKey = canonicalProjectKey(repo); // posix — le format que lit Claude Code actuel
const nativeVariantKey = path.resolve(repo); // backslash — variante héritée d'anciennes versions
const etrangerHook = { type: 'command', command: 'echo salut' };

function readClaudeJson(): any {
  return JSON.parse(readFileSync(claudeJsonPath, 'utf8').replace(/^﻿/, ''));
}

describe('netgain on/off/status bout-en-bout (NETGAIN_HOME)', () => {
  test('scénario complet : vierge → on → status → on bis octet-identique → off → off bis', () => {
    // 1. status sur home vierge : OFF, exit 1
    const vierge = runCli(['status', repo]);
    expect(vierge.code).toBe(1);

    // 2. pré-seed : home BOM + indent 4 + entrées étrangères + variante backslash portant une VIEILLE entrée netgain-map
    const seeded = {
      installMethod: 'native',
      projects: {
        [nativeVariantKey]: {
          lastCost: 9.99,
          mcpServers: {
            'netgain-map': { type: 'stdio', command: 'node', args: ['C:/vieux/main.js', 'C:/vieux'] },
            etranger: { type: 'stdio', command: 'x' },
          },
        },
        'F:\\autre\\projet': { mcpServers: {} },
      },
    };
    writeFileSync(claudeJsonPath, `﻿${JSON.stringify(seeded, null, 4)}\n`);
    mkdirSync(path.dirname(settingsLocalPath), { recursive: true });
    writeFileSync(settingsLocalPath, `${JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [etrangerHook] }] } }, null, 2)}\n`);

    // 3. on : exit 0, étrangers intacts, variante backslash vidée de NOTRE entrée seulement, clé canonique posix posée
    const on = runCli(['on', repo]);
    expect(on.stderr).toBe('');
    expect(on.code).toBe(0);
    const afterOn = readClaudeJson();
    expect(afterOn.installMethod).toBe('native');
    expect(afterOn.projects[nativeVariantKey].lastCost).toBe(9.99);
    expect(afterOn.projects[nativeVariantKey].mcpServers['netgain-map']).toBeUndefined();
    expect(afterOn.projects[nativeVariantKey].mcpServers.etranger).toEqual({ type: 'stdio', command: 'x' });
    expect(afterOn.projects['F:\\autre\\projet']).toEqual({ mcpServers: {} });
    const canonical = afterOn.projects[canonicalKey];
    expect(canonical.mcpServers['netgain-map'].args[1]).toBe(canonicalKey);
    // indentation 4 préservée, BOM non réintroduit
    const raw = readFileSync(claudeJsonPath, 'utf8');
    expect(raw.charCodeAt(0)).not.toBe(0xfeff);
    expect(raw.split('\n')[1]).toMatch(/^ {4}"/);
    const localAfterOn = JSON.parse(readFileSync(settingsLocalPath, 'utf8'));
    expect(localAfterOn.hooks.UserPromptSubmit[0]).toEqual({ hooks: [etrangerHook] });
    expect(localAfterOn.hooks.UserPromptSubmit[1].hooks[0].command).toContain('router-hook');

    // 4. status : exit 0, version + notes d'effet
    const status = runCli(['status', repo]);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain('prochain démarrage');
    expect(status.stdout).toContain('à chaud');
    expect(status.stdout).not.toContain('saved');

    // 5. on bis : exit 0 et fichiers octet-identiques (aucune réécriture)
    const homeBytes = readFileSync(claudeJsonPath);
    const localBytes = readFileSync(settingsLocalPath);
    const onBis = runCli(['on', repo]);
    expect(onBis.code).toBe(0);
    expect(readFileSync(claudeJsonPath).equals(homeBytes)).toBe(true);
    expect(readFileSync(settingsLocalPath).equals(localBytes)).toBe(true);

    // 6. off : exit 0, étrangers intacts, nos entrées disparues
    const off = runCli(['off', repo]);
    expect(off.code).toBe(0);
    const afterOff = readClaudeJson();
    expect(afterOff.projects[nativeVariantKey].mcpServers.etranger).toEqual({ type: 'stdio', command: 'x' });
    expect(afterOff.projects[canonicalKey].mcpServers['netgain-map']).toBeUndefined();
    const localAfterOff = JSON.parse(readFileSync(settingsLocalPath, 'utf8'));
    expect(localAfterOff.hooks.UserPromptSubmit).toEqual([{ hooks: [etrangerHook] }]);

    // 7. off bis : idempotent, exit 0
    expect(runCli(['off', repo]).code).toBe(0);

    // 8. status final : OFF, exit 1
    expect(runCli(['status', repo]).code).toBe(1);
  }, 60_000);

  test('home invalide {oops : on exit 1, fichier intact octet pour octet', () => {
    writeFileSync(claudeJsonPath, '{oops');
    const before = readFileSync(claudeJsonPath);
    const on = runCli(['on', repo]);
    expect(on.code).toBe(1);
    expect(on.stderr).toContain('.claude.json');
    expect(readFileSync(claudeJsonPath).equals(before)).toBe(true);
  }, 60_000);

  test('répertoire inexistant : exit 2', () => {
    const res = runCli(['on', path.join(repo, 'nexiste-pas')]);
    expect(res.code).toBe(2);
  }, 60_000);
});
