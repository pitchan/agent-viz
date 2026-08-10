// Écriture d'un résultat de détecteur, avec sa traçabilité.
//
// DEUX COMMITS, ET C'EST LE POINT : `commitOutils` est le HEAD de la branche
// d'audit, qui avance à chaque tâche ; `commitSources` est le dernier commit
// ayant touché autre chose que `docs/`, c'est-à-dire l'état du code AUDITÉ.
// Confondre les deux — ce que faisait la v1 de ce plan — produit un rapport
// qui prétend porter sur 4a4dc46 tout en affichant le numéro de son propre
// outillage.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const git = (root, args) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

export function writeResult(root, name, payload) {
  const dir = join(root, 'docs', 'audit', 'resultats');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.json`);
  const body = {
    detecteur: name,
    commitSources: git(root, ['log', '-1', '--format=%h', '--', '.', ':(exclude)docs']),
    commitOutils: git(root, ['rev-parse', '--short', 'HEAD']),
    nonSuivis: git(root, ['status', '--porcelain']).split('\n').filter(Boolean),
    node: process.version,
    genereLe: new Date().toISOString(),
    ...payload,
  };
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return file;
}

// Les clés que la comparaison de rejouabilité doit ignorer : elles changent à
// chaque exécution sans que le constat change.
export const CLES_VOLATILES = ['commitOutils', 'genereLe', 'node', 'nonSuivis'];
