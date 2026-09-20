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

import { afterAll, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJournal, keyOf } from '../../src/server/watchdog/journal.ts';

const T = 1_700_000_000_000;
const DAY = 86_400_000;

// Chaque test cree son propre dossier ; le nettoyage est groupe en fin de
// fichier plutot que par test (meme parti que watchdog-service.test.ts et
// watchdog-wiring.test.ts) — `t.after` n'a pas d'equivalent par-test simple
// avec l'API de vitest.
const aNettoyer: string[] = [];
afterAll(() => { for (const d of aNettoyer) fs.rmSync(d, { recursive: true, force: true }); });

const dossier = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-journal-'));
  aNettoyer.push(dir);
  return dir;
};
const tmp = () => path.join(dossier(), 'alerts.jsonl');
const lignes = (fp: string) => fs.readFileSync(fp, 'utf8').trim().split('\n').filter(Boolean);
const plaintes = (spy: ReturnType<typeof vi.spyOn>, motif: string) =>
  spy.mock.calls.filter(c => String(c[0]).includes(motif)).length;

// La forme reelle que produit makeAlert (src/engine/watchdog/detector.ts), tous champs
// compris. Piege : `acknowledged: false` est FIGE sur le disque, la ligne n'etant jamais
// reecrite ; seul `readAll`, qui recalcule depuis les lignes `ack`, fait autorite.
const alertAt = (createdAt: number, id = 'loop:s1:Bash') => ({
  id, type: 'loop', sessionId: 's1', toolName: 'Bash', count: 4, createdAt,
  message: 'Bash called 4x with the same input in 12s',
  agentId: '', agentType: '', subject: 'npm run build',
  occurrences: [{ ts: createdAt, toolUseId: 't1', failed: true }],
  tools: [], cwd: 'f:\\p', standing: false, acknowledged: false,
});

test('une alerte ecrite se relit', () => {
  const filePath = tmp();
  const j = createJournal({ filePath, now: () => T });
  expect(j.append(alertAt(T))).toBe(true);
  const rows = createJournal({ filePath, now: () => T }).readAll({ now: T }) as any[];
  expect(rows.length).toBe(1);
  expect(rows[0].createdAt).toBe(T);
  expect(rows[0].acknowledged).toBe(false);
  expect(rows[0].ackAt).toBe(null);
});

test('l alerte est relue telle qu elle est venue, champ pour champ', () => {
  // Le journal ne connait ni detecteur ni forme d'alerte au-dela de (id,
  // createdAt) : ce qu'il rend doit etre l'alerte d'origine, pas une projection
  // appauvrie. Seul `ackAt` est ajoute.
  const filePath = tmp();
  const original = alertAt(T);
  createJournal({ filePath, now: () => T }).append(original);
  const [row] = createJournal({ filePath, now: () => T }).readAll({ now: T }) as any[];
  const { ackAt, ...restitue } = row;
  expect(restitue).toEqual(original);
});

test('un champ ajoute par un nouveau detecteur survit au disque et au redemarrage', () => {
  // Il n'existe AUCUNE liste blanche de champs, ni ici ni sur la route qui sert
  // ces alertes : le journal ecrit l'objet entier et le relit entier. C'est ce
  // que ce test fige, sur le champ qui l'exige le plus — `patternId` est la
  // SEULE chose que porte une alerte d'appel mal forme, puisqu'elle ne consigne
  // ni la commande ni le message d'erreur. Le perdre a la relecture ne
  // laisserait pas une ligne incomplete : il laisserait une ligne qui ne dit
  // plus rien, et le bloc Pannes retomberait sur sa formulation generique sans
  // qu'aucun test ne bouge.
  const filePath = tmp();
  const invocation = {
    ...alertAt(T, 'badInvocation:s1:inv-bash-windows-path-unquoted'),
    type: 'badInvocation', count: 2, subject: '', occurrences: [],
    message: 'Bash failed on how it was called — inv-bash-windows-path-unquoted (2x this session)',
    patternId: 'inv-bash-windows-path-unquoted',
  };
  createJournal({ filePath, now: () => T }).append(invocation);

  const relu = createJournal({ filePath, now: () => T });
  const [row] = relu.readAll({ now: T }) as any[];
  expect(row.patternId, 'le motif est tout ce que cette alerte sait dire').toBe('inv-bash-windows-path-unquoted');
  const { ackAt, ...restitue } = row;
  expect(restitue, 'et le reste avec lui, champ pour champ').toEqual(invocation);

  // Et l'acquittement vise bien cette alerte-la : son id porte le motif, pas
  // l'outil, et il traverse le disque tel quel.
  relu.appendAck('badInvocation:s1:inv-bash-windows-path-unquoted', T, T + 5000);
  expect((createJournal({ filePath, now: () => T }).readAll({ now: T }) as any[])[0].acknowledged).toBe(true);
});

