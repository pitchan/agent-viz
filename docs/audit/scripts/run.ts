// Lanceur d'UN détecteur. Il est le seul à connaître le disque et l'horloge ;
// les détecteurs sont des fonctions pures, c'est ce qui les rend contrôlables
// sans fichier temporaire.
//
// Usage : node docs/audit/scripts/run.ts d1
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sources, testFiles, type SourceFile } from './lib/source-files.ts';
import { writeResult } from './lib/write-result.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const DETECTORS = {
  // une entrée ajoutée par tâche, de d1 à d7
  d1: async (files: SourceFile[]) => ({ groupes: (await import('./d1-clones.ts')).findClones(files) }),
  d2: async (files: SourceFile[]) => ({ candidats: (await import('./d2-truth-sources.ts')).findTruthSources(files) }),
  d3: async (files: SourceFile[]) => ({ primitives: (await import('./d3-many-paths.ts')).findManyPaths(files) }),
  d4: async (files: SourceFile[]) => (await import('./d4-import-graph.ts')).analyseGraph(files),
  d5: async (files: SourceFile[]) => (await import('./d5-volumetry.ts')).measure(files),
  d6: async (files: SourceFile[]) => (await import('./d6-coverage.ts')).coverageReport(files, lireTests(), lireCouverture()),
  d7: async (files: SourceFile[]) => (await import('./d7-boundary.ts')).verifyMatrix(files),
};

function isDetectorName(name: string | undefined): name is keyof typeof DETECTORS {
  return name !== undefined && Object.hasOwn(DETECTORS, name);
}

export async function runOne(name: string | undefined): Promise<string> {
  if (!isDetectorName(name)) {
    throw new Error(`détecteur inconnu : ${name} (connus : ${Object.keys(DETECTORS).join(', ') || 'aucun'})`);
  }
  return writeResult(ROOT, name, await DETECTORS[name](sources(ROOT)));
}

export const lireCouverture = (): string =>
  readFileSync(resolve(ROOT, 'docs/audit/resultats/couverture.lcov'), 'utf8');
export const lireTests = (): SourceFile[] => testFiles(ROOT);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stderr.write(`écrit : ${await runOne(process.argv[2])}\n`);
}
