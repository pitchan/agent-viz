'use strict';
// Le journal est la seule chose qui distingue une alarme d'un enregistreur de
// vol. Ce fichier fige les proprietes qui font qu'on peut lui faire
// confiance : il n'ecrit jamais deux fois le meme fait, il ne reecrit jamais
// une ligne deja ecrite, il rend l'alerte telle qu'elle est venue, il ne fait
// pas tomber le serveur quand le disque refuse, et il ne grandit pas sans fin.
//
// Aucun test ne touche le vrai `~` : tous passent un `filePath` sous
// os.tmpdir(), et le dossier est efface a la fin du test. La machine porte un
// instrument de mesure, pas un bac a sable.
//
// Aucun test ne depend de l'horloge murale non plus : `now` est injecte
// partout, y compris a la construction — la retention se mesure au chargement.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createJournal, keyOf } = require('../../lib/server/watchdog/journal');

const T = 1_700_000_000_000;
const DAY = 86_400_000;

const dossier = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-journal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const tmp = t => path.join(dossier(t), 'alerts.jsonl');
const lignes = fp => fs.readFileSync(fp, 'utf8').trim().split('\n').filter(Boolean);
const plaintes = (spy, motif) =>
  spy.mock.calls.filter(c => String(c.arguments[0]).includes(motif)).length;

// La forme reelle que produit makeAlert (public/viz-watchdog.mjs), tous champs
// compris. `acknowledged: false` en fait partie, et c'est un piege a signaler :
// une fois sur le disque ce champ est FIGE — la ligne n'est jamais reecrite,
// donc il dira false meme apres un acquittement. C'est `readAll` qui recalcule
// depuis les lignes `ack` et qui fait autorite ; la tache 8 ne doit jamais lire
// `acknowledged` depuis le fichier.
const alertAt = (createdAt, id = 'loop:s1:Bash') => ({
  id, type: 'loop', sessionId: 's1', toolName: 'Bash', count: 4, createdAt,
  message: 'Bash called 4x with the same input in 12s',
  agentId: '', agentType: '', subject: 'npm run build',
  occurrences: [{ ts: createdAt, toolUseId: 't1', failed: true }],
  tools: [], cwd: 'f:\\p', standing: false, acknowledged: false,
});

test('une alerte ecrite se relit', (t) => {
  const filePath = tmp(t);
  const j = createJournal({ filePath, now: () => T });
  assert.equal(j.append(alertAt(T)), true);
  const rows = createJournal({ filePath, now: () => T }).readAll({ now: T });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].createdAt, T);
  assert.equal(rows[0].acknowledged, false);
  assert.equal(rows[0].ackAt, null);
});

test('l alerte est relue telle qu elle est venue, champ pour champ', (t) => {
  // Le journal ne connait ni detecteur ni forme d'alerte au-dela de (id,
  // createdAt) : ce que les taches suivantes liront doit etre l'original, pas
  // une projection appauvrie. Seul `ackAt` est ajoute.
  const filePath = tmp(t);
  const original = alertAt(T);
  createJournal({ filePath, now: () => T }).append(original);
  const [row] = createJournal({ filePath, now: () => T }).readAll({ now: T });
  const { ackAt, ...restitue } = row;
  assert.deepEqual(restitue, original);
});

test('un champ ajoute par un nouveau detecteur survit au disque et au redemarrage', (t) => {
  // Il n'existe AUCUNE liste blanche de champs, ni ici ni sur la route qui sert
  // ces alertes : le journal ecrit l'objet entier et le relit entier. C'est ce
  // que ce test fige, sur le champ qui l'exige le plus — `patternId` est la
  // SEULE chose que porte une alerte d'appel mal forme, puisqu'elle ne consigne
  // ni la commande ni le message d'erreur. Le perdre a la relecture ne
  // laisserait pas une ligne incomplete : il laisserait une ligne qui ne dit
  // plus rien, et le bloc Pannes retomberait sur sa formulation generique sans
  // qu'aucun test ne bouge.
  const filePath = tmp(t);
  const invocation = {
    ...alertAt(T, 'badInvocation:s1:inv-bash-windows-path-unquoted'),
    type: 'badInvocation', count: 2, subject: '', occurrences: [],
    message: 'Bash failed on how it was called — inv-bash-windows-path-unquoted (2x this session)',
    patternId: 'inv-bash-windows-path-unquoted',
  };
  createJournal({ filePath, now: () => T }).append(invocation);

  const relu = createJournal({ filePath, now: () => T });
  const [row] = relu.readAll({ now: T });
  assert.equal(row.patternId, 'inv-bash-windows-path-unquoted',
    'le motif est tout ce que cette alerte sait dire');
  const { ackAt, ...restitue } = row;
  assert.deepEqual(restitue, invocation, 'et le reste avec lui, champ pour champ');

  // Et l'acquittement vise bien cette alerte-la : son id porte le motif, pas
  // l'outil, et il traverse le disque tel quel.
  relu.appendAck('badInvocation:s1:inv-bash-windows-path-unquoted', T, T + 5000);
  assert.equal(createJournal({ filePath, now: () => T }).readAll({ now: T })[0].acknowledged, true);
});

