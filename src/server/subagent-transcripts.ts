// Où sont les transcripts propres des sous-agents d'une session : à côté du transcript de la
// session (Claude Code), ou nommés par les événements du hook (Codex). Ne lit aucun jeton.

import fs from 'node:fs';
const fsp = fs.promises;
import path from 'node:path';

import { decodeJsonlLine } from '../engine/core/jsonl.ts';
import type { SubagentTranscript, TranscriptAdapter } from './transcript-adapters/types.ts';

// Claude Code écrit chaque sous-agent dans <dir>/<session>/subagents/agent-<agentId>.jsonl.
async function subagentFilesBeside(mainPath: string): Promise<SubagentTranscript[]> {
  const subDir = path.join(path.dirname(mainPath), path.basename(mainPath, '.jsonl'), 'subagents');
  let files: string[];
  try { files = await fsp.readdir(subDir); }
  catch { return []; } // pas de dossier subagents/ : la session n'a pas (encore) de sous-agent
  const found: SubagentTranscript[] = [];
  for (const f of files) {
    const m = /^agent-(.+)\.jsonl$/.exec(f);
    // Le groupe `(.+)` exige un caractère : dès que `m` matche, `m[1]` est défini.
    if (m && m[1]) found.push({ agentId: m[1], path: path.join(subDir, f) });
  }
  return found;
}

/** Octets du fichier d'événements déjà parcourus. */
export interface EventsCursor {
  offset: number;
}

// Seules les lignes complètes ajoutées depuis le dernier passage sont lues ; un fichier compacté,
// plus court que le curseur, est relu depuis le début.
async function subagentsNamedByEvents(
  sessionFile: string,
  cursor: EventsCursor,
  adapter: TranscriptAdapter,
): Promise<SubagentTranscript[]> {
  let text: string;
  try {
    const size = (await fsp.stat(sessionFile)).size;
    const from = size < cursor.offset ? 0 : cursor.offset;
    const buf = Buffer.alloc(size - from);
    const fh = await fsp.open(sessionFile, 'r');
    try { await fh.read(buf, 0, buf.length, from); } finally { await fh.close(); }
    const end = buf.lastIndexOf(0x0a) + 1;
    text = buf.toString('utf8', 0, end);
    cursor.offset = from + end;
  } catch { return []; } // fichier d'événements supprimé entre-temps : la session part avec lui
  const found: SubagentTranscript[] = [];
  for (const line of text.split('\n')) {
    if (line.indexOf('"agent_id"') === -1) continue;
    const verdict = decodeJsonlLine(line);
    if (!verdict || !verdict.ok) continue;
    const named = adapter.subagentTranscript(verdict.value);
    if (named) found.push(named);
  }
  return found;
}

export { subagentFilesBeside, subagentsNamedByEvents };
