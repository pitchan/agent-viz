// L'acquittement groupe : sequentiel, seuls les non-acquittes, la premiere
// erreur arrete la serie et remonte — le rechargement (en finally chez
// l'appelant) affiche alors l'etat VRAI : les acquittes le restent, le reste
// reste « a traiter ». Pas de « tout est vert » menteur.
import { expect, test } from 'vitest';
import { ackEpisodes } from '../../src/web/observatory/advisor-view.ts';

type ApiClient = Parameters<typeof ackEpisodes>[0];
type EpAlert = Parameters<typeof ackEpisodes>[1][number];

const ep = (id: string, acked = false): EpAlert =>
  ({ id, createdAt: 1000 + id.length, acknowledged: acked }) as unknown as EpAlert;

test('n acquitte que les non-acquittes, dans l ordre, un appel par episode', async () => {
  const recus: string[] = [];
  const api = {
    acknowledgeAlert: (a: { id: string }) => { recus.push(a.id); return Promise.resolve(); },
  } as unknown as ApiClient;
  await ackEpisodes(api, [ep('a'), ep('deja', true), ep('b')]);
  expect(recus).toEqual(['a', 'b']);
});

test('la premiere erreur arrete la serie et remonte', async () => {
  const recus: string[] = [];
  const api = {
    acknowledgeAlert: (a: { id: string }) => {
      recus.push(a.id);
      return a.id === 'b' ? Promise.reject(new Error('journal ferme')) : Promise.resolve();
    },
  } as unknown as ApiClient;
  await expect(() => ackEpisodes(api, [ep('a'), ep('b'), ep('c')])).rejects.toThrow(/journal ferme/);
  expect(recus, 'c n a pas ete tente : l etat vrai se relit apres').toEqual(['a', 'b']);
});
