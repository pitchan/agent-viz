import { parseProject, type ParseFailure } from './engine.js';

export interface HealthReport {
  root: string;
  filesParsed: number;
  parseFailures: ParseFailure[];
  scannedAt: string;
}

/**
 * `map_health` — fraîcheur et honnêteté du scan : combien de fichiers servent
 * les faits, lesquels ont été refusés (parse) et pourquoi. Un fichier illisible
 * n'est JAMAIS deviné : il est listé ici.
 */
export async function mapHealth(root: string): Promise<HealthReport> {
  const project = await parseProject(root);
  return {
    root,
    filesParsed: project.files.length,
    parseFailures: project.failures,
    scannedAt: new Date().toISOString(),
  };
}
