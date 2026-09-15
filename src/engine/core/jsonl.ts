import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export type JsonlLine = { ok: true; value: unknown } | { ok: false; rawLength: number };

/**
 * LA décision sur une ligne, à un seul endroit ; la façon de lire reste aux appelants.
 *
 * Tout le blanc d'ECMAScript est toléré autour de la ligne, BOM compris : `trim()` retire
 * U+FEFF, U+00A0, U+2009 ou U+2028, que `JSON.parse` seul refuse. Le restreindre ferait
 * rejeter en silence des lignes lisibles écrites par un tiers.
 *
 * Aucun retrait explicite du BOM : un retrait « première ligne seulement » ne changeait jamais
 * l'issue, `trim()` le fait sur toutes les lignes (tests/core/jsonl-decode-line.test.ts).
 *
 * `{ ok: true }` promet un JSON valide, PAS un objet : `null`, `42` et `"texte"` en sont ;
 * vérifier la forme appartient à l'appelant, qui seul sait quel enregistrement il attend.
 * @param line la ligne brute, séparateur de fin déjà retiré par le lecteur.
 * @returns `null` pour une ligne vide ou blanche, sinon le verdict ; jamais une exception.
 */
export function decodeJsonlLine(line: string): JsonlLine | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false, rawLength: trimmed.length };
  }
}

/**
 * Lit un fichier JSONL en flux, une ligne = un événement.
 * Ne throw jamais sur une ligne cassée : elle est signalée { ok: false }
 * et la lecture continue (principe : casser bruyamment, pas silencieusement).
 *
 * Un MODE DE LECTURE au-dessus de `decodeJsonlLine`, qui rend le verdict sur chaque ligne.
 */
export async function* iterJsonlLines(filePath: string): AsyncGenerator<JsonlLine> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const verdict = decodeJsonlLine(line);
      if (verdict !== null) yield verdict;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}
