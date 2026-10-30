// Le résumé d'une session compactée n'existe que si la compaction a eu lieu : le tableau de
// bord affiche « compactée » toute session qui a un `.summary.json`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import type { SessionRecord } from '../../src/server/session-index.ts';

// Le dossier d'événements est calculé au chargement de session-index : redirigé AVANT l'import.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-housekeep-summary-'));
process.env.TMPDIR = RACINE;
process.env.TEMP = RACINE;
process.env.TMP = RACINE;

const { DIR, sessionIndex, COMPACT_KEEP_EVENTS } = await import('../../src/server/session-index.ts');
const { compactSession } = await import('../../src/server/housekeep.ts');
const { withSessionLock } = await import('../../src/server/session-lock.ts');

fs.mkdirSync(DIR, { recursive: true });
afterAll(() => { fs.rmSync(RACINE, { recursive: true, force: true }); });

test('un ménage qui ne peut pas prendre le verrou ne laisse pas de résumé', async () => {
  // Arrange
  const nom = 'sans-compaction';
  const fp = path.join(DIR, `${nom}.jsonl`);
  const lignes = Array.from({ length: COMPACT_KEEP_EVENTS + 30 }, (_, i) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_use_id: `t${i}` }));
  fs.writeFileSync(fp, lignes.join('\n') + '\n');
  sessionIndex.set(nom, { id: nom, promptCache: null, size: 0, eventCount: 0 } as SessionRecord);
  // Act
  await withSessionLock(fp, () => compactSession(fp));
  // Assert
  expect(fs.existsSync(path.join(DIR, `${nom}.summary.json`)), 'un résumé annonce une compaction qui n’a pas eu lieu').toBe(false);
}, 20_000);
