// La formulation francaise d'une ligne de panne, au meme endroit pour tout le
// monde. Elle se compose des CHAMPS de l'alerte, jamais de son `message`
// anglais : traduire une phrase deja faite serait la seule facon de la voir
// diverger de ce que le detecteur a reellement mesure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failureLine, projectLabel, failuresSummary } from '../../public/observatory/failures-format.js';

const base = {
  type: 'loop', toolName: 'Bash', count: 4, subject: 'npm run build',
  cwd: 'f:\\DEV\\Demo IA OPTIM\\SKILLS TOKEN SAVERS',
  createdAt: Date.UTC(2026, 7, 7, 14, 42, 0),
  occurrences: [{ failed: true }, { failed: true }, { failed: true }, { failed: null }],
  tools: [],
};

test('le projet se nomme par son chemin reel, lettre de lecteur en majuscule', () => {
  assert.equal(projectLabel('f:\\DEV\\projet'), 'F:\\DEV\\projet');
  assert.equal(projectLabel(''), 'projet inconnu');
});

test('une boucle en echec COMPTE, en francais, sans traduire le message anglais', () => {
  const l = failureLine(base);
  assert.equal(l.headline, 'Bash · même commande 4×, 3 sur 4 en échec');
  assert.equal(l.subject, 'npm run build');
  assert.equal(l.project, 'F:\\DEV\\Demo IA OPTIM\\SKILLS TOKEN SAVERS');
});

test('une boucle en partie en echec affiche son denominateur', () => {
  const l = failureLine({ ...base, occurrences: [{ failed: true }, { failed: false }, { failed: false }, { failed: null }] });
  assert.equal(l.headline, 'Bash · même commande 4×, 1 sur 4 en échec');
});

test('une boucle sans echec connu ne parle pas d echec', () => {
  const l = failureLine({ ...base, occurrences: [{ failed: false }, { failed: false }, { failed: false }, { failed: null }] });
  assert.equal(l.headline, 'Bash · même commande 4×');
});

test('un orage d echecs se distingue d une boucle', () => {
  const l = failureLine({ ...base, type: 'retryStorm', count: 3, occurrences: [] });
  assert.equal(l.headline, 'Bash · 3 échecs consécutifs');
});

test('une session bloquee nomme ce qu elle attend', () => {
  const l = failureLine({
    ...base, type: 'stuck', toolName: '', count: 2, subject: '', occurrences: [],
    tools: [{ toolName: 'Bash', subject: 'npm run build' }, { toolName: 'Read', subject: 'a.js' }],
  });
  assert.equal(l.headline, 'Aucun événement · 2 outils encore en vol');
  assert.equal(l.subject, 'Bash · npm run build');
});

// Un seul outil en vol est le cas le plus frequent d'une session bloquee : le
// pluriel y serait faux a chaque fois. Mutation attrapee : figer le suffixe.
test('une session bloquee sur un seul outil parle au singulier', () => {
  const l = failureLine({
    ...base, type: 'stuck', toolName: '', count: 1, subject: '', occurrences: [],
    tools: [{ toolName: 'Bash', subject: 'npm run build' }],
  });
  assert.equal(l.headline, 'Aucun événement · 1 outil encore en vol');
});

test('un type inconnu se rend lisible plutot que vide', () => {
  assert.equal(failureLine({ ...base, type: 'pricingDrift' }).headline, 'pricingDrift');
});

// Le journal ne regarde pas ce qu'il relit : de la forme d'une alerte il ne
// connait que `id` et `createdAt` (voir l'en-tete de lib/server/watchdog/
// journal.js), et une ligne abimee mais encore analysable traverse jusqu'ici.
// Un jet dans cette fonction ne casserait pas une ligne : `loadFailures` avale
// l'erreur, et le bloc entier s'affiche VIDE — indiscernable de « aucune
// panne », le pire mode de panne d'un panneau de surveillance.
//
// Mutation attrapee : retirer les defauts `[]` de `occurrences` et `tools`.
test('une alerte amputee de ses tableaux se rend quand meme, sans jeter', () => {
  const ampute = { ...base, occurrences: undefined, tools: undefined };
  assert.equal(failureLine(ampute).headline, 'Bash · même commande 4×');
  assert.equal(failureLine({ ...ampute, type: 'stuck', count: 1 }).subject, '');
});

// Le bloc est la MEMOIRE des pannes, pas leur vivacite : sur 30 jours,
// « non acquittees » et « en cours » sont deux choses differentes, et c'est la
// pastille qui dit la seconde (`standing` -> activeIds, evenementiel ->
// fraicheur). Un compte rouge sous-entendant « en cours » rejouerait exactement
// la confusion que la tache 9 a paye pour trancher.
//
// Mutation attrapee : remplacer le libelle par un quantificateur de vivacite.
test('le resume compte les non acquittees, il ne prononce pas « en cours »', () => {
  assert.equal(failuresSummary([]), 'aucune');
  assert.equal(failuresSummary([{ acknowledged: true }]), 'aucune');
  assert.equal(failuresSummary([{ acknowledged: false }]), '1 non acquittée');
  assert.equal(
    failuresSummary([{ acknowledged: false }, { acknowledged: true }, { acknowledged: false }]),
    '2 non acquittées',
  );
});