test('rejouer le meme fait n ecrit rien de plus', (t) => {
  const filePath = tmp(t);
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T));
  assert.equal(j.append(alertAt(T)), false, 'meme (id, createdAt) = meme fait');
  // Et au redemarrage, la cle est relue depuis le fichier, pas perdue.
  const j2 = createJournal({ filePath, now: () => T });
  assert.equal(j2.append(alertAt(T)), false);
  assert.equal(lignes(filePath).length, 1);
});

test('la meme alerte a un autre moment est un autre fait', (t) => {
  const j = createJournal({ filePath: tmp(t), now: () => T });
  j.append(alertAt(T));
  assert.equal(j.append(alertAt(T + 60_000)), true);
});

test('deux alertes distinctes au meme instant sont deux faits', (t) => {
  // Cas reel : `stuck` et `loop` concluent sur le meme battement d'horloge.
  // Une cle qui oublierait l'id en avalerait une des deux.
  const filePath = tmp(t);
  const j = createJournal({ filePath, now: () => T });
  assert.equal(j.append(alertAt(T, 'loop:s1:Bash')), true);
  assert.equal(j.append(alertAt(T, 'stuck:s1')), true);
  assert.equal(createJournal({ filePath, now: () => T }).readAll({ now: T }).length, 2);
});

test('une alerte sans cle est refusee, pas ecrite en silence', (t) => {
  // Sans (id, createdAt) le fait n'est ni deduplicable ni relisible :
  // l'ecrire le rendrait invisible a readAll (undefined >= plancher est faux)
  // tout en le faisant rediffuser a chaque rattrapage, pour toujours.
  const filePath = tmp(t);
  const spy = t.mock.method(console, 'error', () => {});
  const j = createJournal({ filePath, now: () => T });
  const { createdAt, ...sansHeure } = alertAt(T);
  assert.equal(j.append(sansHeure), false, 'un fait sans heure n est pas un fait');
  assert.equal(fs.existsSync(filePath), false, 'rien d irrecuperable n a ete ecrit');
  assert.equal(spy.mock.callCount(), 1, 'et le defaut est dit, pas avale');
});

test('acquitter ajoute une ligne, ne reecrit rien', (t) => {
  const filePath = tmp(t);
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T));
  j.appendAck('loop:s1:Bash', T, T + 5000);
  const l = lignes(filePath);
  assert.equal(l.length, 2);
  assert.equal(JSON.parse(l[0]).kind, 'alert');
  assert.equal(JSON.parse(l[1]).kind, 'ack');
  const rows = createJournal({ filePath, now: () => T }).readAll({ now: T });
  assert.equal(rows[0].acknowledged, true);
  assert.equal(rows[0].ackAt, T + 5000);
});

test('l acquittement recalcule bat le champ fige du fichier', (t) => {
  const filePath = tmp(t);
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T));
  j.appendAck('loop:s1:Bash', T, T + 5000);
  assert.equal(JSON.parse(lignes(filePath)[0]).alert.acknowledged, false,
    'la ligne du disque dit false pour toujours : elle n est jamais reecrite');
  const [row] = createJournal({ filePath, now: () => T }).readAll({ now: T });
  assert.equal(row.acknowledged, true, 'c est readAll qui fait autorite');
});

