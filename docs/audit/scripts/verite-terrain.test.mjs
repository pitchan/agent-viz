// Vérité terrain. Ces quatre défauts ont été établis À LA MAIN le 2026-08-10,
// avant l'écriture des détecteurs, en lisant le code. Une chaîne d'audit qui
// en manque un seul est cassée — et ce contrôle-là est le seul qui juge la
// chaîne ENTIÈRE plutôt qu'un instrument isolé.
//
// Il se lance APRÈS les sept détecteurs, sur leurs résultats réels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const lire = (n) => JSON.parse(readFileSync(resolve(ROOT, `docs/audit/resultats/${n}.json`), 'utf8'));

const fichiersDe = (d3, primitive) =>
  new Set((d3.primitives.find(p => p.primitive === primitive)?.sites ?? []).map(s => s.path));

test('vérité 1 : les trois clients HTTP du navigateur sont retrouvés', () => {
  const f = fichiersDe(lire('d3'), 'appel-http-client');
  for (const attendu of [
    'public/observatory/api.js',
    'public/viz-network.js',
    'public/viz-watchdog-client.js',
  ]) assert.ok(f.has(attendu), `client HTTP manqué : ${attendu}`);
});

test('vérité 2 : les trois formatages de durée recopiés sont retrouvés', () => {
  const f = fichiersDe(lire('d3'), 'formatage-duree');
  for (const attendu of ['public/viz-layout.js', 'public/viz-narrator.js', 'public/viz-ui.js']) {
    assert.ok(f.has(attendu), `formatage de durée manqué : ${attendu}`);
  }
});

test('vérité 3 : le seul toLocaleString() nu du dépôt est retrouvé, et il est seul', () => {
  const f = fichiersDe(lire('d3'), 'formatage-a-locale-implicite');
  assert.deepEqual([...f], ['public/viz-ui.js']);
});

test('vérité 4 : les deux variables d’environnement pour le même dossier sont retrouvées', () => {
  const geste = lire('d7').gestes.find(g => g.geste === 'resolution-du-dossier-de-configuration');
  assert.equal(geste.verdict, 'duplique');
  assert.ok(geste.coteServeur.length > 0 && geste.coteMoteur.length > 0);
  assert.deepEqual(geste.sitesManquants, []);
});
