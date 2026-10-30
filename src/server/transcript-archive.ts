// Codex remplace ses anciens transcripts `x.jsonl` par `x.jsonl.zst`, que plus rien ne fait
// grossir, alors que ses événements nomment toujours `x.jsonl`. Le décodeur zstd est celui de
// node:zlib, présent dans toutes les versions de Node que le paquet accepte.

import fs from 'node:fs';
const fsp = fs.promises;
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const zstdDecompress = promisify(zlib.zstdDecompress);

function archiveOf(transcriptPath: string): string {
  return transcriptPath + '.zst';
}

async function exists(file: string): Promise<boolean> {
  try { await fsp.access(file); return true; } catch { return false; }
}

/** Le transcript est sur le disque, tel quel ou compressé. */
async function transcriptOnDisk(transcriptPath: string): Promise<boolean> {
  return await exists(transcriptPath) || await exists(archiveOf(transcriptPath));
}

/** Le texte du transcript compressé ; `null` quand il n'y en a pas ou qu'il ne se décode pas. */
async function readArchivedTranscript(transcriptPath: string): Promise<string | null> {
  let compressed: Buffer;
  try { compressed = await fsp.readFile(archiveOf(transcriptPath)); }
  catch { return null; }
  try { return (await zstdDecompress(compressed)).toString('utf8'); }
  catch (err: unknown) {
    console.error(`[transcript] archive illisible ${archiveOf(transcriptPath)} : ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export { transcriptOnDisk, readArchivedTranscript };
