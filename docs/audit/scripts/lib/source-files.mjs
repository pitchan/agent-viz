// Le périmètre audité, tel que fixé par doc/34.
//
// AUTO-EXCLUSION : `docs` figure dans IGNORED. L'audit ne s'audite pas
// lui-même — sans quoi ses propres scripts pollueraient chaque détecteur.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

export const ZONES = [
  { name: 'server', roots: ['lib', 'bin'] },
  { name: 'web', roots: ['public'] },
  { name: 'engine', roots: ['netgain/src'] },
];

export const TEST_ZONES = [
  { name: 'tests-server', roots: ['tests/unit'] },
  { name: 'tests-engine', roots: ['netgain/tests'] },
];

const EXTENSIONS = new Set(['.js', '.mjs', '.ts']);
const IGNORED = new Set(['node_modules', 'dist', 'fixtures', '.git', 'docs']);

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(extname(entry.name))) out.push(full);
  }
}

function collect(root, zones) {
  const files = [];
  for (const zone of zones) {
    for (const relRoot of zone.roots) {
      const abs = join(root, relRoot);
      if (!existsSync(abs)) continue;
      const found = [];
      walk(abs, found);
      for (const full of found) {
        files.push({
          path: relative(root, full).split(sep).join('/'),
          zone: zone.name,
          text: readFileSync(full, 'utf8'),
        });
      }
    }
  }
  return files;
}

export const sources = (root) => collect(root, ZONES);
export const testFiles = (root) => collect(root, TEST_ZONES);
