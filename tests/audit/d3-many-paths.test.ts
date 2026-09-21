import { expect, test } from 'vitest';
import { findManyPaths, PRIMITIVES } from '../../docs/audit/scripts/d3-many-paths.ts';

test('les douze familles de doc/34 sont toutes couvertes', () => {
  expect(PRIMITIVES.map(p => p.nom).sort()).toEqual([
    'appel-http-client',
    'declaration-de-formateur',
    'decodage-jsonl',
    'formatage-a-locale-implicite',
    'formatage-date',
    'formatage-duree',
    'formatage-monetaire',
    'formatage-numerique-en-dur',
    'formatage-octets',
    'formatage-pourcentage',
    'lecture-json-de-fichier',
    'resolution-de-chemin-maison',
  ]);
});

test('contrôle positif : trois appels HTTP dans trois fichiers, avec leur ligne', () => {
  const found = findManyPaths([
    { path: 'a.js', zone: 'web', text: `\nconst r = await fetch(url);\n` },
    { path: 'b.js', zone: 'web', text: `const r = await fetch('/x');` },
    { path: 'c.js', zone: 'server', text: `https.get(u, cb);` },
  ]);
  const http = found.find(p => p.primitive === 'appel-http-client')!;
  expect(http.fichiersDistincts).toBe(3);
  expect(http.sites.find(s => s.path === 'a.js')!.line).toBe(2);
});

test('contrôle positif : les familles de formatage sont distinguées entre elles', () => {
  const found = findManyPaths([
    { path: 'a.js', zone: 'web', text: `n.toLocaleString()` },
    { path: 'b.js', zone: 'web', text: `n.toFixed(2)` },
    { path: 'c.js', zone: 'web', text: `\`\${(n / (1024 * 1024)).toFixed(1)} Mo\`` },
    { path: 'd.js', zone: 'web', text: `\`\${(ms / 60000).toFixed(1)}m\`` },
    { path: 'e.js', zone: 'web', text: `\`\${(r * 100).toFixed(1)} %\`` },
    { path: 'f.js', zone: 'web', text: `String(d.getDate()).padStart(2, '0')` },
    { path: 'g.js', zone: 'web', text: `\`\${n.toFixed(2)} $\`` },
  ]);
  const noms = new Set(found.map(p => p.primitive));
  for (const attendu of ['formatage-a-locale-implicite', 'formatage-octets', 'formatage-duree',
    'formatage-pourcentage', 'formatage-date', 'formatage-monetaire']) {
    expect(noms.has(attendu), `famille manquante : ${attendu}`).toBeTruthy();
  }
});

test('contrôle négatif : un fichier sans aucune primitive ne produit rien', () => {
  expect(findManyPaths([{ path: 'a.js', zone: 'web', text: `const a = 1;` }]).length).toBe(0);
});