test('un acquittement au createdAt en chaine survit au redemarrage', (t) => {
  // Le point d'acquittement du produit est une route HTTP (tache 8), ou tout
  // parametre de requete arrive en CHAINE. `keyOf` fabrique une chaine, donc
  // sans normalisation a la frontiere la cle correspond en memoire vive, la
  // ligne part bien sur le disque, et c'est `ingest` qui la refuse a la
  // relecture : l'alerte acquittee revient. La panne ne se voit qu'apres un
  // redemarrage — la verifier en memoire vive ne prouve rien.
  const filePath = tmp(t);
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T));
  j.appendAck('loop:s1:Bash', String(T), T + 5000);
  assert.equal(j.readAll({ now: T })[0].acknowledged, true, 'en memoire vive');
  assert.equal(lignes(filePath).length, 2, 'la ligne d ack est bien sur le disque');
  const relu = createJournal({ filePath, now: () => T });
  assert.equal(relu.readAll({ now: T })[0].acknowledged, true, 'et apres un redemarrage');
  assert.equal(relu.readAll({ now: T })[0].ackAt, T + 5000);
});

test('un acquittement sans cle est refuse, pas ecrit en silence', (t) => {
  // Meme garde qu'`append`, pour la meme raison : ce que le journal ecrit doit
  // etre ce qu'il saura relire.
  const filePath = tmp(t);
  const spy = t.mock.method(console, 'error', () => {});
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T));
  j.appendAck('loop:s1:Bash', 'pas une date', T + 5000);
  // `Number('')` et `Number(null)` valent 0, un 0 que Number.isFinite accepte :
  // une conversion naive les prendrait pour un horodatage a l'epoque Unix et
  // ecrirait un acquittement orphelin. C'est pour ces deux-la que la conversion
  // est restreinte aux chaines non vides.
  j.appendAck('loop:s1:Bash', '', T + 5000);
  j.appendAck('loop:s1:Bash', null, T + 5000);
  // Et le blanc, pas seulement le vide : `Number('   ')` vaut 0 lui aussi, et
  // `?createdAt=%20` sur la route de la tache 8 suffit a l'envoyer.
  j.appendAck('loop:s1:Bash', '   ', T + 5000);
  assert.equal(lignes(filePath).length, 1, 'aucune ligne que la relecture rejetterait');
  assert.equal(j.readAll({ now: T })[0].acknowledged, false, 'ni acquittement en memoire');
  assert.equal(plaintes(spy, 'acquittement sans (id'), 4, 'et chaque defaut est dit, pas avale');
});

test('le contrat des horodatages : millisecondes epoch, rien d autre', (t) => {
  // `createdAt` et `at` sont des millisecondes epoch — nombre ou chaine de
  // chiffres. Une date ISO 8601 ou un objet Date n'en sont PAS, et c'est
  // delibere : lire du texte de date obligerait a accepter les formats locaux,
  // dont l'interpretation depend du moteur. On prefere une perte visible a une
  // donnee fausse silencieuse.
  const filePath = tmp(t);
  const spy = t.mock.method(console, 'error', () => {});
  const j = createJournal({ filePath, now: () => T + 9000 });
  j.append(alertAt(T));

  // Au contrat : le nombre et la chaine de chiffres nomment le meme fait.
  j.appendAck('loop:s1:Bash', T, T + 5000);
  assert.equal(j.readAll({ now: T })[0].ackAt, T + 5000);
  j.appendAck('loop:s1:Bash', String(T), String(T + 7000));
  assert.equal(j.readAll({ now: T })[0].ackAt, T + 7000, 'la chaine de chiffres vise la meme cle');

  // Hors contrat sur la cle : refus, parce que le serveur ne peut pas
  // l'inventer sans designer un autre fait.
  j.appendAck('loop:s1:Bash', new Date(T).toISOString(), T + 5000);
  j.appendAck('loop:s1:Bash', new Date(T), T + 5000);
  assert.equal(plaintes(spy, 'acquittement sans (id'), 2);
  assert.equal(plaintes(spy, 'horodatage'), 0, 'le refus de cle ne se deguise pas en repli');
});