test('rejouer le meme fait n ecrit rien de plus', () => {
  const filePath = tmp();
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T));
  expect(j.append(alertAt(T)), 'meme (id, createdAt) = meme fait').toBe(false);
  // Et au redemarrage, la cle est relue depuis le fichier, pas perdue.
  const j2 = createJournal({ filePath, now: () => T });
  expect(j2.append(alertAt(T))).toBe(false);
  expect(lignes(filePath).length).toBe(1);
});

test('la meme alerte a un autre moment est un autre fait', () => {
  const j = createJournal({ filePath: tmp(), now: () => T });
  j.append(alertAt(T));
  expect(j.append(alertAt(T + 60_000))).toBe(true);
});

test('deux alertes distinctes au meme instant sont deux faits', () => {
  // Cas reel : `stuck` et `loop` concluent sur le meme battement d'horloge.
  // Une cle qui oublierait l'id en avalerait une des deux.
  const filePath = tmp();
  const j = createJournal({ filePath, now: () => T });
  expect(j.append(alertAt(T, 'loop:s1:Bash'))).toBe(true);
  expect(j.append(alertAt(T, 'stuck:s1'))).toBe(true);
  expect(createJournal({ filePath, now: () => T }).readAll({ now: T }).length).toBe(2);
});

test('une alerte sans cle est refusee, pas ecrite en silence', () => {
  // Sans (id, createdAt) le fait n'est ni deduplicable ni relisible :
  // l'ecrire le rendrait invisible a readAll (undefined >= plancher est faux)
  // tout en le faisant rediffuser a chaque rattrapage, pour toujours.
  const filePath = tmp();
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const j = createJournal({ filePath, now: () => T });
  const { createdAt, ...sansHeure } = alertAt(T);
  expect(j.append(sansHeure as any), 'un fait sans heure n est pas un fait').toBe(false);
  expect(fs.existsSync(filePath), 'rien d irrecuperable n a ete ecrit').toBe(false);
  expect(spy, 'et le defaut est dit, pas avale').toHaveBeenCalledTimes(1);
});

test('acquitter ajoute une ligne, ne reecrit rien', () => {
  const filePath = tmp();
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T));
  j.appendAck('loop:s1:Bash', T, T + 5000);
  const l = lignes(filePath);
  expect(l.length).toBe(2);
  expect(JSON.parse(l[0]!).kind).toBe('alert');
  expect(JSON.parse(l[1]!).kind).toBe('ack');
  const rows = createJournal({ filePath, now: () => T }).readAll({ now: T }) as any[];
  expect(rows[0].acknowledged).toBe(true);
  expect(rows[0].ackAt).toBe(T + 5000);
});

test('l acquittement recalcule bat le champ fige du fichier', () => {
  const filePath = tmp();
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T));
  j.appendAck('loop:s1:Bash', T, T + 5000);
  expect(JSON.parse(lignes(filePath)[0]!).alert.acknowledged, 'la ligne du disque dit false pour toujours : elle n est jamais reecrite').toBe(false);
  const [row] = createJournal({ filePath, now: () => T }).readAll({ now: T }) as any[];
  expect(row.acknowledged, 'c est readAll qui fait autorite').toBe(true);
});

