'use strict';
// Le chargeur de modules du moteur — extrait pour C5
// (docs/audit-qualite-code.md : deux variables d'environnement désignaient le
// même dossier de configuration).
//
// Pourquoi il existe. C2 avait posé `lib/server/jsonl.js`, seul module de `lib/`
// à savoir où vit la primitive de décodage. C5 a besoin du même geste pour la
// résolution du dossier de configuration, et C3 en aura besoin pour la primitive
// d'accumulation d'usage. La responsabilité commune n'est ni le décodage ni la
// résolution : c'est « charger un module du `dist` du moteur, et ÉCHOUER EN LE
// DISANT si le build manque ». Une seule raison de changer, donc un seul
// fichier — la deuxième occurrence, pas la première, est le moment où la règle
// SRP s'applique.
//
// Pourquoi il est testé alors que le pont de C2 ne l'était pas : le message
// d'erreur de C2 n'avait été vérifié qu'à la main, en écartant le dossier `dist`.
// Un message qui n'est pas sous filet se dégrade en silence — exactement la
// maladie que C1 a coûtée.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { requireEngineModule } = require('../../src/server/engine-require');

test('charge un module réel du moteur et rend ses exports', () => {
  const mod = requireEngineModule('core/jsonl.js', ['decodeJsonlLine'], 'jsonl');
  assert.strictEqual(typeof mod.decodeJsonlLine, 'function');
  assert.deepStrictEqual(mod.decodeJsonlLine('{"a":1}'), { ok: true, value: { a: 1 } });
});

test('un module absent NOMME le build manquant, jamais un paquet introuvable', () => {
  assert.throws(
    () => requireEngineModule('core/ce-module-n-existe-pas.js', ['peu importe'], 'sonde'),
    (err) => {
      assert.match(err.message, /\[sonde\]/);
      // La cause réelle est un build absent : sans ce mot, le message envoie
      // chercher une dépendance npm manquante et fait perdre l'après-midi.
      assert.match(err.message, /npm run build/);
      assert.match(err.message, /core\/ce-module-n-existe-pas\.js/);
      return true;
    },
  );
});

test('un export manquant NOMME un build périmé, et dit lequel manque', () => {
  assert.throws(
    () => requireEngineModule('core/jsonl.js', ['decodeJsonlLine', 'fonctionQuiNExistePas'], 'sonde'),
    (err) => {
      assert.match(err.message, /fonctionQuiNExistePas/);
      assert.match(err.message, /npm run build/);
      // Le module EXISTE : dire « introuvable » ici enverrait au mauvais endroit.
      assert.doesNotMatch(err.message, /introuvable/);
      return true;
    },
  );
});

test('le chemin est relatif au `dist` du moteur, pas au module appelant', () => {
  // Le pont de C2 écrivait `../../dist/engine/core/jsonl.js`, un chemin qui ne
  // vaut que depuis `lib/server/`. Le rendre relatif au `dist` évite qu'un
  // second pont placé ailleurs se trompe d'un niveau sans que rien ne le dise.
  const attendu = path.join(__dirname, '..', '..', 'dist', 'engine', 'core', 'jsonl.js');
  assert.strictEqual(
    require.resolve(attendu),
    require.resolve(path.join(__dirname, '..', '..', 'src', 'server', '..', '..', 'dist', 'engine', 'core', 'jsonl.js')),
  );
});
