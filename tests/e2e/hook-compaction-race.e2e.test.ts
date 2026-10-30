// Un vrai processus hook écrit dans une session pendant que le ménage lit ce gros fichier :
// la lecture se fait sans verrou, donc le hook passe aussitôt, et sa ligne survit à la
// réécriture. La lecture est injectée pour placer le hook à cet instant précis.
//
// `DIR` est calculé une fois depuis `os.tmpdir()`, au chargement du module : le dossier temporaire
// est redirigé AVANT l'import dynamique, et le hook enfant le reçoit par l'environnement.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, test } from 'vitest';

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-hook-compaction-'));
process.env.TMPDIR = RACINE;
process.env.TEMP = RACINE;
process.env.TMP = RACINE;

const { indexSessionInitial, COMPACT_KEEP_EVENTS } = await import('../../src/server/session-index.ts');
const { compactSession } = await import('../../src/server/housekeep.ts');

const HOOK = fileURLToPath(new URL('../../src/server/hook.ts', import.meta.url));
const DOSSIER = path.join(RACINE, 'agent-events');
fs.mkdirSync(DOSSIER, { recursive: true });

afterAll(() => { fs.rmSync(RACINE, { recursive: true, force: true }); });

function evenement(sid: string, id: string): string {
  return JSON.stringify({ session_id: sid, hook_event_name: 'PostToolUse', tool_use_id: id });
}

// Le port pointe vers personne : le POST /notify est en « tire et oublie ».
function lanceLeHook(charge: string) {
  return spawnSync(process.execPath, [HOOK, '--source=claude'], {
    input: charge,
    env: { ...process.env, AGENT_VIZ_PORT: '59999' },
  });
}

test('un hook qui écrit pendant que le ménage lit le fichier passe, et sa ligne reste', async () => {
  // Arrange
  const sid = 'sess-pendant-lecture';
  const fp = path.join(DOSSIER, `${sid}.jsonl`);
  const anciens = Array.from({ length: COMPACT_KEEP_EVENTS + 30 }, (_, i) => evenement(sid, `ancien${i}`));
  fs.writeFileSync(fp, anciens.join('\n') + '\n');
  await indexSessionInitial(fp);
  const lectureTraverseeParUnHook = async (p: string) => {
    const contenu = await fs.promises.readFile(p, 'utf8');
    lanceLeHook(evenement(sid, 'pendant'));
    return contenu;
  };
  // Act
  await compactSession(fp, lectureTraverseeParUnHook);
  // Assert
  const derniere = JSON.parse(fs.readFileSync(fp, 'utf8').trim().split('\n').at(-1)!);
  expect(derniere.tool_use_id, 'la ligne du hook a été perdue ou n’a pas été écrite').toBe('pendant');
  expect(fs.existsSync(path.join(DOSSIER, '_hook-errors.log')), 'le hook a échoué en attendant le ménage').toBe(false);
}, 20_000);