test('un acquittement au createdAt en chaine survit au redemarrage', () => {
  // Une route HTTP livre ses parametres en CHAINE : sans normalisation, la cle correspond en
  // memoire vive mais `ingest` refuse la ligne a la relecture, et l'alerte acquittee revient.
  // La panne ne se voit qu'apres un redemarrage : la verifier en memoire vive ne prouve rien.
  const filePath = tmp();
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T));
  j.appendAck('loop:s1:Bash', String(T), T + 5000);
  expect((j.readAll({ now: T }) as any[])[0].acknowledged, 'en memoire vive').toBe(true);
  expect(lignes(filePath).length, 'la ligne d ack est bien sur le disque').toBe(2);
  const relu = createJournal({ filePath, now: () => T });
  expect((relu.readAll({ now: T }) as any[])[0].acknowledged, 'et apres un redemarrage').toBe(true);
  expect((relu.readAll({ now: T }) as any[])[0].ackAt).toBe(T + 5000);
});

test('un acquittement sans cle est refuse, pas ecrit en silence', () => {
  // Meme garde qu'`append`, pour la meme raison : ce que le journal ecrit doit
  // etre ce qu'il saura relire.
  const filePath = tmp();
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
  // `?createdAt=%20` sur la route d'acquittement suffit a l'envoyer.
  j.appendAck('loop:s1:Bash', '   ', T + 5000);
  expect(lignes(filePath).length, 'aucune ligne que la relecture rejetterait').toBe(1);
  expect((j.readAll({ now: T }) as any[])[0].acknowledged, 'ni acquittement en memoire').toBe(false);
  expect(plaintes(spy, 'acquittement sans (id'), 'et chaque defaut est dit, pas avale').toBe(4);
});

test('le contrat des horodatages : millisecondes epoch, rien d autre', () => {
  // `createdAt` et `at` sont des millisecondes epoch — nombre ou chaine de
  // chiffres. Une date ISO 8601 ou un objet Date n'en sont PAS, et c'est
  // delibere : lire du texte de date obligerait a accepter les formats locaux,
  // dont l'interpretation depend du moteur. On prefere une perte visible a une
  // donnee fausse silencieuse.
  const filePath = tmp();
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const j = createJournal({ filePath, now: () => T + 9000 });
  j.append(alertAt(T));

  // Au contrat : le nombre et la chaine de chiffres nomment le meme fait.
  j.appendAck('loop:s1:Bash', T, T + 5000);
  expect((j.readAll({ now: T }) as any[])[0].ackAt).toBe(T + 5000);
  j.appendAck('loop:s1:Bash', String(T), String(T + 7000));
  expect((j.readAll({ now: T }) as any[])[0].ackAt, 'la chaine de chiffres vise la meme cle').toBe(T + 7000);

  // Hors contrat sur la cle : refus, parce que le serveur ne peut pas
  // l'inventer sans designer un autre fait.
  j.appendAck('loop:s1:Bash', new Date(T).toISOString(), T + 5000);
  j.appendAck('loop:s1:Bash', new Date(T), T + 5000);
  expect(plaintes(spy, 'acquittement sans (id')).toBe(2);
  expect(plaintes(spy, 'horodatage'), 'le refus de cle ne se deguise pas en repli').toBe(0);
});

test('la ligne dit quand c est l horloge du serveur qui a parle', () => {
  // `now()` est une observation juste, mais l'ecrire au meme endroit et sous
  // la meme forme que ce qu'un acquitteur aurait rapporte conflaterait deux
  // choses differentes. L'absence du champ vaut « fourni par l'appelant ».
  const filePath = tmp();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const j = createJournal({ filePath, now: () => T + 9000 });
  j.append(alertAt(T, 'loop:s1:Fourni'));
  j.append(alertAt(T, 'loop:s1:Repli'));

  j.appendAck('loop:s1:Fourni', T, T + 5000);
  // Une date REELLE, mais hors contrat : ce que le repli jette doit se voir.
  j.appendAck('loop:s1:Repli', T, new Date(T + 5000).toISOString());

  const acks = lignes(filePath).map(l => JSON.parse(l)).filter(r => r.kind === 'ack');
  const fourni = acks.find(r => r.id === 'loop:s1:Fourni');
  const repli = acks.find(r => r.id === 'loop:s1:Repli');
  expect(fourni.at).toBe(T + 5000);
  expect('atFrom' in fourni, 'rien a signaler : l appelant l a fourni').toBe(false);
  expect(repli.at, 'l horloge du serveur').toBe(T + 9000);
  expect(repli.atFrom, 'et la ligne dit que c est elle').toBe('server');

  // `readAll` l'ignore : c'est la trace sur le disque qui compte.
  const [row] = createJournal({ filePath, now: () => T }).readAll({ now: T }) as any[];
  expect('atFrom' in row).toBe(false);
});

