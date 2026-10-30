// Le ménage face au verrou de session : s'il ne peut pas le prendre, il renonce sans rejeter
// (le démarrage du serveur attend le ménage) et sans toucher au fichier ; supprimer une
// session supprime aussi son verrou.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import type { SessionRecord } from '../../src/server/session-index.ts';

// Le dossier d'événements est calculé au chargement de session-index : redirigé AVANT l'import.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-housekeep-lock-'));
process.env.TMPDIR = RACINE;
process.env.TEMP = RACINE;
process.env.TMP = RACINE;

const { DIR, sessionIndex, COMPACT_KEEP_EVENTS } = await import('../../src/server/session-index.ts');
const { compactSession } = await import('../../src/server/housekeep.ts');
const { deleteSession } = await import('../../src/server/event-reader.ts');
const { withSessionLock } = await import('../../src/server/session-lock.ts');

fs.mkdirSync(DIR, { recursive: true });
afterAll(() => { fs.rmSync(RACINE, { recursive: true, force: true }); });

function grosseSession(nom: string): string {
  const fp = path.join(DIR, `${nom}.jsonl`);
  const lignes = Array.from({ length: COMPACT_KEEP_EVENTS + 30 }, (_, i) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_use_id: `t${i}` }));
  fs.writeFileSync(fp, lignes.join('\n') + '\n');
  sessionIndex.set(nom, { id: nom, promptCache: null, size: 0, eventCount: 0 } as SessionRecord);
  return fp;
}

test('un ménage qui ne peut pas prendre le verrou renonce sans rejeter ni réécrire', async () => {
  // Arrange
  const fp = grosseSession('verrou-occupe');
  const avant = fs.readFileSync(fp, 'utf8');
  // Act
  const menage = withSessionLock(fp, () => compactSession(fp));
  // Assert
  await expect(menage).resolves.toBeUndefined();
  expect(fs.readFileSync(fp, 'utf8'), 'le fichier a été réécrit sans le verrou').toBe(avant);
}, 20_000);

test('supprimer une session supprime aussi son verrou', async () => {
  // Arrange
  const fp = grosseSession('supprimee');
  fs.writeFileSync(`${fp}.lock`, '');
  // Act
  await deleteSession(fp);
  // Assert
  expect(fs.existsSync(`${fp}.lock`), 'le verrou de la session supprimée reste sur le disque').toBe(false);
});
