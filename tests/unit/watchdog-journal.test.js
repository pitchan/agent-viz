'use strict';
// Le journal est la seule chose qui distingue une alarme d'un enregistreur de
// vol. Ce fichier fige les proprietes qui font qu'on peut lui faire
// confiance : il n'ecrit jamais deux fois le meme fait, il ne reecrit jamais
// une ligne deja ecrite, il rend l'alerte telle qu'elle est venue, et il ne
// fait pas tomber le serveur quand le disque refuse.
//
// Aucun test ne touche le vrai `~` : tous passent un `filePath` sous
// os.tmpdir(). La machine porte un instrument de mesure, pas un bac a sable.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createJournal, keyOf } = require('../../lib/server/watchdog/journal');

const T = 1_700_000_000_000;
const DAY = 86_400_000;
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-journal-')), 'alerts.jsonl');
const alertAt = (createdAt, id = 'loop:s1:Bash') => ({
  id, type: 'loop', sessionId: 's1', toolName: 'Bash', cwd: 'f:\\p',
  createdAt, message: 'x', standing: false,
  occurrences: [{ ts: createdAt, toolUseId: 't1', failed: true }], tools: [],
});

test('une alerte ecrite se relit', () => {
  const filePath = tmp();
  const j = createJournal({ filePath });
  assert.equal(j.append(alertAt(T)), true);
  const rows = createJournal({ filePath }).readAll({ now: T });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].createdAt, T);
  assert.equal(rows[0].acknowledged, false);
  assert.equal(rows[0].ackAt, null);
});

test('l alerte est relue telle qu elle est venue, champ pour champ', () => {
  // Le journal ne connait ni detecteur ni forme d'alerte au-dela de (id,
  // createdAt) : ce que les tachess suivantes liront doit etre l'original, pas
  // une projection appauvrie.
  const filePath = tmp();
  const original = alertAt(T);
  createJournal({ filePath }).append(original);
  const [row] = createJournal({ filePath }).readAll({ now: T });
  const { acknowledged, ackAt, ...restitue } = row;
  assert.deepEqual(restitue, original);
});

test('rejouer le meme fait n ecrit rien de plus', () => {
  const filePath = tmp();
  const j = createJournal({ filePath });
  j.append(alertAt(T));
  assert.equal(j.append(alertAt(T)), false, 'meme (id, createdAt) = meme fait');
  // Et au redemarrage, la cle est relue depuis le fichier, pas perdue.
  const j2 = createJournal({ filePath });
  assert.equal(j2.append(alertAt(T)), false);
  assert.equal(fs.readFileSync(filePath, 'utf8').trim().split('\n').length, 1);
});

test('la meme alerte a un autre moment est un autre fait', () => {
  const j = createJournal({ filePath: tmp() });
  j.append(alertAt(T));
  assert.equal(j.append(alertAt(T + 60_000)), true);
});

test('deux alertes distinctes au meme instant sont deux faits', () => {
  // Cas reel : `stuck` et `loop` concluent sur le meme battement d'horloge.
  // Une cle qui oublierait l'id en avalerait une des deux.
  const filePath = tmp();
  const j = createJournal({ filePath });
  assert.equal(j.append(alertAt(T, 'loop:s1:Bash')), true);
  assert.equal(j.append(alertAt(T, 'stuck:s1')), true);
  assert.equal(createJournal({ filePath }).readAll({ now: T }).length, 2);
});

test('acquitter ajoute une ligne, ne reecrit rien', () => {
  const filePath = tmp();
  const j = createJournal({ filePath });
  j.append(alertAt(T));
  j.appendAck('loop:s1:Bash', T, T + 5000);
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).kind, 'alert');
  assert.equal(JSON.parse(lines[1]).kind, 'ack');
  const rows = createJournal({ filePath }).readAll({ now: T });
  assert.equal(rows[0].acknowledged, true);
  assert.equal(rows[0].ackAt, T + 5000);
});

test('l acquittement vaut aussitot, sans attendre une relecture', () => {
  // Le serveur ne redemarre pas entre l'acquittement et le rafraichissement
  // du panneau : c'est la meme instance qui repond. Un test qui ne verifie
  // l'ack qu'apres relecture laisse passer un journal qui ne l'inscrit qu'au
  // fichier.
  const j = createJournal({ filePath: tmp() });
  j.append(alertAt(T));
  j.appendAck('loop:s1:Bash', T, T + 5000);
  const [row] = j.readAll({ now: T });
  assert.equal(row.acknowledged, true);
  assert.equal(row.ackAt, T + 5000);
});