test('un acquittement sans horodatage utilisable retombe sur l horloge du serveur', () => {
  // `at` ne dit pas QUELLE alerte est acquittee, seulement QUAND. Refuser perdrait un geste
  // reel : le panneau resterait allume, l'utilisateur recliquerait, une ligne de plus, sans
  // fin. Par la route HTTP d'acquittement, un parametre absent arrive `undefined`.
  const filePath = tmp();
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const j = createJournal({ filePath, now: () => T + 9000 });
  j.append(alertAt(T));
  j.appendAck('loop:s1:Bash', T, undefined);
  const [vif] = j.readAll({ now: T }) as any[];
  expect(vif.acknowledged, 'l acquittement de l utilisateur n est pas perdu').toBe(true);
  expect(vif.ackAt, 'l heure retenue est celle du serveur, pas une invention').toBe(T + 9000);
  const [relu] = createJournal({ filePath, now: () => T }).readAll({ now: T }) as any[];
  expect(relu.acknowledged, 'et il survit au redemarrage').toBe(true);
  expect(relu.ackAt).toBe(T + 9000);
  expect(plaintes(spy, 'horodatage'), 'l appelant casse ne reste pas invisible').toBe(1);

  // Une chaine qui n'est pas un horodatage suit le meme chemin.
  j.append(alertAt(T + 1000, 'loop:s1:Autre'));
  j.appendAck('loop:s1:Autre', T + 1000, 'demain');
  const autre = (j.readAll({ now: T + 1000 }) as any[]).find(a => a.id === 'loop:s1:Autre');
  expect(autre.ackAt).toBe(T + 9000);
  expect(plaintes(spy, 'horodatage')).toBe(2);
});

test('un acquittement horodate en chaine garde son heure', () => {
  // Meme frontiere HTTP que `createdAt`, meme normalisation : ce qui est relu
  // doit etre un nombre, pas la chaine qu'on a recue.
  const filePath = tmp();
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T));
  j.appendAck('loop:s1:Bash', String(T), String(T + 5000));
  const [relu] = createJournal({ filePath, now: () => T }).readAll({ now: T }) as any[];
  expect(relu.acknowledged).toBe(true);
  expect(relu.ackAt, 'un nombre, pas une chaine').toBe(T + 5000);
});

test('l acquittement vaut aussitot, sans attendre une relecture', () => {
  // Le serveur ne redemarre pas entre l'acquittement et le rafraichissement
  // du panneau : c'est la meme instance qui repond. Un test qui ne verifie
  // l'ack qu'apres relecture laisse passer un journal qui ne l'inscrit qu'au
  // fichier.
  const j = createJournal({ filePath: tmp(), now: () => T });
  j.append(alertAt(T));
  j.appendAck('loop:s1:Bash', T, T + 5000);
  const [row] = j.readAll({ now: T }) as any[];
  expect(row.acknowledged).toBe(true);
  expect(row.ackAt).toBe(T + 5000);
});

test('un acquittement ne vaut que pour le fait qu il nomme', () => {
  // L'ack porte (id, createdAt) : acquitter la panne d'hier ne doit pas
  // eteindre celle de ce matin, qui porte le meme id.
  const filePath = tmp();
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T));
  j.append(alertAt(T + 60_000));
  j.appendAck('loop:s1:Bash', T, T + 5000);
  const rows = createJournal({ filePath, now: () => T }).readAll({ now: T + 60_000 });
  expect(rows.map(r => [r.createdAt, r.acknowledged])).toEqual([[T + 60_000, false], [T, true]]);
});

