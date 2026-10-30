// Le hook face au verrou de session, en vrais processus : il ne passe jamais outre un verrou
// tenu par un processus vivant, et reprend celui d'un processus mort en le tenant.
//
// `DIR` est calculé une fois depuis `os.tmpdir()`, au chargement du module : le dossier temporaire
// est redirigé AVANT l'import dynamique, et chaque enfant le reçoit par l'environnement.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, expect, test } from 'vitest';

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-hook-lock-'));
process.env.TMPDIR = RACINE;
process.env.TEMP = RACINE;
process.env.TMP = RACINE;

const { withSessionLock } = await import('../../src/server/session-lock.ts');

const HOOK = fileURLToPath(new URL('../../src/server/hook.ts', import.meta.url));
const VERROU = pathToFileURL(fileURLToPath(new URL('../../src/server/session-lock.ts', import.meta.url))).href;
const DOSSIER = path.join(RACINE, 'agent-events');
fs.mkdirSync(DOSSIER, { recursive: true });

afterAll(() => { fs.rmSync(RACINE, { recursive: true, force: true }); });

function lanceLeHook(sid: string) {
  return spawnSync(process.execPath, [HOOK, '--source=claude'], {
    input: JSON.stringify({ session_id: sid, hook_event_name: 'PreToolUse', tool_name: 'Read' }),
    env: { ...process.env, AGENT_VIZ_PORT: '59999' },
  });
}

function journal(): string {
  try { return fs.readFileSync(path.join(DOSSIER, '_hook-errors.log'), 'utf8'); } catch { return ''; }
}

test('un hook ne passe pas outre un verrou tenu par un processus vivant, et le dit', async () => {
  // Arrange
  const sid = 'sess-verrou-tenu';
  const fp = path.join(DOSSIER, `${sid}.jsonl`);
  // Act
  await withSessionLock(fp, async () => { lanceLeHook(sid); });
  // Assert
  expect(fs.existsSync(fp), 'le hook a écrit malgré le verrou').toBe(false);
  expect(journal(), 'le refus doit nommer le verrou').toMatch(/session lock/);
  expect(journal(), 'un refus de verrou n’est pas une charge rejetée').not.toMatch(/payload rejected/);
}, 20_000);

test('un verrou laissé par un processus mort est repris par le hook', () => {
  // Arrange
  const sid = 'sess-verrou-abandonne';
  const fp = path.join(DOSSIER, `${sid}.jsonl`);
  const meurtEnTenantLeVerrou = `import(${JSON.stringify(VERROU)}).then(m => m.withSessionLockSync(${JSON.stringify(fp)}, () => process.exit(0)))`;
  spawnSync(process.execPath, ['--input-type=module', '-e', meurtEnTenantLeVerrou]);
  const verrouLaisse = fs.existsSync(`${fp}.lock`);
  // Act
  lanceLeHook(sid);
  // Assert
  expect(verrouLaisse, 'le processus mort n’a pas laissé de verrou : le test ne prouve rien').toBe(true);
  const ligne = JSON.parse(fs.readFileSync(fp, 'utf8').trim());
  expect(ligne.session_id).toBe(sid);
}, 20_000);
