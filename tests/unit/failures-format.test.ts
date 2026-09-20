// La formulation francaise d'une ligne de panne, au meme endroit pour tout le
// monde. Elle se compose des CHAMPS de l'alerte, jamais de son `message`
// anglais : traduire une phrase deja faite serait la seule facon de la voir
// diverger de ce que le detecteur a reellement mesure.

import { expect, test } from 'vitest';
import { failureLine, projectLabel, failuresSummary, groupKey, groupAlerts, causeLabel, episodeLabel, panelAlerts } from '../../src/web/observatory/failures-format.ts';
import { _DETECTOR_TYPES, type Alert } from '../../src/engine/watchdog/detector.ts';
import { readAlert } from '../../src/web/viz-alert-shape.ts';

const T0 = Date.UTC(2026, 7, 7, 14, 42, 0);

// Une alerte complete, avec tous les champs qu'ecrit le detecteur : chaque
// fixture ne declare que ce qui differe.
const alerte = (sur: Record<string, any> = {}): Alert => ({
  id: 'loop:s1:Bash', type: 'loop', sessionId: 's1', toolName: 'Bash', count: 4,
  createdAt: T0, message: 'Bash called 4 times with the same input in 15s',
  agentId: '', agentType: '', subject: 'npm run build', occurrences: [], tools: [],
  cwd: 'f:\\DEV\\Demo IA OPTIM\\SKILLS TOKEN SAVERS', standing: false, patternId: '',
  acknowledged: false, ...sur,
});
const occurrences = (...issues: Array<boolean | null>) =>
  issues.map((failed, i) => ({ ts: T0 + i * 5_000, toolUseId: `t${i}`, failed }));
const outil = (toolName: string, subject: string) =>
  ({ toolUseId: `u-${toolName}`, toolName, subject, startedAt: T0, agentId: '', agentType: '' });

const base = alerte({ occurrences: occurrences(true, true, true, null) });

const invocation = alerte({
  id: 'badInvocation:s1:inv-bash-windows-path-unquoted', type: 'badInvocation', count: 1, subject: '',
  message: 'Bash: unquoted Windows path', patternId: 'inv-bash-windows-path-unquoted',
});

// Le bloc ne recoit que ce que la porte d'entree du navigateur laisse passer :
// une fixture qu'elle refuserait ferait passer un test sur une forme impossible.
test('les fixtures de ce fichier ont la forme qu une alerte doit avoir pour entrer', () => {
  // Arrange
  const fixtures = [base, invocation];
  // Act
  const lues = fixtures.map(f => readAlert(f));
  // Assert
  expect(lues).toEqual(fixtures);
});

test('le projet se nomme par son chemin reel, lettre de lecteur en majuscule', () => {
  expect(projectLabel('f:\\DEV\\projet')).toBe('F:\\DEV\\projet');
  expect(projectLabel('')).toBe('projet inconnu');
});

test('une boucle en echec COMPTE, en francais, sans traduire le message anglais', () => {
  const l = failureLine(base);
  expect(l.headline).toBe('Bash · même commande 4×, 3 sur 4 en échec');
  expect(l.subject).toBe('npm run build');
  expect(l.project).toBe('F:\\DEV\\Demo IA OPTIM\\SKILLS TOKEN SAVERS');
});

test('une boucle en partie en echec affiche son denominateur', () => {
  const l = failureLine({ ...base, occurrences: occurrences(true, false, false, null) });
  expect(l.headline).toBe('Bash · même commande 4×, 1 sur 4 en échec');
});

test('une boucle sans echec connu ne parle pas d echec', () => {
  const l = failureLine({ ...base, occurrences: occurrences(false, false, false, null) });
  expect(l.headline).toBe('Bash · même commande 4×');
});

test('un orage d echecs se distingue d une boucle', () => {
  const l = failureLine({ ...base, type: 'retryStorm', count: 3, occurrences: [] });
  expect(l.headline).toBe('Bash · 3 échecs consécutifs');
});

test('une session bloquee nomme ce qu elle attend', () => {
  const l = failureLine({
    ...base, type: 'stuck', toolName: '', count: 2, subject: '', occurrences: [],
    tools: [outil('Bash', 'npm run build'), outil('Read', 'a.js')],
  });
  expect(l.headline).toBe('Aucun événement · 2 outils encore en vol');
  expect(l.subject).toBe('Bash · npm run build');
});

// Un seul outil en vol est le cas le plus frequent d'une session bloquee : le
// pluriel y serait faux a chaque fois. Mutation attrapee : figer le suffixe.
test('une session bloquee sur un seul outil parle au singulier', () => {
  const l = failureLine({
    ...base, type: 'stuck', toolName: '', count: 1, subject: '', occurrences: [],
    tools: [outil('Bash', 'npm run build')],
  });
  expect(l.headline).toBe('Aucun événement · 1 outil encore en vol');
});