test('la fenetre coupe sur l heure de l evenement, plus recent d abord', () => {
  const j = createJournal({ filePath: tmp(), now: () => T });
  // Ordre d'ecriture volontairement different de l'ordre attendu : sans le
  // tri, la reponse serait [Moyen, Recent].
  j.append(alertAt(T - 40 * DAY, 'loop:s1:Vieux'));
  j.append(alertAt(T - 10 * DAY, 'loop:s1:Moyen'));
  j.append(alertAt(T - 2 * DAY, 'loop:s1:Recent'));
  const ids = j.readAll({ sinceDays: 30, now: T }).map(a => a.id);
  expect(ids).toEqual(['loop:s1:Recent', 'loop:s1:Moyen']);
});

test('une alerte a l horloge en avance est gardee, et vient en tete', () => {
  // Horloge de machine decalee : `createdAt` vient de l'evenement, pas du
  // serveur. Une memoire ne jette pas un fait parce qu'il la surprend. Le
  // prix de ce choix est ecrit dans journal.ts : une horloge fausse d'un an
  // produit une alerte epinglee en tete a vie.
  const j = createJournal({ filePath: tmp(), now: () => T });
  j.append(alertAt(T - 3600_000, 'loop:s1:Passe'));
  j.append(alertAt(T + 3600_000, 'loop:s1:Futur'));
  const ids = j.readAll({ sinceDays: 30, now: T }).map(a => a.id);
  expect(ids).toEqual(['loop:s1:Futur', 'loop:s1:Passe']);
});

test('une ligne illisible est sautee, jamais fatale', () => {
  const filePath = tmp();
  fs.writeFileSync(filePath,
    JSON.stringify({ kind: 'alert', alert: alertAt(T) }) + '\n'
    + '{ceci n est pas du json\n'
    + JSON.stringify({ kind: 'alert', alert: alertAt(T + 1000, 'loop:s1:Autre') }) + '\n');
  const rows = createJournal({ filePath, now: () => T + 1000 }).readAll({ now: T + 1000 });
  expect(rows.length, 'un arret brutal ne doit pas empecher le demarrage').toBe(2);
  expect(lignes(filePath).length, 'une ligne illisible ne declenche pas a elle seule une reecriture').toBe(3);
});

// `null` est du JSON VALIDE : la primitive rend { ok:true, value:null }, et `rec.kind` levait
// dessus. Le chien de garde entier disparaissait alors, sous un « detection indisponible »
// qui accusait l'installation au lieu d'une ligne du journal.
test('une ligne valant null est sautee comme les autres, et n emporte pas le chien de garde', () => {
  // Arrange
  const filePath = tmp();
  fs.writeFileSync(filePath,
    JSON.stringify({ kind: 'alert', alert: alertAt(T) }) + '\n'
    + 'null\n'
    + JSON.stringify({ kind: 'alert', alert: alertAt(T + 1000, 'loop:s1:Apres') }) + '\n');

  // Act
  const rows = createJournal({ filePath, now: () => T + 1000 }).readAll({ now: T + 1000 });

  // Assert
  expect(rows.length, 'les alertes qui ENCADRENT la ligne null sont relues').toBe(2);
});

// Meme famille, meme fichier : ce qui n'est pas un objet n'est pas un
// enregistrement. `42` et `"texte"` ne levaient pas — ils passaient, avec un `ts`
// indefini, et finissaient comptes comme PERIMES. Une ligne de bruit devenait
// donc un motif de reecriture du fichier au lieu d'etre sautee. Le filet fige
// qu'elles sont traitees comme illisibles, au meme titre que `null`.
test('une ligne qui n est pas un enregistrement est sautee, pas comptee perimee', () => {
  // Arrange
  const filePath = tmp();
  fs.writeFileSync(filePath,
    JSON.stringify({ kind: 'alert', alert: alertAt(T) }) + '\n'
    + '42\n"texte"\ntrue\n[]\n'
    + JSON.stringify({ kind: 'alert', alert: alertAt(T + 1000, 'loop:s1:Apres') }) + '\n');

  // Act
  const rows = createJournal({ filePath, now: () => T + 1000 }).readAll({ now: T + 1000 });

  // Assert
  expect(rows.length, 'les deux alertes survivent au bruit').toBe(2);
  expect(lignes(filePath).length, 'du bruit ne declenche pas a lui seul une reecriture du fichier').toBe(6);
});

