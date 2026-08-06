import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export type JsonlLine = { ok: true; value: unknown } | { ok: false; rawLength: number };

/**
 * Lit un fichier JSONL en flux, une ligne = un événement.
 * Ne throw jamais sur une ligne cassée : elle est signalée { ok: false }
 * et la lecture continue (principe : casser bruyamment, pas silencieusement).
 */
export async function* iterJsonlLines(filePath: string): AsyncGenerator<JsonlLine> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let first = true;
  try {
    for await (let line of rl) {
      if (first) {
        first = false;
        if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
      }
      const trimmed = line.trim();
      if (trimmed === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        yield { ok: false, rawLength: trimmed.length };
        continue;
      }
      yield { ok: true, value: parsed };
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}
