// Lanceur d'UN détecteur. Il est le seul à connaître le disque et l'horloge ;
// les détecteurs sont des fonctions pures, c'est ce qui les rend contrôlables
// sans fichier temporaire.
//
// Usage : node docs/audit/scripts/run.mjs d1
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sources, testFiles } from './lib/source-files.mjs';
import { writeResult } from './lib/write-result.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const DETECTORS = {
  // une entrée ajoutée par tâche, de d1 à d7
  d1: async (files) => ({ groupes: (await import('./d1-clones.mjs')).findClones(files) }),
  d2: async (files) => ({ candidats: (await import('./d2-truth-sources.mjs')).findTruthSources(files) }),
  d3: async (files) => ({ primitives: (await import('./d3-many-paths.mjs')).findManyPaths(files) }),
  d4: async (files) => (await import('./d4-import-graph.mjs')).analyseGraph(files),
  d5: async (files) => (await import('./d5-volumetry.mjs')).measure(files),
  d6: async (files) => (await import('./d6-coverage.mjs')).coverageReport(files, lireTests(), lireCouverture()),
};

export async function runOne(name) {
  if (!Object.hasOwn(DETECTORS, name)) {
    throw new Error(`détecteur inconnu : ${name} (connus : ${Object.keys(DETECTORS).join(', ') || 'aucun'})`);
  }
  return writeResult(ROOT, name, await DETECTORS[name](sources(ROOT)));
}

export const lireCouverture = () =>
  readFileSync(resolve(ROOT, 'docs/audit/resultats/couverture.lcov'), 'utf8');
export const lireTests = () => testFiles(ROOT);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stderr.write(`écrit : ${await runOne(process.argv[2])}\n`);
}