// ── Appel mal formé ────────────────────────────────────────────────────────
//
// L'alerte porte un IDENTIFIANT de motif — `inv-bash-windows-path-unquoted` —
// et rien d'autre : ni la commande, ni le message d'erreur. C'est ce bloc qui
// en fait une phrase. Traduire le `message` anglais serait la seule facon de
// le voir diverger de ce que le detecteur a mesure, et ce `message` sert la
// notification bureau, qui suit la langue du chrome. La fixture `invocation`
// est posee en tete de fichier, avec `base`.

test('un appel mal forme dit LEQUEL, en francais, depuis le seul identifiant', () => {
  const l = failureLine(invocation);
  expect(l.headline).toBe(
    'Bash · appel mal formé : un chemin Windows non protégé sous un shell POSIX');
  expect(l.subject, 'aucun texte de commande n a ete consigne, rien a montrer').toBe('');
});

test('un appel mal forme repete dit combien de fois', () => {
  expect(failureLine({ ...invocation, count: 3 }).headline).toBe(
    'Bash · appel mal formé : un chemin Windows non protégé sous un shell POSIX, 3 fois dans la session');
});

// Le detecteur compte TOUJOURS, des la premiere occurrence. « 1 fois dans la
// session » se lit comme du bruit sur une ligne de tableau de bord.
// Mutation attrapee : afficher le compte sans condition.
test('une premiere occurrence ne parle pas de repetition', () => {
  expect(failureLine(invocation).headline).not.toMatch(/fois dans la session/);
});

// La table des motifs (src/engine/watchdog/invocation-patterns.ts) grandit a chaque cas
// rencontre, et elle n'a pas a attendre ce fichier-ci pour le faire. Un motif
// qu'il ne connait pas encore doit donc dire ce qu'on sait vraiment — que
// quelque chose se regle sur le poste — plutot que de laisser un trou.
//
// Mutation attrapee : retirer le repli et composer directement avec la table.
test('un motif que le bloc ne connait pas encore retombe sur une formulation generique', () => {
  const l = failureLine({ ...invocation, patternId: 'inv-motif-de-demain' });
  expect(l.headline).toBe('Bash · appel mal formé : un réglage du poste de travail');
  expect(l.headline, 'un identifiant technique n est pas une phrase francaise')
    .not.toMatch(/inv-motif-de-demain/);
});

test('chaque cause du releve dit ce qui a ete mal ecrit, pas ce que l outil a repondu', () => {
  const antislash = failureLine({ ...invocation, patternId: 'inv-bash-trailing-backslash-in-path' });
  expect(antislash.headline).toBe(
    'Bash · appel mal formé : un guillemet double non fermé — typiquement un chemin Windows terminé par un antislash');
  const heredoc = failureLine({ ...invocation, patternId: 'inv-bash-heredoc-too-large' });
  expect(heredoc.headline).toBe(
    'Bash · appel mal formé : un guillemet simple non fermé — typiquement un heredoc trop gros pour la ligne de commande');
});

test('la phrase du filet est celle qui sert quand la cause n est pas caracterisee', () => {
  // Le filet alerte, donc une alerte porte cette phrase : la seule du bloc qui
  // decrit un symptome sans nommer de remede, parce que le filet ne se declenche
  // que lorsque aucune des deux ancres ne reconnait la forme.
  const l = failureLine({ ...invocation, patternId: 'inv-bash-unbalanced-quote' });
  expect(l.headline).toMatch(/guillemet ouvert et jamais refermé/);
  expect(l.headline).not.toMatch(/réglage du poste de travail/);
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
  expect(_DETECTOR_TYPES.length >= 4, 'la liste des detecteurs doit etre reelle').toBeTruthy();
  for (const type of _DETECTOR_TYPES) {
    const headline = failureLine({ ...invocation, type: type as Alert['type'] }).headline;
    expect(headline, `${type} n a pas de formulation francaise : le bloc afficherait son nom de type`).not.toBe(type);
  }
});

// Le bloc est la MEMOIRE des pannes, pas leur vivacite : sur 30 jours, « non
// acquittees » et « en cours » different, et c'est la pastille qui dit la
// seconde (`standing` -> activeIds, evenementiel -> fraicheur).
//
// Mutation attrapee : remplacer le libelle par un quantificateur de vivacite.
test('le resume compte les non acquittees, il ne prononce pas « en cours »', () => {
  expect(failuresSummary([])).toBe('aucune');
  expect(failuresSummary([alerte({ acknowledged: true })])).toBe('aucune');
  expect(failuresSummary([alerte({ acknowledged: false })])).toBe('1 non acquittée');
  expect(
    failuresSummary([alerte({ acknowledged: false }), alerte({ acknowledged: true }), alerte({ acknowledged: false })]),
  ).toBe('2 non acquittées');
});