// Le decodage d'une ligne passe par la primitive commune du moteur, qui tolere le BOM
// (U+FEFF). Un `JSON.parse` local rejetterait la ligne, et la compaction suivante effacerait
// l'alerte du fichier : perdue pour de bon, sans un mot.
test('une alerte prefixee d un BOM est relue au lieu d etre perdue', () => {
  // Arrange
  const filePath = tmp();
  const BOM = String.fromCharCode(0xFEFF);
  fs.writeFileSync(filePath,
    JSON.stringify({ kind: 'alert', alert: alertAt(T) }) + '\n'
    + BOM + JSON.stringify({ kind: 'alert', alert: alertAt(T, 'loop:s1:AuBOM') }) + '\n');

  // Act
  const rows = createJournal({ filePath, now: () => T }).readAll({ now: T });

  // Assert
  expect(rows.map(a => a.id).sort(), 'le BOM ne doit plus couter une panne consignee').toEqual(['loop:s1:AuBOM', 'loop:s1:Bash']);
});

// `gardees` retient la ligne BRUTE : une ligne au BOM est RECOPIEE telle quelle, BOM compris,
// dans le fichier compacte. Ce test fige que le demarrage suivant la relit ; sans lui, la
// perte pourrait passer de la lecture a la compaction.
test('le BOM recopie par la compaction se relit au demarrage suivant', () => {
  // Arrange
  const filePath = tmp();
  const BOM = String.fromCharCode(0xFEFF);
  fs.writeFileSync(filePath,
    JSON.stringify({ kind: 'alert', alert: alertAt(T - 100 * DAY, 'loop:s1:Ancetre') }) + '\n'
    + BOM + JSON.stringify({ kind: 'alert', alert: alertAt(T - 10 * DAY, 'loop:s1:AuBOM') }) + '\n');
  createJournal({ filePath, now: () => T });   // l'ancetre a peri : le fichier est compacte

  // Act
  const relu = createJournal({ filePath, now: () => T });

  // Assert
  expect(relu.readAll({ sinceDays: 90, now: T }).map(a => a.id), 'la ligne au BOM survit au cycle complet chargement-compaction-rechargement').toEqual(['loop:s1:AuBOM']);
  expect(lignes(filePath).length, 'la compaction a bien eu lieu').toBe(1);
  expect(fs.readFileSync(filePath, 'utf8').includes(BOM), 'et elle a recopie la ligne brute, BOM compris').toBeTruthy();
});

test('un premier demarrage ne se plaint pas', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  createJournal({ filePath: tmp(), now: () => T });
  expect(spy, 'un fichier absent est un debut, pas un incident').toHaveBeenCalledTimes(0);
});

test('un journal illisible se plaint, il ne repart pas vide en silence', () => {
  // Le cas Windows : antivirus ou sauvegarde qui tient le fichier (EBUSY), droits perdus
  // (EACCES). Repartir avec `seen` vide ferait rendre `true` au rattrapage de demarrage sur
  // tout l'historique : tout rediffuse, un doublon par alerte dans le fichier.
  const filePath = tmp();
  fs.mkdirSync(filePath);                       // EISDIR a la lecture
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  createJournal({ filePath, now: () => T });
  expect(plaintes(spy, 'illisible')).toBe(1);
});

