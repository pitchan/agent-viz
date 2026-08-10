import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export type JsonlLine = { ok: true; value: unknown } | { ok: false; rawLength: number };

/**
 * LA décision sur une ligne, à un seul endroit — extraite pour C2
 * (docs/audit-qualite-code.md : le décodage JSONL était réimplémenté sur
 * 7 fichiers côté serveur, avec une tolérance au BOM incidente et inégale).
 *
 * Ce que les appelants partagent est cette décision, PAS la façon de lire :
 * l'un streame un fichier entier, l'autre a déjà le contenu en mémoire, un
 * troisième ne sonde que les premiers kilo-octets, un quatrième suit une queue
 * incrémentale. Ces modes de lecture restent distincts et légitimes ; c'est le
 * verdict sur la ligne qui ne doit exister qu'une fois.
 *
 * SUR LE BOM, et pourquoi il n'y a PAS de retrait explicite ici. `trim()` le
 * retire déjà, sur n'importe quelle ligne : U+FEFF appartient à la production
 * WhiteSpace d'ECMAScript. La version précédente de ce module portait un
 * retrait conditionnel « seulement sur la première ligne » — vérifié par test :
 * il ne pouvait jamais changer l'issue, le `trim()` qui suivait faisait déjà le
 * travail, et sur TOUTES les lignes. Code mort retiré plutôt que déplacé.
 * Ne pas le réintroduire : ce serait une commande qui ne commande rien.
 *
 * C'est aussi ce qui explique la « tolérance incidente et inégale » que décrit
 * C2 : les sites serveur qui survivent au BOM le doivent à un `trim()` présent
 * pour une autre raison, jamais à une intention. Ceux qui n'en ont pas sur le
 * chemin — `lib/hook.js` avant son correctif, la sonde de `session-index.js` —
 * perdent la ligne.
 *
 * @param line la ligne brute, séparateur de fin déjà retiré par le lecteur.
 * @returns `null` pour une ligne vide ou blanche — rien à émettre, et ce n'est
 *   pas une erreur ; sinon le verdict, jamais une exception.
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
 * N'est plus qu'un MODE DE LECTURE au-dessus de `decodeJsonlLine` : le verdict
 * sur chaque ligne ne vit plus ici.
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
