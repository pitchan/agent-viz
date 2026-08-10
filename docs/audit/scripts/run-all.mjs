// Régénère TOUT : la couverture d'abord, puis les sept détecteurs.
//
// La v1 promettait « rejouable » avec une commande qui ne régénérait pas le
// LCOV, et ne comparait que D1. Deux trous : D6 relisait un fichier qui pouvait
// dater d'une autre exécution, et six détecteurs sur sept n'étaient jamais
// vérifiés pour la stabilité.
//
// Usage :
//   node docs/audit/scripts/run-all.mjs             régénère
//   node docs/audit/scripts/run-all.mjs --comparer  régénère puis compare aux
//                                                   résultats déjà committés
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLES_VOLATILES } from './lib/write-result.mjs';
import { DETECTORS, ROOT, runOne } from './run.mjs';

const NOMS = Object.keys(DETECTORS);
const chemin = (n) => resolve(ROOT, `docs/audit/resultats/${n}.json`);

const stable = (obj) => {
  const copie = { ...obj };
  for (const cle of CLES_VOLATILES) delete copie[cle];
  return JSON.stringify(copie);
};

const comparer = process.argv.includes('--comparer');
const avant = comparer
  ? new Map(NOMS.map(n => [n, stable(JSON.parse(readFileSync(chemin(n), 'utf8')))]))
  : null;

process.stderr.write('couverture d’exécution…\n');
execFileSync(process.execPath, [
  '--test', '--experimental-test-coverage',
  '--test-reporter=lcov',
  '--test-reporter-destination=docs/audit/resultats/couverture.lcov',
  'tests/**/*.test.*',
], { cwd: ROOT, stdio: 'ignore' });

for (const nom of NOMS) {
  await runOne(nom);
  process.stderr.write(`  ${nom} ✓\n`);
}

if (comparer) {
  let divergents = 0;
  for (const nom of NOMS) {
    const apres = stable(JSON.parse(readFileSync(chemin(nom), 'utf8')));
    if (apres !== avant.get(nom)) { divergents++; process.stderr.write(`DIVERGENT : ${nom}\n`); }
  }
  process.stderr.write(divergents === 0 ? 'les sept résultats sont identiques\n' : `${divergents} détecteur(s) instables\n`);
  process.exit(divergents === 0 ? 0 : 1);
}
