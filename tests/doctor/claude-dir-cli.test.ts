import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { runDoctorCli } from '../../src/engine/doctor/index.js';
import { promptLine, writeSessionTree } from '../helpers/build-transcript.js';

// C5 : le point de resolution REEL du moteur, celui que l'audit designe
// (netgain/src/doctor/index.ts:112). Le test de `resolveClaudeDir` prouve la
// primitive ; celui-ci prouve que le moteur la BRANCHE — sans lui, une primitive
// parfaite pourrait coexister avec une ligne 112 restee sur l'ancienne variable.
//
// On passe par `runDoctorCli` et non par la primitive : c'est la seule facon de
// voir la variable produire un effet observable de bout en bout.

const racine = mkdtempSync(path.join(tmpdir(), 'netgain-c5-'));
const home = mkdtempSync(path.join(tmpdir(), 'netgain-c5-home-'));
afterAll(() => {
  rmSync(racine, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

writeSessionTree(racine, 'F--proj-c5', 'sess-c5', [
  promptLine('bonjour', { timestamp: '2026-08-10T10:00:00.000Z', cwd: 'F:\\proj-c5' }),
]);

let sorties: string[];
const anciennes: Record<string, string | undefined> = {};

beforeEach(() => {
  sorties = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { sorties.push(String(chunk)); return true; });
  for (const nom of ['CLAUDE_CONFIG_DIR', 'NETGAIN_CLAUDE_DIR', 'HOME', 'USERPROFILE']) {
    anciennes[nom] = process.env[nom];
    delete process.env[nom];
  }
  // `os.homedir()` suit USERPROFILE sur Windows et HOME sur POSIX : on neutralise
  // le home reel pour que le REPLI soit observable, au lieu de scanner les
  // centaines de sessions de la machine.
  process.env['HOME'] = home;
  process.env['USERPROFILE'] = home;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [nom, valeur] of Object.entries(anciennes)) {
    if (valeur === undefined) delete process.env[nom];
    else process.env[nom] = valeur;
  }
});

describe('runDoctorCli — la racine scannee', () => {
  test('CLAUDE_CONFIG_DIR deplace la racine du moteur', async () => {
    process.env['CLAUDE_CONFIG_DIR'] = racine;
    expect(await runDoctorCli({ json: false, list: true })).toBe(0);
    expect(sorties.join('')).toContain(`1 session(s) découverte(s) sous ${racine}`);
  });

  // Temoin negatif. Avant C5 ce test etait VERT a l'envers : c'etait
  // NETGAIN_CLAUDE_DIR qui deplacait le moteur, et CLAUDE_CONFIG_DIR qui ne
  // faisait rien — verifie en executant les deux croisements sur le binaire
  // construit avant d'ecrire une ligne.
  test('NETGAIN_CLAUDE_DIR ne deplace plus rien — l\'ancienne variable est morte', async () => {
    process.env['NETGAIN_CLAUDE_DIR'] = racine;
    expect(await runDoctorCli({ json: false, list: true })).toBe(0);
    expect(sorties.join('')).toContain(`0 session(s) découverte(s) sous ${path.join(home, '.claude')}`);
  });

  test('--claude-dir l\'emporte toujours sur la variable', async () => {
    process.env['CLAUDE_CONFIG_DIR'] = path.join(home, '.claude');
    expect(await runDoctorCli({ json: false, list: true, claudeDir: racine })).toBe(0);
    expect(sorties.join('')).toContain(`1 session(s) découverte(s) sous ${racine}`);
  });

  // La cecite silencieuse trouvee en executant : avec `??`, une variable posee
  // mais vide faisait scanner la chaine vide et annoncer « 0 session(s)
  // découverte(s) sous  » — un utilisateur y lit « je n'ai pas de sessions ».
  test('une variable VIDE retombe sur le home, jamais sur la chaine vide', async () => {
    process.env['CLAUDE_CONFIG_DIR'] = '';
    expect(await runDoctorCli({ json: false, list: true })).toBe(0);
    expect(sorties.join('')).toContain(`0 session(s) découverte(s) sous ${path.join(home, '.claude')}`);
  });
});
