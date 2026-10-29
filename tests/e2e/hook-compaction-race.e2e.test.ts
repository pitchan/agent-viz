// De vrais processus hook écrivent une session pendant que le ménage la compacte : aucune ligne
// ne doit disparaître ni se mêler à une autre. Les hooks partent en rafale étalée et le ménage
// démarre au milieu ; sur plusieurs tours, au moins un tour tombe dans la fenêtre de réécriture.
//
// `DIR` est calculé une fois depuis `os.tmpdir()`, au chargement du module : le dossier temporaire
// est redirigé AVANT l'import dynamique, et chaque hook enfant le reçoit par l'environnement.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, test } from 'vitest';

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-hook-compaction-'));
process.env.TMPDIR = RACINE;
process.env.TEMP = RACINE;
process.env.TMP = RACINE;

const { indexSessionInitial } = await import('../../src/server/session-index.ts');
const { compactSession } = await import('../../src/server/housekeep.ts');

const HOOK = fileURLToPath(new URL('../../src/server/hook.ts', import.meta.url));
const DOSSIER = path.join(RACINE, 'agent-events');
fs.mkdirSync(DOSSIER, { recursive: true });

afterAll(() => { fs.rmSync(RACINE, { recursive: true, force: true }); });

const TOURS = 6;
const HOOKS_PAR_TOUR = 20;
const ANCIENNES = 300;
const REMPLISSAGE = 'x'.repeat(50 * 1024);

function evenement(sid: string, id: string): string {
  return JSON.stringify({ session_id: sid, hook_event_name: 'PostToolUse', tool_use_id: id, pad: REMPLISSAGE });
}

// Le port pointe vers personne : le POST /notify est en « tire et oublie ».
function demarreUnHook() {
  return spawn(process.execPath, [HOOK, '--source=claude'], {
    env: { ...process.env, AGENT_VIZ_PORT: '59999' },
    stdio: ['pipe', 'ignore', 'ignore'],
  });
}

const attends = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function unTour(tour: number): Promise<{ manquants: string[]; illisibles: number }> {
  const sid = `sess-course-${tour}`;
  const fp = path.join(DOSSIER, `${sid}.jsonl`);
  fs.writeFileSync(fp, Array.from({ length: ANCIENNES }, (_, i) => evenement(sid, `ancien${i}`)).join('\n') + '\n');
  await indexSessionInitial(fp);
  const hooks = Array.from({ length: HOOKS_PAR_TOUR }, demarreUnHook);
  const finis = hooks.map(h => new Promise(resolve => h.on('close', resolve)));
  await attends(1200);
  hooks.forEach((h, i) => setTimeout(() => h.stdin.end(evenement(sid, `neuf${i}`)), i * 2));
  const menage = attends(HOOKS_PAR_TOUR).then(() => compactSession(fp));
  await Promise.all([...finis, menage]);
  const ids = new Set<unknown>();
  let illisibles = 0;
  for (const ligne of fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean)) {
    try { ids.add(JSON.parse(ligne).tool_use_id); } catch { illisibles++; }
  }
  const manquants = Array.from({ length: HOOKS_PAR_TOUR }, (_, i) => `neuf${i}`).filter(id => !ids.has(id));
  return { manquants, illisibles };
}

test('un événement écrit par un hook pendant le ménage reste dans le fichier, entier', async () => {
  // Arrange
  const bilan = { manquants: [] as string[], illisibles: 0 };
  // Act
  for (let tour = 0; tour < TOURS; tour++) {
    const r = await unTour(tour);
    bilan.manquants.push(...r.manquants.map(id => `tour ${tour} : ${id}`));
    bilan.illisibles += r.illisibles;
  }
  // Assert
  expect(bilan.manquants, 'événements de hook perdus par la réécriture du ménage').toEqual([]);
  expect(bilan.illisibles, 'lignes mêlées ou tronquées dans le fichier de session').toBe(0);
}, 60_000);