test('la ligne dit quand c est l horloge du serveur qui a parle', (t) => {
  // `now()` est une observation juste, mais l'ecrire au meme endroit et sous
  // la meme forme que ce qu'un acquitteur aurait rapporte conflaterait deux
  // choses differentes. L'absence du champ vaut « fourni par l'appelant ».
  const filePath = tmp(t);
  t.mock.method(console, 'error', () => {});
  const j = createJournal({ filePath, now: () => T + 9000 });
  j.append(alertAt(T, 'loop:s1:Fourni'));
  j.append(alertAt(T, 'loop:s1:Repli'));

  j.appendAck('loop:s1:Fourni', T, T + 5000);
  // Une date REELLE, mais hors contrat : ce que le repli jette doit se voir.
  j.appendAck('loop:s1:Repli', T, new Date(T + 5000).toISOString());

  const acks = lignes(filePath).map(JSON.parse).filter(r => r.kind === 'ack');
  const fourni = acks.find(r => r.id === 'loop:s1:Fourni');
  const repli = acks.find(r => r.id === 'loop:s1:Repli');
  assert.equal(fourni.at, T + 5000);
  assert.equal('atFrom' in fourni, false, 'rien a signaler : l appelant l a fourni');
  assert.equal(repli.at, T + 9000, 'l horloge du serveur');
  assert.equal(repli.atFrom, 'server', 'et la ligne dit que c est elle');

  // `readAll` l'ignore : c'est la trace sur le disque qui compte.
  const [row] = createJournal({ filePath, now: () => T }).readAll({ now: T });
  assert.equal('atFrom' in row, false);
});

test('un acquittement sans horodatage utilisable retombe sur l horloge du serveur', (t) => {
  // `at` ne fait pas partie de la cle : il ne dit pas QUELLE alerte est
  // acquittee, seulement QUAND. Refuser perdrait une action reelle de
  // l'utilisateur — le panneau resterait allume sur une alerte qu'il vient
  // d'eteindre, il recliquerait, une ligne de plus, sans fin. La tache 8
  // acquitte par une route HTTP : un parametre absent arrive `undefined`.
  const filePath = tmp(t);
  const spy = t.mock.method(console, 'error', () => {});
  const j = createJournal({ filePath, now: () => T + 9000 });
  j.append(alertAt(T));
  j.appendAck('loop:s1:Bash', T, undefined);
  const [vif] = j.readAll({ now: T });
  assert.equal(vif.acknowledged, true, 'l acquittement de l utilisateur n est pas perdu');
  assert.equal(vif.ackAt, T + 9000, 'l heure retenue est celle du serveur, pas une invention');
  const [relu] = createJournal({ filePath, now: () => T }).readAll({ now: T });
  assert.equal(relu.acknowledged, true, 'et il survit au redemarrage');
  assert.equal(relu.ackAt, T + 9000);
  assert.equal(plaintes(spy, 'horodatage'), 1, 'l appelant casse ne reste pas invisible');

  // Une chaine qui n'est pas un horodatage suit le meme chemin.
  j.append(alertAt(T + 1000, 'loop:s1:Autre'));
  j.appendAck('loop:s1:Autre', T + 1000, 'demain');
  const autre = j.readAll({ now: T + 1000 }).find(a => a.id === 'loop:s1:Autre');
  assert.equal(autre.ackAt, T + 9000);
  assert.equal(plaintes(spy, 'horodatage'), 2);
});

test('un acquittement horodate en chaine garde son heure', (t) => {
  // Meme frontiere HTTP que `createdAt`, meme normalisation : ce qui est relu
  // doit etre un nombre, pas la chaine qu'on a recue.
  const filePath = tmp(t);
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T));
  j.appendAck('loop:s1:Bash', String(T), String(T + 5000));
  const [relu] = createJournal({ filePath, now: () => T }).readAll({ now: T });
  assert.equal(relu.acknowledged, true);
  assert.equal(relu.ackAt, T + 5000, 'un nombre, pas une chaine');
});

test('l acquittement vaut aussitot, sans attendre une relecture', (t) => {
  // Le serveur ne redemarre pas entre l'acquittement et le rafraichissement
  // du panneau : c'est la meme instance qui repond. Un test qui ne verifie
  // l'ack qu'apres relecture laisse passer un journal qui ne l'inscrit qu'au
  // fichier.
  const j = createJournal({ filePath: tmp(t), now: () => T });
  j.append(alertAt(T));
  j.appendAck('loop:s1:Bash', T, T + 5000);
  const [row] = j.readAll({ now: T });
  assert.equal(row.acknowledged, true);
  assert.equal(row.ackAt, T + 5000);
});

