// D1 — clones textuels. Produit des CANDIDATS, jamais un verdict (doc/34).
//
// Trois étapes, et la deuxième existe pour une raison mesurée : le périmètre
// produit 103 192 fenêtres de 60 jetons, et sur une empreinte 32 bits
// l'espérance de collisions est de 1,2. Un groupe de clones inventé de toutes
// pièces suffit à discréditer un rapport, et on ne saurait pas lequel.
//   1. l'empreinte sert au REGROUPEMENT, pas à la preuve ;
//   2. à l'intérieur d'un seau, on compare les SÉQUENCES DE JETONS à
//      l'identique — exact par construction, alors qu'un hachage, même
//      SHA-256, garde une probabilité résiduelle ;
//   3. les fenêtres adjacentes sont FUSIONNÉES en un fragment maximal, sans
//      quoi un bloc de 200 jetons ressortirait en 140 groupes redondants.
//
// LIMITES ASSUMÉES : ne voit ni les clones à identifiants renommés (les
// identifiants ne sont pas neutralisés), ni les clones INTRA-fichier (un
// groupe exige au moins deux fichiers distincts), ni les clones qui traversent
// les langages — c'est le rôle de D7.
import { tokenize } from './lib/tokens.mjs';

const WINDOW = 60;
const MIN_LINES = 5;

function fingerprint(values) {
  let h = 0x811c9dc5;
  for (const value of values) {
    for (let i = 0; i < value.length; i++) {
      h = Math.imul(h ^ value.charCodeAt(i), 0x01000193) >>> 0;
    }
    h = Math.imul(h ^ 32, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function findClones(files) {
  const tokensByFile = new Map();
  const buckets = new Map();

  for (const file of files) {
    const tokens = tokenize(file.text);
    tokensByFile.set(file.path, tokens);
    for (let i = 0; i + WINDOW <= tokens.length; i++) {
      const lineStart = tokens[i].line;
      const lineEnd = tokens[i + WINDOW - 1].line;
      if (lineEnd - lineStart + 1 < MIN_LINES) continue;
      const key = fingerprint(tokens.slice(i, i + WINDOW).map(t => t.v));
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ path: file.path, zone: file.zone, i, lineStart, lineEnd, key });
    }
  }

  // 2 — regroupement EXACT à l'intérieur de chaque seau : toute collision
  // d'empreinte est levée ici, définitivement.
  const exact = new Map();
  for (const occurrences of buckets.values()) {
    if (occurrences.length < 2) continue;
    for (const occ of occurrences) {
      const seq = tokensByFile.get(occ.path).slice(occ.i, occ.i + WINDOW).map(t => t.v).join('\u0000');
      if (!exact.has(seq)) exact.set(seq, []);
      exact.get(seq).push(occ);
    }
  }

  // 3 — fusion des fenêtres adjacentes. Deux groupes se suivent quand tous
  // leurs décalages avancent ensemble de exactement un jeton.
  const bySignature = new Map();
  for (const occurrences of exact.values()) {
    if (new Set(occurrences.map(o => o.path)).size < 2) continue;
    const ordered = [...occurrences].sort((a, b) => a.path.localeCompare(b.path) || a.i - b.i);
    const signature = ordered.map(o => o.path).join('|');
    if (!bySignature.has(signature)) bySignature.set(signature, new Map());
    bySignature.get(signature).set(ordered.map(o => o.i).join(','), ordered);
  }

  const groups = [];
  for (const byOffsets of bySignature.values()) {
    for (const start of byOffsets.values()) {
      // Un fragment ne commence que là où la fenêtre précédente n'existe pas ;
      // toutes les autres sont des continuations, absorbées par la fusion.
      if (byOffsets.has(start.map(o => o.i - 1).join(','))) continue;
      let end = start;
      let extent = 0;
      for (;;) {
        const next = byOffsets.get(end.map(o => o.i + 1).join(','));
        if (!next) break;
        end = next;
        extent++;
      }
      groups.push({
        empreinte: start[0].key,
        jetons: WINDOW + extent,
        sites: start.map((o, k) => ({
          path: o.path, zone: o.zone, lineStart: o.lineStart, lineEnd: end[k].lineEnd,
        })),
        interZone: new Set(start.map(o => o.zone)).size > 1,
      });
    }
  }
  return groups.sort((a, b) => b.jetons - a.jetons || b.sites.length - a.sites.length);
}
