// La formulation francaise d'une ligne de panne, au meme endroit pour tout le
// monde. Elle se compose des CHAMPS de l'alerte, jamais de son `message`
// anglais : traduire une phrase deja faite serait la seule facon de la voir
// diverger de ce que le detecteur a reellement mesure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failureLine, projectLabel, failuresSummary, groupKey, groupAlerts, causeLabel, episodeLabel } from '../../src/web/observatory/failures-format.js';
import { _DETECTOR_TYPES } from '../../src/web/viz-watchdog.mjs';

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

// ── Appel mal formé ────────────────────────────────────────────────────────
//
// L'alerte porte un IDENTIFIANT de motif — `inv-bash-windows-path-unquoted` —
// et rien d'autre : ni la commande, ni le message d'erreur. C'est ce bloc qui
// en fait une phrase. Traduire le `message` anglais serait la seule facon de
// le voir diverger de ce que le detecteur a mesure, et ce `message` sert la
// notification bureau, qui suit la langue du chrome.

const invocation = {
  ...base, type: 'badInvocation', toolName: 'Bash', count: 1, subject: '',
  occurrences: [], patternId: 'inv-bash-windows-path-unquoted',
};

test('un appel mal forme dit LEQUEL, en francais, depuis le seul identifiant', () => {
  const l = failureLine(invocation);
  assert.equal(l.headline,
    'Bash · appel mal formé : un chemin Windows non protégé sous un shell POSIX');
  assert.equal(l.subject, '', 'aucun texte de commande n a ete consigne, rien a montrer');
});

test('un appel mal forme repete dit combien de fois', () => {
  assert.equal(failureLine({ ...invocation, count: 3 }).headline,
    'Bash · appel mal formé : un chemin Windows non protégé sous un shell POSIX, 3 fois dans la session');
});

// Le detecteur compte TOUJOURS, des la premiere occurrence. « 1 fois dans la
// session » se lit comme du bruit sur une ligne de tableau de bord.
// Mutation attrapee : afficher le compte sans condition.
test('une premiere occurrence ne parle pas de repetition', () => {
  assert.doesNotMatch(failureLine(invocation).headline, /fois dans la session/);
});

// La table des motifs (src/web/viz-invocation-patterns.mjs) grandit a chaque cas
// rencontre, et elle n'a pas a attendre ce fichier-ci pour le faire. Un motif
// qu'il ne connait pas encore doit donc dire ce qu'on sait vraiment — que
// quelque chose se regle sur le poste — plutot que de laisser un trou.
//
// Mutation attrapee : retirer le repli et composer directement avec la table.
test('un motif que le bloc ne connait pas encore retombe sur une formulation generique', () => {
  const l = failureLine({ ...invocation, patternId: 'inv-motif-de-demain' });
  assert.equal(l.headline, 'Bash · appel mal formé : un réglage du poste de travail');
  assert.doesNotMatch(l.headline, /inv-motif-de-demain/,
    'un identifiant technique n est pas une phrase francaise');
});

test('chaque cause du releve dit ce qui a ete mal ecrit, pas ce que l outil a repondu', () => {
  const antislash = failureLine({ ...invocation, patternId: 'inv-bash-trailing-backslash-in-path' });
  assert.equal(antislash.headline,
    'Bash · appel mal formé : un guillemet double non fermé — typiquement un chemin Windows terminé par un antislash');
  const heredoc = failureLine({ ...invocation, patternId: 'inv-bash-heredoc-too-large' });
  assert.equal(heredoc.headline,
    'Bash · appel mal formé : un guillemet simple non fermé — typiquement un heredoc trop gros pour la ligne de commande');
});

test('la phrase du filet est celle qui sert quand la cause n est pas caracterisee', () => {
  // Elle est de nouveau VIVANTE depuis le 2026-08-08 : le filet alerte, donc
  // une alerte la porte. Elle reste malgre tout la seule phrase du bloc a
  // decrire un symptome sans nommer de remede, et c est juste — le filet ne se
  // declenche que lorsque aucune des deux ancres ne reconnait la forme,
  // c est-a-dire quand la cause n est pas caracterisee.
  const l = failureLine({ ...invocation, patternId: 'inv-bash-unbalanced-quote' });
  assert.match(l.headline, /guillemet ouvert et jamais refermé/);
  assert.doesNotMatch(l.headline, /réglage du poste de travail/);
});

test('une alerte d invocation amputee de son motif se rend quand meme', () => {
  // Le journal ne regarde pas ce qu il relit : une ligne abimee mais encore
  // analysable arrive jusqu ici. Un jet ferait afficher le bloc ENTIER vide.
  const { patternId, ...ampute } = invocation;
  assert.equal(failureLine(ampute).headline,
    'Bash · appel mal formé : un réglage du poste de travail');
});