test('un disque qui refuse ne fait pas tomber le service', () => {
  // Un dossier la ou le fichier devrait etre : toute ecriture echouera.
  const filePath = tmp();
  fs.mkdirSync(filePath);
  // Implementation muette : les plaintes sont attendues, la sortie de la
  // suite n'a pas a les porter.
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const j = createJournal({ filePath, now: () => T });
  expect(() => j.append(alertAt(T))).not.toThrow();
  // Assez d'ecritures pour couvrir le delai de reprise et provoquer une
  // seconde tentative reelle : sans ca, « une seule plainte » ne prouverait
  // rien qu'une absence de tentative.
  for (let i = 0; i < 30; i++) expect(() => j.appendAck('loop:s1:Bash', T, T + i)).not.toThrow();
  // Le fait est en memoire : l'appelant doit pouvoir diffuser l'alerte meme
  // quand le disque l'a refusee. Perdre la memoire n'est pas perdre l'alerte.
  expect(j.readAll({ now: T }).length).toBe(1);
  expect(plaintes(spy, 'indisponible'), 'on le dit une fois par panne, pas par ecriture').toBe(1);
});

test('une ecriture refusee reste un fait inedit pour l appelant', () => {
  const filePath = tmp();
  fs.mkdirSync(filePath);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const j = createJournal({ filePath, now: () => T });
  expect(j.append(alertAt(T)), 'l alerte doit etre diffusee malgre le disque').toBe(true);
  expect(j.append(alertAt(T)), 'mais elle ne redevient pas inedite').toBe(false);
});

test('un disque qui redevient disponible est reessaye, et la panne suivante se dit', () => {
  // Un echec transitoire ne doit pas eteindre la memoire jusqu'au prochain
  // redemarrage : sinon plus aucun acquittement n'est ecrit, et toutes les
  // alertes que l'utilisateur avait acquittees reviennent au demarrage suivant.
  const filePath = tmp();
  fs.mkdirSync(filePath);
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T));
  expect(plaintes(spy, 'indisponible')).toBe(1);

  fs.rmdirSync(filePath);                       // le disque repond de nouveau
  for (let i = 0; i < 30; i++) j.appendAck('loop:s1:Bash', T, T + i);
  expect(fs.statSync(filePath).isFile(), 'le journal a repris tout seul').toBeTruthy();
  expect(plaintes(spy, 'indisponible'), 'la reprise ne re-annonce pas la panne').toBe(1);

  // Et le verrou n'a pas ete cimente : une NOUVELLE panne a droit a sa plainte.
  vi.spyOn(fs, 'appendFileSync').mockImplementation(() => { throw new Error('disque plein'); });
  j.appendAck('loop:s1:Bash', T, T + 999);
  expect(plaintes(spy, 'indisponible')).toBe(2);
});

test('au-dela de la retention, la ligne quitte la memoire et le fichier', () => {
  const filePath = tmp();
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T - 100 * DAY, 'loop:s1:Ancetre'));
  j.append(alertAt(T - 10 * DAY, 'loop:s1:Recent'));
  expect(lignes(filePath).length, 'les deux ont bien ete ecrites').toBe(2);

  const relu = createJournal({ filePath, now: () => T });
  expect(relu.readAll({ sinceDays: 90, now: T }).map(a => a.id)).toEqual(['loop:s1:Recent']);
  expect(relu.seenKeys().size, 'la cle perimee ne pese plus en memoire').toBe(1);
  expect(lignes(filePath).length, 'le fichier est compacte, pas seulement filtre a la lecture').toBe(1);
  expect(fs.readdirSync(path.dirname(filePath)), 'aucun fichier temporaire laisse derriere').toEqual(['alerts.jsonl']);
});

test('la compaction garde l acquittement du fait qu elle garde', () => {
  const filePath = tmp();
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T - 100 * DAY, 'loop:s1:Ancetre'));
  j.append(alertAt(T - 10 * DAY, 'loop:s1:Recent'));
  j.appendAck('loop:s1:Recent', T - 10 * DAY, T - 9 * DAY);
  j.appendAck('loop:s1:Ancetre', T - 100 * DAY, T - 99 * DAY);

  const relu = createJournal({ filePath, now: () => T });
  expect(relu.readAll({ sinceDays: 90, now: T }).map(a => [a.id, a.acknowledged])).toEqual([['loop:s1:Recent', true]]);
  expect(lignes(filePath).length, 'l alerte gardee et son ack, rien d autre').toBe(2);
});

