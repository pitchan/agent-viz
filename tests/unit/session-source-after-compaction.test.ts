// Une session compactée garde sa source d'agent quand un serveur relancé
// réindexe son fichier : la pastille de l'agent en dépend.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import type { SessionRecord } from '../../src/server/session-index.ts';

// Redirection AVANT le premier import : session-index calcule son dossier
// depuis os.tmpdir() au chargement.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-source-compact-'));
process.env.TMPDIR = RACINE;
process.env.TEMP = RACINE;
process.env.TMP = RACINE;

const {
  DIR, sessionIndex, idFromPath, indexSessionInitial, COMPACT_KEEP_EVENTS,
} = await import('../../src/server/session-index.ts');
const { compactSession } = await import('../../src/server/housekeep.ts');

afterAll(() => { fs.rmSync(RACINE, { recursive: true, force: true }); });

// Un événement tel que le hook l'écrit : `_source` en dernier champ, derrière
// une sortie d'outil de la taille voulue.
function evenement(i: number, octetsDeSortie: number) {
  return JSON.stringify({
    hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: `t${i}`,
    tool_response: 'x'.repeat(octetsDeSortie), _source: 'claude',
  });
}

test('après compactage, un serveur relancé retrouve la source de l’agent', async () => {
  // Arrange
  const total = COMPACT_KEEP_EVENTS + 20;
  const premiereGardee = total - COMPACT_KEEP_EVENTS;
  const lignes = Array.from({ length: total }, (_, i) => evenement(i, i === premiereGardee ? 10_000 : 10));
  const fp = path.join(DIR, 'sess-compactee.jsonl');
  fs.writeFileSync(fp, lignes.join('\n') + '\n');
  const id = idFromPath(fp);
  sessionIndex.set(id, { id, promptCache: null, size: 0, eventCount: 0, agentSource: 'claude' } as SessionRecord);
  await compactSession(fp);
  sessionIndex.delete(id);

  // Act
  await indexSessionInitial(fp);

  // Assert
  expect(sessionIndex.get(id)!.agentSource).toBe('claude');
});
