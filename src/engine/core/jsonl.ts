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
 * CE QUI EST TOLÉRÉ EN TÊTE ET EN QUEUE DE LIGNE : **tout le blanc d'Unicode**,
 * pas seulement le BOM. `trim()` retire toute la production *WhiteSpace* +
 * *LineTerminator* d'ECMAScript — U+FEFF, mais aussi l'espace insécable U+00A0,
 * l'espace fine U+2009, le séparateur de ligne U+2028 —, là où `JSON.parse`
 * seul les refuse. Vérifié en exécutant sur les cinq formes.
 *
 * C'est une PROPRIÉTÉ ASSUMÉE, pas un effet de bord toléré (arbitrage du
 * 2026-08-11). L'arbitrage d'origine disait « le BOM » ; la mécanique donne tout
 * le blanc, et c'est la mécanique qui est gardée. La restreindre demanderait
 * d'écrire à la main un sous-ensemble de ce que `trim()` fait déjà — du code en
 * plus, une expression régulière maison à maintenir, pour rendre le lecteur
 * MOINS tolérant sur des fichiers écrits par un tiers. Rejeter une ligne qu'on
 * savait lire est précisément la perte silencieuse que C1 a coûtée.
 *
 * POURQUOI IL N'Y A PAS DE RETRAIT EXPLICITE DU BOM ICI. La version précédente
 * de ce module portait un retrait conditionnel « seulement sur la première
 * ligne » — vérifié par test : il ne pouvait jamais changer l'issue, le `trim()`
 * qui suit faisait déjà le travail, et sur TOUTES les lignes. Code mort retiré
 * plutôt que déplacé. Ne pas le réintroduire : ce serait une commande qui ne
 * commande rien.
 *
 * C'est aussi ce qui explique la « tolérance incidente et inégale » que décrit
 * C2 : les sites serveur qui survivent au BOM le doivent à un `trim()` présent
 * pour une autre raison, jamais à une intention. Ceux qui n'en ont pas sur le
 * chemin — `src/server/hook.js` avant son correctif, la sonde de `session-index.js` —
 * perdent la ligne.
 *
 * ATTENTION AUX APPELANTS : `{ ok: true }` promet un JSON valide, PAS un objet.
 * Une ligne valant `null` est du JSON valide et rend `{ ok:true, value:null }` ;
 * `42` et `"texte"` aussi. Un appelant qui déréférence `value` sans vérifier
 * lève — c'est arrivé à `watchdog/journal.js` et à `watchdog/catch-up.js`, où
 * une seule ligne `null` faisait disparaître le chien de garde entier
 * (corrigé le 2026-08-11). Vérifier la FORME du contenu appartient à l'appelant,
 * qui seul sait quel enregistrement il attend ; la primitive, elle, ne répond
 * que de la validité JSON.
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