test('sans peremption, le journal n est pas reecrit du tout', () => {
  // L'ajout seul reste la regle : on ne reecrit que pour la peremption, jamais
  // « au cas ou » a chaque demarrage.
  const filePath = tmp();
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T - 10 * DAY, 'loop:s1:A'));
  j.append(alertAt(T - 2 * DAY, 'loop:s1:B'));
  const avant = fs.readFileSync(filePath, 'utf8');
  const renommage = vi.spyOn(fs, 'renameSync');
  createJournal({ filePath, now: () => T });
  expect(renommage, 'aucune compaction quand rien n a peri').toHaveBeenCalledTimes(0);
  expect(fs.readFileSync(filePath, 'utf8')).toBe(avant);
});

test('une horloge qui saute ne vide pas le journal', () => {
  // Pile morte, machine virtuelle restauree depuis un instantane, saut NTP au
  // demarrage. `readAll` refuse deja de jeter une alerte datee du futur parce
  // que l'horloge peut mentir : `load` ne peut pas se fier a la meme horloge
  // pour reecrire le fichier de facon irreversible. Un seul demarrage suffirait
  // sinon a vider la seule chose que le produit ne sait pas reconstruire.
  const filePath = tmp();
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T - 2 * DAY, 'loop:s1:A'));
  j.append(alertAt(T - 1 * DAY, 'loop:s1:B'));
  j.appendAck('loop:s1:B', T - 1 * DAY, T);
  const avant = fs.readFileSync(filePath, 'utf8');

  const fou = createJournal({ filePath, now: () => T + 200 * DAY });
  expect(fs.readFileSync(filePath, 'utf8'), 'rien n a ete detruit').toBe(avant);
  expect(fou.readAll({ sinceDays: 90, now: T + 200 * DAY }).length, 'la memoire vive reste bornee, elle, meme quand le fichier ne bouge pas').toBe(0);

  // L'horloge revenue a la raison, tout est encore la — acquittement compris.
  const relu = createJournal({ filePath, now: () => T });
  expect(relu.readAll({ sinceDays: 90, now: T }).map(a => [a.id, a.acknowledged])).toEqual([['loop:s1:B', true], ['loop:s1:A', false]]);
});

test('une compaction qui echoue laisse le journal entier', () => {
  // Fichier temporaire puis renommage : si la reecriture casse, l'ancien
  // journal doit etre encore la. Une reecriture en place laisserait un fichier
  // tronque — pire que trop long.
  const filePath = tmp();
  const j = createJournal({ filePath, now: () => T });
  j.append(alertAt(T - 100 * DAY, 'loop:s1:Ancetre'));
  j.append(alertAt(T - 10 * DAY, 'loop:s1:Recent'));
  const avant = fs.readFileSync(filePath, 'utf8');

  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('renommage refuse'); });
  const relu = createJournal({ filePath, now: () => T });
  expect(fs.readFileSync(filePath, 'utf8'), 'le journal d origine est intact').toBe(avant);
  expect(fs.readdirSync(path.dirname(filePath)), 'le temporaire est nettoye').toEqual(['alerts.jsonl']);
  expect(relu.readAll({ sinceDays: 90, now: T }).length, 'la memoire vive est bornee meme quand le fichier ne l est pas').toBe(1);
  expect(plaintes(spy, 'compaction')).toBe(1);
});

test('keyOf distingue deux alertes que la concatenation naive confondrait', () => {
  // Sans separateur, ('a1', 2) et ('a', 12) donnent tous deux 'a12'.
  expect(keyOf('a1', 2)).not.toBe(keyOf('a', 12));
});

test('seenKeys rend une copie, pas la memoire du journal', () => {
  const j = createJournal({ filePath: tmp(), now: () => T });
  j.append(alertAt(T));
  const cles = j.seenKeys();
  expect(cles.size).toBe(1);
  expect(cles.has(keyOf('loop:s1:Bash', T))).toBeTruthy();
  cles.clear();
  expect(j.append(alertAt(T)), 'toucher la copie ne rouvre pas le fait').toBe(false);
});