test('un acquittement ne vaut que pour le fait qu il nomme', () => {
  // L'ack porte (id, createdAt) : acquitter la panne d'hier ne doit pas
  // eteindre celle de ce matin, qui porte le meme id.
  const filePath = tmp();
  const j = createJournal({ filePath });
  j.append(alertAt(T));
  j.append(alertAt(T + 60_000));
  j.appendAck('loop:s1:Bash', T, T + 5000);
  const rows = createJournal({ filePath }).readAll({ now: T + 60_000 });
  assert.deepEqual(rows.map(r => [r.createdAt, r.acknowledged]),
    [[T + 60_000, false], [T, true]]);
});

test('la fenetre coupe sur l heure de l evenement, plus recent d abord', () => {
  const j = createJournal({ filePath: tmp() });
  // Ordre d'ecriture volontairement different de l'ordre attendu : sans le
  // tri, la reponse serait [Moyen, Recent].
  j.append(alertAt(T - 40 * DAY, 'loop:s1:Vieux'));
  j.append(alertAt(T - 10 * DAY, 'loop:s1:Moyen'));
  j.append(alertAt(T - 2 * DAY, 'loop:s1:Recent'));
  const ids = j.readAll({ sinceDays: 30, now: T }).map(a => a.id);
  assert.deepEqual(ids, ['loop:s1:Recent', 'loop:s1:Moyen']);
});

test('une alerte a l horloge en avance est gardee, et vient en tete', () => {
  // Horloge de machine decalee : `createdAt` vient de l'evenement, pas du
  // serveur. Une memoire ne jette pas un fait parce qu'il la surprend.
  const j = createJournal({ filePath: tmp() });
  j.append(alertAt(T - 3600_000, 'loop:s1:Passe'));
  j.append(alertAt(T + 3600_000, 'loop:s1:Futur'));
  const ids = j.readAll({ sinceDays: 30, now: T }).map(a => a.id);
  assert.deepEqual(ids, ['loop:s1:Futur', 'loop:s1:Passe']);
});

test('une ligne illisible est sautee, jamais fatale', () => {
  const filePath = tmp();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath,
    JSON.stringify({ kind: 'alert', alert: alertAt(T) }) + '\n'
    + '{ceci n est pas du json\n'
    + JSON.stringify({ kind: 'alert', alert: alertAt(T + 1000, 'loop:s1:Autre') }) + '\n');
  const rows = createJournal({ filePath }).readAll({ now: T + 1000 });
  assert.equal(rows.length, 2, 'un arret brutal ne doit pas empecher le demarrage');
});

test('un disque qui refuse ne fait pas tomber le service', (t) => {
  // Un dossier la ou le fichier devrait etre : toute ecriture echouera.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-journal-ro-'));
  const filePath = path.join(dir, 'alerts.jsonl');
  fs.mkdirSync(filePath);
  // Implementation muette : la plainte est attendue, la sortie de la suite
  // n'a pas a la porter.
  const plainte = t.mock.method(console, 'error', () => {});
  const j = createJournal({ filePath });
  assert.doesNotThrow(() => j.append(alertAt(T)));
  assert.doesNotThrow(() => j.appendAck('loop:s1:Bash', T, T));
  // Le fait est en memoire : l'appelant doit pouvoir diffuser l'alerte meme
  // quand le disque l'a refusee. Perdre la memoire n'est pas perdre l'alerte.
  assert.equal(j.readAll({ now: T }).length, 1);
  // ... et on se plaint une fois, pas a chaque ecriture.
  assert.equal(plainte.mock.callCount(), 1);
});

test('une ecriture refusee reste un fait inedit pour l appelant', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-journal-ro2-'));
  const filePath = path.join(dir, 'alerts.jsonl');
  fs.mkdirSync(filePath);
  t.mock.method(console, 'error', () => {});
  const j = createJournal({ filePath });
  assert.equal(j.append(alertAt(T)), true, 'l alerte doit etre diffusee malgre le disque');
  assert.equal(j.append(alertAt(T)), false, 'mais elle ne redevient pas inedite');
});

test('keyOf distingue deux alertes que la concatenation naive confondrait', () => {
  // Sans separateur, ('a1', 2) et ('a', 12) donnent tous deux 'a12'.
  assert.notEqual(keyOf('a1', 2), keyOf('a', 12));
});

test('seenKeys rend une copie, pas la memoire du journal', () => {
  const filePath = tmp();
  const j = createJournal({ filePath });
  j.append(alertAt(T));
  const cles = j.seenKeys();
  assert.equal(cles.size, 1);
  assert.ok(cles.has(keyOf('loop:s1:Bash', T)));
  cles.clear();
  assert.equal(j.append(alertAt(T)), false, 'toucher la copie ne rouvre pas le fait');
});
