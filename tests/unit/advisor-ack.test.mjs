// L'acquittement groupe : sequentiel, seuls les non-acquittes, la premiere
// erreur arrete la serie et remonte — le rechargement (en finally chez
// l'appelant) affiche alors l'etat VRAI : les acquittes le restent, le reste
// reste « a traiter ». Pas de « tout est vert » menteur (doc/32).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ackEpisodes } from '../../src/web/observatory/advisor-view.js';

const ep = (id, acked = false) => ({ id, createdAt: 1000 + id.length, acknowledged: acked });

test('n acquitte que les non-acquittes, dans l ordre, un appel par episode', async () => {
  const recus = [];
  const api = { acknowledgeAlert: a => { recus.push(a.id); return Promise.resolve(); } };
  await ackEpisodes(api, [ep('a'), ep('deja', true), ep('b')]);
  assert.deepEqual(recus, ['a', 'b']);
});

test('la premiere erreur arrete la serie et remonte', async () => {
  const recus = [];
  const api = {
    acknowledgeAlert: a => {
      recus.push(a.id);
      return a.id === 'b' ? Promise.reject(new Error('journal ferme')) : Promise.resolve();
    },
  };
  await assert.rejects(() => ackEpisodes(api, [ep('a'), ep('b'), ep('c')]), /journal ferme/);
  assert.deepEqual(recus, ['a', 'b'], 'c n a pas ete tente : l etat vrai se relit apres');
});