test('un acquittement ne vaut que pour le fait qu il nomme', (t) => {
  // L'ack porte (id, createdAt) : acquitter la panne d'hier ne doit pas
  // eteindre celle de ce matin, qui porte le meme id.
  const filePath = tmp(t);
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T));
  j.append(alertAt(T + 60_000));
  j.appendAck('loop:s1:Bash', T, T + 5000);
  const rows = createJournal({ filePath, now: () => T }).readAll({ now: T + 60_000 });
  assert.deepEqual(rows.map(r => [r.createdAt, r.acknowledged]),
    [[T + 60_000, false], [T, true]]);
});

test('la fenetre coupe sur l heure de l evenement, plus recent d abord', (t) => {
  const j = createJournal({ filePath: tmp(t), now: () => T });
  // Ordre d'ecriture volontairement different de l'ordre attendu : sans le
  // tri, la reponse serait [Moyen, Recent].
  j.append(alertAt(T - 40 * DAY, 'loop:s1:Vieux'));
  j.append(alertAt(T - 10 * DAY, 'loop:s1:Moyen'));
  j.append(alertAt(T - 2 * DAY, 'loop:s1:Recent'));
  const ids = j.readAll({ sinceDays: 30, now: T }).map(a => a.id);
  assert.deepEqual(ids, ['loop:s1:Recent', 'loop:s1:Moyen']);
});

test('une alerte a l horloge en avance est gardee, et vient en tete', (t) => {
  // Horloge de machine decalee : `createdAt` vient de l'evenement, pas du
  // serveur. Une memoire ne jette pas un fait parce qu'il la surprend. Le
  // prix de ce choix est ecrit dans journal.js : une horloge fausse d'un an
  // produit une alerte epinglee en tete a vie.
  const j = createJournal({ filePath: tmp(t), now: () => T });
  j.append(alertAt(T - 3600_000, 'loop:s1:Passe'));
  j.append(alertAt(T + 3600_000, 'loop:s1:Futur'));
  const ids = j.readAll({ sinceDays: 30, now: T }).map(a => a.id);
  assert.deepEqual(ids, ['loop:s1:Futur', 'loop:s1:Passe']);
});

test('une ligne illisible est sautee, jamais fatale', (t) => {
  const filePath = tmp(t);
  fs.writeFileSync(filePath,
    JSON.stringify({ kind: 'alert', alert: alertAt(T) }) + '\n'
    + '{ceci n est pas du json\n'
    + JSON.stringify({ kind: 'alert', alert: alertAt(T + 1000, 'loop:s1:Autre') }) + '\n');
  const rows = createJournal({ filePath, now: () => T + 1000 }).readAll({ now: T + 1000 });
  assert.equal(rows.length, 2, 'un arret brutal ne doit pas empecher le demarrage');
  assert.equal(lignes(filePath).length, 3,
    'une ligne illisible ne declenche pas a elle seule une reecriture');
});

test('un premier demarrage ne se plaint pas', (t) => {
  const spy = t.mock.method(console, 'error', () => {});
  createJournal({ filePath: tmp(t), now: () => T });
  assert.equal(spy.mock.callCount(), 0, 'un fichier absent est un debut, pas un incident');
});

test('un journal illisible se plaint, il ne repart pas vide en silence', (t) => {
  // Le cas Windows : antivirus ou sauvegarde qui tient le fichier (EBUSY),
  // droits perdus (EACCES). Traiter ca comme un premier demarrage repartirait
  // avec `seen` vide, et le rattrapage de la tache 6 rendrait alors `true` sur
  // tout l'historique : tout rediffuse, un doublon par alerte dans le fichier.
  const filePath = tmp(t);
  fs.mkdirSync(filePath);                       // EISDIR a la lecture
  const spy = t.mock.method(console, 'error', () => {});
  createJournal({ filePath, now: () => T });
  assert.equal(plaintes(spy, 'illisible'), 1);
});