// ── Ce que le panneau accepte de montrer : des fautes, pas des etats ───────
//
// `stuck` decrit un etat passager qui se resout tout seul. En vivant il a sa
// pastille et sa notification bureau, qui nomment chaque commande en vol ; en
// memoire, declenche des 3 minutes de silence, il noyait les vraies fautes
// sous des commandes simplement longues. Un etat qui se resout seul n'est pas
// une dette du lecteur.

test('panelAlerts ecarte les silences (stuck) et garde tout le reste', () => {
  const kept = panelAlerts([
    base,
    { ...base, type: 'stuck', toolName: '', count: 1 },
    invocation,
    { ...base, type: 'retryStorm' },
  ]);
  expect(kept.map(a => a.type)).toEqual(['loop', 'badInvocation', 'retryStorm']);
});

// ── Regroupement par cause ─────────────────────────────────────────────────

test('la clef de groupe suit la cause, pas l episode', () => {
  expect(groupKey(invocation)).toBe('badInvocation:inv-bash-windows-path-unquoted');
  expect(groupKey(base)).toBe('loop:Bash');
  expect(groupKey({ ...base, type: 'retryStorm', toolName: 'Grep' })).toBe('retryStorm:Grep');
  expect(groupKey({ ...base, type: 'stuck' })).toBe('stuck');
});

test('les episodes d une meme cause se regroupent, tries du plus recent au plus ancien', () => {
  const groupes = groupAlerts([
    { ...invocation, createdAt: 100, acknowledged: true },
    { ...invocation, createdAt: 300, acknowledged: false },
    { ...invocation, createdAt: 200, acknowledged: false },
  ]);
  expect(groupes.length).toBe(1);
  expect(groupes[0]!.episodes.map(e => e.createdAt)).toEqual([300, 200, 100]);
  expect(groupes[0]!.lastAt).toBe(300);
  expect(groupes[0]!.unacked).toBe(2);
});

test('les groupes a traiter passent devant, puis le plus recent', () => {
  const groupes = groupAlerts([
    { ...base, createdAt: 900, acknowledged: true },                       // loop, soldé, récent
    { ...invocation, createdAt: 100, acknowledged: false },                // à traiter, ancien
    { ...base, type: 'retryStorm', createdAt: 500, acknowledged: false },  // à traiter, récent
  ]);
  expect(groupes.map(g => g.key)).toEqual(
    ['retryStorm:Bash', 'badInvocation:inv-bash-windows-path-unquoted', 'loop:Bash']);
});

// ── Libellés : la cause n emprunte jamais les chiffres d un episode ────────

test('causeLabel nomme la cause, sans compter', () => {
  const g = groupAlerts([{ ...base, count: 4 }, { ...base, count: 7, createdAt: 50 }])[0]!;
  expect(causeLabel(g)).toBe('Bash · même commande répétée');
  expect(causeLabel(g)).not.toMatch(/\d/);
});

test('causeLabel d un appel mal forme reprend la phrase du motif', () => {
  const g = groupAlerts([invocation])[0]!;
  expect(causeLabel(g)).toBe(
    'Bash · appel mal formé : un chemin Windows non protégé sous un shell POSIX');
});

test('l outil ne se dit que s il est uniforme dans le groupe', () => {
  const g = groupAlerts([
    { ...invocation, toolName: 'Bash' },
    { ...invocation, toolName: 'PowerShell', createdAt: 50 },
  ])[0]!;
  expect(causeLabel(g)).toBe(
    'appel mal formé : un chemin Windows non protégé sous un shell POSIX');
});

test('causeLabel des autres types', () => {
  expect(causeLabel(groupAlerts([{ ...base, type: 'retryStorm' }])[0]!)).toBe(
    'Bash · échecs consécutifs');
  expect(causeLabel(groupAlerts([{ ...base, type: 'stuck', toolName: '' }])[0]!)).toBe(
    'Aucun événement · outils encore en vol');
});

test('episodeLabel dit les faits du seul episode', () => {
  expect(episodeLabel(base)).toBe('même commande 4×, 3 sur 4 en échec');
  expect(episodeLabel({ ...base, type: 'retryStorm', count: 3 })).toBe('3 échecs consécutifs');
  expect(episodeLabel({ ...base, type: 'stuck', count: 2 })).toBe('2 outils encore en vol');
  expect(episodeLabel({ ...base, type: 'stuck', count: 1 })).toBe('1 outil encore en vol');
  expect(episodeLabel({ ...invocation, count: 3 })).toBe('3 fois dans la session');
  expect(episodeLabel(invocation), 'une premiere occurrence ne parle pas de repetition').toBe('');
});
