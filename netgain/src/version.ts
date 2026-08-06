import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Source unique de la version : le package.json du PRODUIT, à la racine du dépôt.
 * Le moteur n'est plus un paquet distinct — un seul outil, une seule version.
 * `netgain/package.json` ne porte plus que `{"type":"module"}`, d'où les deux
 * niveaux de remontée, valables depuis `src/` (tsx) comme depuis `dist/` :
 * les deux dossiers sont à la même profondeur sous `netgain/`.
 */
export function readPackageVersion(): string {
  const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
  // BOM retiré avant l'analyse : npm et tsc le tolèrent, `JSON.parse` non — un
  // éditeur qui en ajoute un ne doit pas casser la commande `--version`.
  return (JSON.parse(readFileSync(pkgPath, 'utf8').replace(/^\uFEFF/, '')) as { version: string }).version;
}