test('un disque qui refuse ne fait pas tomber le service', (t) => {
  // Un dossier la ou le fichier devrait etre : toute ecriture echouera.
  const filePath = tmp(t);
  fs.mkdirSync(filePath);
  // Implementation muette : les plaintes sont attendues, la sortie de la
  // suite n'a pas a les porter.
  const spy = t.mock.method(console, 'error', () => {});
  const j = createJournal({ filePath, now: () => T });
  assert.doesNotThrow(() => j.append(alertAt(T)));
  // Assez d'ecritures pour couvrir le delai de reprise et provoquer une
  // seconde tentative reelle : sans ca, « une seule plainte » ne prouverait
  // rien qu'une absence de tentative.
  for (let i = 0; i < 30; i++) assert.doesNotThrow(() => j.appendAck('loop:s1:Bash', T, T + i));
  // Le fait est en memoire : l'appelant doit pouvoir diffuser l'alerte meme
  // quand le disque l'a refusee. Perdre la memoire n'est pas perdre l'alerte.
  assert.equal(j.readAll({ now: T }).length, 1);
  assert.equal(plaintes(spy, 'indisponible'), 1, 'on le dit une fois par panne, pas par ecriture');
});

test('une ecriture refusee reste un fait inedit pour l appelant', (t) => {
  const filePath = tmp(t);
  fs.mkdirSync(filePath);
  t.mock.method(console, 'error', () => {});
  const j = createJournal({ filePath, now: () => T });
  assert.equal(j.append(alertAt(T)), true, 'l alerte doit etre diffusee malgre le disque');
  assert.equal(j.append(alertAt(T)), false, 'mais elle ne redevient pas inedite');
});

test('un disque qui redevient disponible est reessaye, et la panne suivante se dit', (t) => {
  // Un echec transitoire ne doit pas eteindre la memoire jusqu'au prochain
  // redemarrage : sinon plus aucun acquittement n'est ecrit, et toutes les
  // alertes que l'utilisateur avait acquittees reviennent au demarrage suivant.
  const filePath = tmp(t);
  fs.mkdirSync(filePath);
  const spy = t.mock.method(console, 'error', () => {});
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T));
  assert.equal(plaintes(spy, 'indisponible'), 1);

  fs.rmdirSync(filePath);                       // le disque repond de nouveau
  for (let i = 0; i < 30; i++) j.appendAck('loop:s1:Bash', T, T + i);
  assert.ok(fs.statSync(filePath).isFile(), 'le journal a repris tout seul');
  assert.equal(plaintes(spy, 'indisponible'), 1, 'la reprise ne re-annonce pas la panne');

  // Et le verrou n'a pas ete cimente : une NOUVELLE panne a droit a sa plainte.
  t.mock.method(fs, 'appendFileSync', () => { throw new Error('disque plein'); });
  j.appendAck('loop:s1:Bash', T, T + 999);
  assert.equal(plaintes(spy, 'indisponible'), 2);
});

test('au-dela de la retention, la ligne quitte la memoire et le fichier', (t) => {
  const filePath = tmp(t);
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T - 100 * DAY, 'loop:s1:Ancetre'));
  j.append(alertAt(T - 10 * DAY, 'loop:s1:Recent'));
  assert.equal(lignes(filePath).length, 2, 'les deux ont bien ete ecrites');

  const relu = createJournal({ filePath, now: () => T });
  assert.deepEqual(relu.readAll({ sinceDays: 90, now: T }).map(a => a.id), ['loop:s1:Recent']);
  assert.equal(relu.seenKeys().size, 1, 'la cle perimee ne pese plus en memoire');
  assert.equal(lignes(filePath).length, 1,
    'le fichier est compacte, pas seulement filtre a la lecture');
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ['alerts.jsonl'],
    'aucun fichier temporaire laisse derriere');
});

test('la compaction garde l acquittement du fait qu elle garde', (t) => {
  const filePath = tmp(t);
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T - 100 * DAY, 'loop:s1:Ancetre'));
  j.append(alertAt(T - 10 * DAY, 'loop:s1:Recent'));
  j.appendAck('loop:s1:Recent', T - 10 * DAY, T - 9 * DAY);
  j.appendAck('loop:s1:Ancetre', T - 100 * DAY, T - 99 * DAY);

  const relu = createJournal({ filePath, now: () => T });
  assert.deepEqual(relu.readAll({ sinceDays: 90, now: T }).map(a => [a.id, a.acknowledged]),
    [['loop:s1:Recent', true]]);
  assert.equal(lignes(filePath).length, 2, 'l alerte gardee et son ack, rien d autre');
});

