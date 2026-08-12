// Le contrat de la table des remedes (doc/32) : chaque motif ALERTANT a une
// entree EXPLICITE — un remede complet, ou `null` qui dit « absence deliberee ».
// C'est ce qui distingue un motif sans remede honnete d'un oubli de developpement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REMEDES, remedyFor } from '../../src/web/observatory/remedies.js';
import { PATTERNS } from '../../src/web/viz-invocation-patterns.mjs';

const alertants = PATTERNS.filter(p => p.workstationSetting).map(p => p.id).sort();

test('la table couvre exactement les motifs alertants — ni trou, ni fantome', () => {
  assert.deepEqual(Object.keys(REMEDES).sort(), alertants);
});

test('tout remede non-null porte une consigne francaise et un extrait a coller', () => {
  for (const [id, remede] of Object.entries(REMEDES)) {
    if (remede === null) continue;
    assert.ok(remede.consigne && remede.consigne.length > 20, `${id} : consigne vide`);
    assert.ok(remede.extrait && remede.extrait.includes('\n'), `${id} : extrait vide ou d une ligne`);
    assert.doesNotMatch(remede.extrait, /TODO|TBD/, `${id} : extrait inacheve`);
  }
});

test('le filet vaut null : sa cause n est pas caracterisee (doc/30)', () => {
  assert.equal(REMEDES['inv-bash-unbalanced-quote'], null);
});

test('remedyFor ne repond que pour un appel mal forme a motif remediable', () => {
  const remede = remedyFor({ type: 'badInvocation', patternId: 'inv-bash-windows-path-unquoted' });
  assert.ok(remede && remede.consigne);
  assert.equal(remedyFor({ type: 'badInvocation', patternId: 'inv-bash-unbalanced-quote' }), null);
  assert.equal(remedyFor({ type: 'badInvocation', patternId: 'inv-motif-de-demain' }), null);
  assert.equal(remedyFor({ type: 'loop', toolName: 'Bash' }), null,
    'pas de remede generique invente pour les types sans motif');
});