// ── Le filet : aucun detecteur ne peut arriver muet ────────────────────────
//
// Ce bloc est le SEUL endroit du produit ou une panne survit a la session
// pendant laquelle elle s'est produite. Un detecteur ajoute sans sa formulation
// francaise y afficherait son nom de type — `badInvocation` — ce qui se lit
// comme un bug de l'outil, pas comme une panne de la session. Le contrat se
// pose donc des DEUX cotes : la table des detecteurs et la table des phrases
// doivent nommer les memes choses.
//
// Les alertes externes (la vigie tarifaire) ne passent pas par ici : elles ne
// viennent pas du flux de hooks, ne sont jamais consignees au journal, et
// vivent dans leur propre registre cote navigateur. D'ou le filet pose sur les
// types de DETECTEURS et pas sur « tout ce qui porte un type ».
test('tout type d alerte du detecteur a sa formulation francaise', () => {
  assert.ok(_DETECTOR_TYPES.length >= 4, 'la liste des detecteurs doit etre reelle');
  for (const type of _DETECTOR_TYPES) {
    const headline = failureLine({ ...invocation, type }).headline;
    assert.notEqual(headline, type,
      `${type} n a pas de formulation francaise : le bloc afficherait son nom de type`);
  }
});

// Le journal ne regarde pas ce qu'il relit : de la forme d'une alerte il ne
// connait que `id` et `createdAt` (voir l'en-tete de src/server/watchdog/
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

// ── Regroupement par cause ─────────────────────────────────────────────────

test('la clef de groupe suit la cause, pas l episode', () => {
  assert.equal(groupKey(invocation), 'badInvocation:inv-bash-windows-path-unquoted');
  assert.equal(groupKey(base), 'loop:Bash');
  assert.equal(groupKey({ ...base, type: 'retryStorm', toolName: 'Grep' }), 'retryStorm:Grep');
  assert.equal(groupKey({ ...base, type: 'stuck' }), 'stuck');
});

test('les episodes d une meme cause se regroupent, tries du plus recent au plus ancien', () => {
  const groupes = groupAlerts([
    { ...invocation, createdAt: 100, acknowledged: true },
    { ...invocation, createdAt: 300, acknowledged: false },
    { ...invocation, createdAt: 200, acknowledged: false },
  ]);
  assert.equal(groupes.length, 1);
  assert.deepEqual(groupes[0].episodes.map(e => e.createdAt), [300, 200, 100]);
  assert.equal(groupes[0].lastAt, 300);
  assert.equal(groupes[0].unacked, 2);
});

test('les groupes a traiter passent devant, puis le plus recent', () => {
  const groupes = groupAlerts([
    { ...base, createdAt: 900, acknowledged: true },                       // loop, soldé, récent
    { ...invocation, createdAt: 100, acknowledged: false },                // à traiter, ancien
    { ...base, type: 'retryStorm', createdAt: 500, acknowledged: false },  // à traiter, récent
  ]);
  assert.deepEqual(groupes.map(g => g.key),
    ['retryStorm:Bash', 'badInvocation:inv-bash-windows-path-unquoted', 'loop:Bash']);
});

test('une liste absente ou abimee rend une liste vide, sans jeter', () => {
  assert.deepEqual(groupAlerts(undefined), []);
  assert.equal(groupAlerts([{ type: 'loop' }]).length, 1, 'une alerte sans champs se groupe quand meme');
});

// ── Libellés : la cause n emprunte jamais les chiffres d un episode ────────

test('causeLabel nomme la cause, sans compter', () => {
  const [g] = groupAlerts([{ ...base, count: 4 }, { ...base, count: 7, createdAt: 50 }]);
  assert.equal(causeLabel(g), 'Bash · même commande répétée');
  assert.doesNotMatch(causeLabel(g), /\d/);
});

test('causeLabel d un appel mal forme reprend la phrase du motif', () => {
  const [g] = groupAlerts([invocation]);
  assert.equal(causeLabel(g),
    'Bash · appel mal formé : un chemin Windows non protégé sous un shell POSIX');
});

test('l outil ne se dit que s il est uniforme dans le groupe', () => {
  const [g] = groupAlerts([
    { ...invocation, toolName: 'Bash' },
    { ...invocation, toolName: 'PowerShell', createdAt: 50 },
  ]);
  assert.equal(causeLabel(g),
    'appel mal formé : un chemin Windows non protégé sous un shell POSIX');
});

test('causeLabel des autres types', () => {
  assert.equal(causeLabel(groupAlerts([{ ...base, type: 'retryStorm' }])[0]),
    'Bash · échecs consécutifs');
  assert.equal(causeLabel(groupAlerts([{ ...base, type: 'stuck', toolName: '' }])[0]),
    'Aucun événement · outils encore en vol');
  assert.equal(causeLabel(groupAlerts([{ ...base, type: 'pricingDrift' }])[0]),
    'pricingDrift', 'un type inconnu se rend lisible plutot que vide');
});

test('episodeLabel dit les faits du seul episode', () => {
  assert.equal(episodeLabel(base), 'même commande 4×, 3 sur 4 en échec');
  assert.equal(episodeLabel({ ...base, type: 'retryStorm', count: 3 }), '3 échecs consécutifs');
  assert.equal(episodeLabel({ ...base, type: 'stuck', count: 2 }), '2 outils encore en vol');
  assert.equal(episodeLabel({ ...base, type: 'stuck', count: 1 }), '1 outil encore en vol');
  assert.equal(episodeLabel({ ...invocation, count: 3 }), '3 fois dans la session');
  assert.equal(episodeLabel(invocation), '', 'une premiere occurrence ne parle pas de repetition');
  assert.equal(episodeLabel({ ...base, type: 'pricingDrift' }), '');
});