test('sans peremption, le journal n est pas reecrit du tout', (t) => {
  // L'ajout seul reste la regle : on ne reecrit que pour la peremption, jamais
  // « au cas ou » a chaque demarrage.
  const filePath = tmp(t);
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T - 10 * DAY, 'loop:s1:A'));
  j.append(alertAt(T - 2 * DAY, 'loop:s1:B'));
  const avant = fs.readFileSync(filePath, 'utf8');
  const renommage = t.mock.method(fs, 'renameSync');
  createJournal({ filePath, now: () => T });
  assert.equal(renommage.mock.callCount(), 0, 'aucune compaction quand rien n a peri');
  assert.equal(fs.readFileSync(filePath, 'utf8'), avant);
});

test('une horloge qui saute ne vide pas le journal', (t) => {
  // Pile morte, machine virtuelle restauree depuis un instantane, saut NTP au
  // demarrage. `readAll` refuse deja de jeter une alerte datee du futur parce
  // que l'horloge peut mentir : `load` ne peut pas se fier a la meme horloge
  // pour reecrire le fichier de facon irreversible. Un seul demarrage suffirait
  // sinon a vider la seule chose que le produit ne sait pas reconstruire.
  const filePath = tmp(t);
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T - 2 * DAY, 'loop:s1:A'));
  j.append(alertAt(T - 1 * DAY, 'loop:s1:B'));
  j.appendAck('loop:s1:B', T - 1 * DAY, T);
  const avant = fs.readFileSync(filePath, 'utf8');

  const fou = createJournal({ filePath, now: () => T + 200 * DAY });
  assert.equal(fs.readFileSync(filePath, 'utf8'), avant, 'rien n a ete detruit');
  assert.equal(fou.readAll({ sinceDays: 90, now: T + 200 * DAY }).length, 0,
    'la memoire vive reste bornee, elle, meme quand le fichier ne bouge pas');

  // L'horloge revenue a la raison, tout est encore la — acquittement compris.
  const relu = createJournal({ filePath, now: () => T });
  assert.deepEqual(relu.readAll({ sinceDays: 90, now: T }).map(a => [a.id, a.acknowledged]),
    [['loop:s1:B', true], ['loop:s1:A', false]]);
});

test('une compaction qui echoue laisse le journal entier', (t) => {
  // Fichier temporaire puis renommage : si la reecriture casse, l'ancien
  // journal doit etre encore la. Une reecriture en place laisserait un fichier
  // tronque — pire que trop long.
  const filePath = tmp(t);
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T - 100 * DAY, 'loop:s1:Ancetre'));
  j.append(alertAt(T - 10 * DAY, 'loop:s1:Recent'));
  const avant = fs.readFileSync(filePath, 'utf8');

  const spy = t.mock.method(console, 'error', () => {});
  t.mock.method(fs, 'renameSync', () => { throw new Error('renommage refuse'); });
  const relu = createJournal({ filePath, now: () => T });
  assert.equal(fs.readFileSync(filePath, 'utf8'), avant, 'le journal d origine est intact');
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ['alerts.jsonl'],
    'le temporaire est nettoye');
  assert.equal(relu.readAll({ sinceDays: 90, now: T }).length, 1,
    'la memoire vive est bornee meme quand le fichier ne l est pas');
  assert.equal(plaintes(spy, 'compaction'), 1);
});

test('keyOf distingue deux alertes que la concatenation naive confondrait', () => {
  // Sans separateur, ('a1', 2) et ('a', 12) donnent tous deux 'a12'.
  assert.notEqual(keyOf('a1', 2), keyOf('a', 12));
});

test('seenKeys rend une copie, pas la memoire du journal', (t) => {
  const j = createJournal({ filePath: tmp(t), now: () => T });
  j.append(alertAt(T));
  const cles = j.seenKeys();
  assert.equal(cles.size, 1);
  assert.ok(cles.has(keyOf('loop:s1:Bash', T)));
  cles.clear();
  assert.equal(j.append(alertAt(T)), false, 'toucher la copie ne rouvre pas le fait');
});
