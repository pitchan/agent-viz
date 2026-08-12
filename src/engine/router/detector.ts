import { isNoisePrompt } from '../doctor/aggregators/prompts.js';

/**
 * Détecteur DÉTERMINISTE (0 appel modèle) du router — spec §2.3 CORRIGÉE post-J5.
 *
 * Ne tire QUE sur les signaux de graphe d'imports : impact / dépendants /
 * importeurs / blast radius / fichiers chauds. Les motifs d'énumération
 * (« où / comment / quelles routes », env) ne déclenchent RIEN — c'est le geste
 * perdant mesuré en S11 (+18/+39/+80 %) ; le silence est gratuit et gagnant.
 * Calibrage : précision avant rappel — un faux négatif = statu quo (l'agent
 * explore à la main), un faux positif = une ligne injectée pour rien.
 */

export type GraphSignal = 'blast-radius' | 'impact' | 'dependents' | 'importers' | 'hot-files';

// NB : \b est ASCII en regex JS — inutilisable après un caractère accentué,
// d'où les classes [ée] explicites (même piège que le classifieur J0).
const SIGNALS: { signal: GraphSignal; patterns: RegExp[] }[] = [
  { signal: 'blast-radius', patterns: [/\bblast\s+radius\b/i] },
  {
    signal: 'impact',
    patterns: [/\bimpacts?\s+(de|du|des|d['’]|of|on|sur)\b/i],
  },
  {
    signal: 'dependents',
    patterns: [
      /\bqui\s+(en\s+)?d[ée]pend(ent)?\b/i,
      /\b(what|who|which\s+[\w-]+)\s+depends?\s+on\b/i,
      /\bd[ée]pendants?\s+transitifs?\b/i,
      /\btransitive\s+dependents?\b/i,
    ],
  },
  {
    signal: 'importers',
    patterns: [
      /\bqui\s+import(e|ent)\b/i,
      /\bwho\s+imports?\b/i,
      /\bwhich\s+files?\s+imports?\b/i,
      /\bimporteurs?\b/i,
      /\btransitive(ly)?\s+import/i,
    ],
  },
  {
    signal: 'hot-files',
    patterns: [
      /\bfichiers?\s+les\s+plus\s+import[ée]s?\b/i,
      /\bfichiers?\s+chauds?\b/i,
      /\bhot\s+files?\b/i,
      /\bmost\s+imported\b/i,
    ],
  },
];

export function detectGraphSignal(prompt: string): GraphSignal | null {
  if (isNoisePrompt(prompt)) return null;
  for (const { signal, patterns } of SIGNALS) {
    if (patterns.some((p) => p.test(prompt))) return signal;
  }
  return null;
}

/**
 * La ligne injectée quand un signal tire. Une seule ligne, map_impact/map_hot
 * SEULS — jamais map_routes/map_orient/map_env (la séduction S11). Le coût
 * d'un faux positif est exactement cette ligne.
 */
export const NUDGE_LINE =
  "Signal de graphe d'imports détecté : consulte d'abord les outils MCP `map_impact` (blast radius exact d'un fichier, dépendants transitifs) et `map_hot` (fichiers les plus importés) au lieu de remonter les imports à la main.";
