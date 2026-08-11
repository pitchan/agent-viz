// Le format d'identite est le seul contrat entre les deux extracteurs : si les
// deux ne produisent pas la MEME chaine pour le meme test, la comparaison du
// critere d'arret compare deux choses differentes sans le dire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatId, trierIds } from '../../test-support/ids/format.mjs';
import { idsDepuisEvenementsNode } from '../../test-support/ids/node-reporter.mjs';
import { idsDepuisJsonVitest } from '../../test-support/ids/from-vitest-json.mjs';

const RACINE = 'F:/DEV/agent-viz';

test('une identite joint le chemin relatif POSIX et le nom du test', () => {
  // Arrange
  const fichier = 'F:\\DEV\\agent-viz\\tests\\unit\\a.test.js';
  // Act
  const id = formatId(fichier, 'un nom', RACINE);
  // Assert
  assert.equal(id, 'tests/unit/a.test.js :: un nom');
});

test('deux tests homonymes dans deux fichiers restent deux identites distinctes', () => {
  // Arrange
  const a = formatId('F:/DEV/agent-viz/tests/unit/a.test.js', 'meme nom', RACINE);
  const b = formatId('F:/DEV/agent-viz/tests/unit/b.test.js', 'meme nom', RACINE);
  // Act
  const distinctes = a !== b;
  // Assert
  assert.equal(distinctes, true, 'le fichier fait partie de l identite, sinon le diff est aveugle');
});

test('le tri ordonne, il ne se contente pas de renverser', () => {
  // Arrange — trois identites dans un ordre qui n est PAS l inverse du tri,
  // sinon un `reverse()` a la place du tri passerait le test.
  const a = formatId('F:/DEV/agent-viz/tests/unit/a.test.js', 'nom', RACINE);
  const b = formatId('F:/DEV/agent-viz/tests/unit/b.test.js', 'nom', RACINE);
  const c = formatId('F:/DEV/agent-viz/tests/unit/c.test.js', 'nom', RACINE);
  // Act
  const trie = trierIds([b, c, a]);
  // Assert
  assert.deepEqual(trie, [a, b, c]);
});

test('le flux node:test ne rend que les tests, pas le fichier qui les porte', () => {
  // Arrange — echantillon capture au step 1
  // L'echantillon est volontairement DESORDONNE : si le tri disparaissait de
  // l'adaptateur, un echantillon deja trie laisserait le test au vert.
  const evenements = [
    { type: 'test:fail', data: { name: 'second', file: 'F:/DEV/agent-viz/tests/unit/a.test.js', nesting: 0 } },
    { type: 'test:pass', data: { name: 'premier', file: 'F:/DEV/agent-viz/tests/unit/a.test.js', nesting: 0 } },
    { type: 'test:diagnostic', data: { message: 'pass 1', file: 'F:/DEV/agent-viz/tests/unit/a.test.js' } },
  ];
  // Act
  const ids = idsDepuisEvenementsNode(evenements, RACINE);
  // Assert
  assert.deepEqual(ids, ['tests/unit/a.test.js :: premier', 'tests/unit/a.test.js :: second']);
});

test('le JSON de vitest rend les memes identites que le flux node:test', () => {
  // Arrange — echantillon capture au step 4
  const json = {
    testResults: [{
      name: 'F:/DEV/agent-viz/tests/unit/a.test.js',
      // Desordonne pour la meme raison que l'echantillon precedent.
      assertionResults: [
        { fullName: 'second', status: 'failed' },
        { fullName: 'premier', status: 'passed' },
      ],
    }],
  };
  // Act
  const ids = idsDepuisJsonVitest(json, RACINE);
  // Assert
  assert.deepEqual(ids, ['tests/unit/a.test.js :: premier', 'tests/unit/a.test.js :: second']);
});
