'use strict';
// Ce que ce fichier protege : l'ORDRE. Une alerte annoncee sur le flux mais
// absente du journal serait exactement le defaut qu'on repare — une panne
// visible seulement pour qui regardait au bon moment.
//
// Et, autour de cet ordre, le cablage lui-meme : le lecteur d'evenements qui
// passe au chien de garde le meme flot qu'au canevas, et la sequence de
// demarrage — l'instance, puis le rattrapage de ce qui s'est passe serveur
// eteint, puis seulement le battement.

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── Le bac a sable, pose AVANT le premier require de `src/server/**` ─────────
// C'est la seule chose qui compte dans l'ordre de ce fichier. Charger
// `event-reader` charge `session-index`, qui cree `os.tmpdir()/agent-events`
// des sa lecture ; et un journal sans chemin explicite vit dans
// `os.homedir()/.agent-viz`. Les deux sont, sur cette machine, le vrai dossier
// d'evenements et la vraie memoire des pannes de l'utilisateur — celle ou
// l'instrument de mesure du projet depose ses sessions. Un test de la tache 6
// y a lu 747 evenements reels avant correction : le piege est actif, pas
// theorique. `os.tmpdir()` et `os.homedir()` relisent l'environnement a chaque
// appel, donc les detourner ici suffit, et le fichier de test tourne dans son
// propre processus (`node --test` en donne un par fichier).
const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-cablage-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;
process.env.USERPROFILE = BAC;
process.env.HOME = BAC;

const { createJournal, DEFAULT_PATH } = require('../../src/server/watchdog/journal');
const { createWatchdogService, WATCHDOG_MODULE } = require('../../src/server/watchdog/service');
const { sseClients } = require('../../src/server/sse');
const { DIR, sessionIndex } = require('../../src/server/session-index');
const {
  readAndBroadcast, resetFileOffset, liveHandoffOffset, unwatchSession,
} = require('../../src/server/event-reader');

// La redirection est verifiee, pas supposee : si elle ne prenait pas, tout ce
// fichier travaillerait sur les vraies donnees de l'utilisateur en silence.
test('bac a sable: ni le vrai dossier d evenements ni le vrai journal', () => {
  assert.ok(DIR.startsWith(BAC), `dossier d evenements hors du bac : ${DIR}`);
  assert.ok(DEFAULT_PATH.startsWith(BAC), `journal par defaut hors du bac : ${DEFAULT_PATH}`);
});

const T = 1_700_000_000_000;
const SID = 'sess-1';
const HORLOGE = () => T + 3_600_000;
const lignes = fp => fs.readFileSync(fp, 'utf8').split('\n').filter(l => l.trim()).length;
const echapper = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const aNettoyer = [BAC];
const neufDossier = (prefixe) => {
  const d = fs.mkdtempSync(path.join(BAC, prefixe));
  aNettoyer.push(d);
  return d;
};
const tmpFile = () => path.join(neufDossier('journal-'), 'alerts.jsonl');
const tmpDir = () => neufDossier('events-');

// Les auditeurs SSE sont retires entre les tests : un auditeur oublie
// continuerait a compter les messages du test suivant.
const auditeurs = [];
after(() => {
  for (const c of auditeurs) sseClients.delete(c);
  for (const d of aNettoyer) fs.rmSync(d, { recursive: true, force: true });
});

// Un client SSE de papier. `broadcastSSE` ecrit sur tout ce qui est dans
// `sseClients` — s'y inscrire est donc la facon d'ecouter le flux sans
// remplacer la fonction, que `event-reader` a deja capturee par
// destructuration au chargement.
function ecouterSSE(surMessage) {
  const recus = [];
  const client = {
    write(msg) {
      const m = JSON.parse(msg.slice('data: '.length));
      recus.push(m);
      if (surMessage) surMessage(m);
    },
  };
  sseClients.add(client);
  auditeurs.push(client);
  recus.fermer = () => sseClients.delete(client);
  return recus;
}

async function jusqua(predicat, quoi, msMax = 3000) {
  const fin = Date.now() + msMax;
  while (Date.now() < fin) {
    if (predicat()) return;
    await new Promise(r => setTimeout(r, 5));
  }
  assert.fail(`delai depasse en attendant : ${quoi}`);
}

// Plusieurs garanties du cablage ne se distinguent de leur absence QUE par ce
// qui est dit : un rattrapage casse qu'on rattrape ne rend rien de visible.
async function enEcoutant(fn) {
  const vraiErr = console.error;
  const vraiLog = console.log;
  const dits = [];
  console.error = (...a) => dits.push(a.map(String).join(' '));
  console.log = (...a) => dits.push(a.map(String).join(' '));
  try { return { valeur: await fn(), dits: dits.join('\n') }; }
  finally { console.error = vraiErr; console.log = vraiLog; }
}

const pre = (i, ts, sid = SID) => ({
  hook_event_name: 'PreToolUse', session_id: sid, tool_name: 'Bash',
  tool_use_id: `t${i}`, tool_input: { command: 'npm run build' }, cwd: 'f:\\p',
  _ts: new Date(ts).toISOString(),
});
const fail = (i, ts, sid = SID) => ({
  hook_event_name: 'PostToolUseFailure', session_id: sid, tool_name: 'Bash',
  tool_use_id: `t${i}`, cwd: 'f:\\p', _ts: new Date(ts).toISOString(),
});

// Dix lignes : cinq appels identiques qui echouent, de quoi declencher `loop`.
const flot = (sid = SID) => {
  const out = [];
  for (let i = 1; i <= 5; i++) {
    out.push(JSON.stringify(pre(i, T + i * 1000, sid)), JSON.stringify(fail(i, T + i * 1000 + 500, sid)));
  }
  return out.join('\n') + '\n';
};

// Sept lignes, et la SEPTIEME est celle qui declenche `loop` — le detecteur
// leve l'alerte sur le 4e appel identique, donc sur son `PreToolUse`, pas sur
// l'echec qui suit (mesure, pas suppose). Finir le fichier sur l'evenement
// declencheur est ce qui rend l'ordre observable : l'alerte doit etre le
// DERNIER message du flux, jamais l'avant-dernier.
const flotJusquAuDeclencheur = () => {
  const out = [];
  for (let i = 1; i <= 3; i++) {
    out.push(JSON.stringify(pre(i, T + i * 1000)), JSON.stringify(fail(i, T + i * 1000 + 500)));
  }
  out.push(JSON.stringify(pre(4, T + 4000)));
  return out.join('\n') + '\n';
};

// Un fichier de session pret a etre lu par `readAndBroadcast`, avec sa fiche
// deja posee dans l'index : `agentSource: 'copilot'` prend la branche « ce
// producteur ne rapporte pas de jetons » et evite au test de reveiller le
// lecteur de transcription, qui n'a rien a voir avec ce qu'on mesure ici.
function fichierDeSession(nom, contenu) {
  const fp = path.join(tmpDir(), `${nom}.jsonl`);
  fs.writeFileSync(fp, contenu);
  sessionIndex.set(nom, {
    id: nom, promptCache: null, promptWindow: 0,
    eventCount: 0, size: 0, mtime: Date.now(), agentSource: 'copilot',
  });
  return fp;
}

// Le vrai module de detection, mais qui leve sur un evenement porteur du
// marqueur `_boum`. C'est la seule facon d'eprouver le chemin d'echec sans
// priver de detecteur tous les autres tests, qui partagent la meme instance —
// celle qu `event-reader` a chargee et qu'aucun vidage de cache n'atteint.
const moduleQuiLeveSurMarqueur = async () => {
  const vrai = await import(WATCHDOG_MODULE);
  return {
    createWatchdog(opts) {
      const wd = vrai.createWatchdog(opts);
      return {
        ...wd,
        processEvent(evt) {
          if (evt && evt._boum) throw new Error('detecteur casse');
          return wd.processEvent(evt);
        },
      };
    },
  };
};

// ─── L'ordre, au niveau du service ────────────────────────────────────────────

test('cablage: ce qui est diffuse est deja consigne', async () => {
  const filePath = path.join(neufDossier('journal-'), 'alerts.jsonl');
  const journal = createJournal({ filePath });
  const service = await createWatchdogService({ journal, now: () => T + 60_000 });

  const broadcast = [];
  const feed = (evt) => { for (const a of service.onEvent(evt)) {
    // Au moment ou l'appelant diffuse, la ligne doit deja etre sur le disque.
    assert.match(fs.readFileSync(filePath, 'utf8'), new RegExp(a.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    broadcast.push(a);
  } };

  for (let i = 1; i <= 5; i++) {
    feed({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash',
      tool_use_id: `t${i}`, tool_input: { command: 'x' }, cwd: 'f:\\p',
      _ts: new Date(T + i * 1000).toISOString() });
    feed({ hook_event_name: 'PostToolUseFailure', session_id: 's', tool_name: 'Bash',
      tool_use_id: `t${i}`, cwd: 'f:\\p', _ts: new Date(T + i * 1000 + 500).toISOString() });
  }
  assert.equal(broadcast.length, 1);
});

// ─── Le lecteur d'evenements ─────────────────────────────────────────────────
// `event-reader` tient l'instance du module `watchdog` qu'il a chargee ; les
// tests du demarrage, plus bas, s'en fabriquent une neuve en vidant le cache de
// `require`. Ce test-ci doit donc passer AVANT que l'instance partagee soit
// initialisee — la precondition est verifiee plutot que supposee.

test('event-reader: sans chien de garde, le flux d evenements passe quand meme', async () => {
  const idx = require('../../src/server/watchdog');
  assert.equal(idx.getWatchdogService(), null, 'precondition : l instance partagee n est pas encore initialisee');

  const recus = ecouterSSE();
  const fp = fichierDeSession('sans-garde', flotJusquAuDeclencheur());
  await readAndBroadcast(fp);
  recus.fermer();
  assert.equal(recus.filter(m => m.type === 'event').length, 7);
  assert.equal(recus.filter(m => m.type === 'alert').length, 0);
  // Le curseur a avance, mais RIEN n a ete nourri : la frontiere doit rester le
  // curseur. La poser ici — a l octet ou cette lecture a commence — ouvrirait
  // au balayage un trou grand comme tout le demarrage, puisque c est exactement
  // ce que fait le vif tant que le service n existe pas.
  assert.equal(liveHandoffOffset(fp), fs.statSync(fp).size);
});

// C2, 2026-08-11 : le verdict sur une ligne vient desormais de la primitive
// commune du moteur, et le lecteur vif tolere donc le BOM comme tout le reste.
// La ligne eprouvee ici n'est PAS la premiere du fichier, et c'est tout
// l'interet : un BOM en tete a toujours survecu par accident, parce que le
// `text.trim()` du lecteur le nettoyait avant le decoupage. Au milieu, il
// n'avait rien pour le sauver — le `JSON.parse` local levait et le `catch {}`
// faisait disparaitre l'evenement sans un mot, invisible pour le canevas ET
// indetectable pour le chien de garde. C'est la perte silencieuse que C2 ferme.
test('event-reader: une ligne prefixee d un BOM en milieu de fichier atteint le canevas', async () => {
  // Arrange
  const recus = ecouterSSE();
  const contenu = [
    JSON.stringify(pre(1, T + 1000)),
    '\uFEFF' + JSON.stringify(pre(2, T + 2000)),
    JSON.stringify(pre(3, T + 3000)),
  ].join('\n') + '\n';
  const fp = fichierDeSession('bom-milieu', contenu);

  // Act
  await readAndBroadcast(fp);

  // Assert
  recus.fermer();
  assert.deepEqual(
    recus.filter(m => m.type === 'event').map(m => m.event.tool_use_id),
    ['t1', 't2', 't3'],
  );
});

// Le journal de l'instance partagee — celle qu `event-reader` tient. Il est
// pose ici parce que plusieurs tests d'`event-reader` doivent le relire.
const journalPartage = tmpFile();

test('event-reader: ce que le chien de garde voit part sur le flux, apres l evenement', async () => {
  const idx = require('../../src/server/watchdog');
  const journalPath = journalPartage;
  await idx.initWatchdog({ journalPath, now: HORLOGE, loadModule: moduleQuiLeveSurMarqueur });

  // Au moment ou l'alerte part sur le flux, sa ligne doit deja etre sur le
  // disque : la meme regle qu'au niveau du service, mesuree cette fois au bout
  // de toute la chaine.
  //
  // On OBSERVE dans la callback, on AFFIRME dehors. Assertion et observation
  // ne peuvent pas tenir au meme endroit ici : `sse.js` enveloppe chaque
  // ecriture client dans un `try { … } catch {}` pour se debarrasser des
  // clients morts, et il y avalerait donc aussi l'`AssertionError`. Un controle
  // pose dans la callback ne peut pas faire echouer ce test — il en aurait
  // l'air, ce qui est pire que son absence. Ce qui doit traverser la frontiere
  // du `try/catch` est une VALEUR, jugee une fois le flux referme.
  //
  // L'observation elle-meme ne doit pas pouvoir lever : un journal pas encore
  // cree fait un ENOENT, que le meme `try/catch` avalerait — l'observation
  // resterait nulle et l'echec se lirait « aucune alerte diffusee », ce qui
  // designerait le mauvais coupable. Fichier absent = journal vide, et c'est
  // la comparaison qui tranche.
  let journalAuMomentDeLaDiffusion = null;
  const surMessage = (m) => {
    if (m.type !== 'alert' || journalAuMomentDeLaDiffusion !== null) return;
    let contenu = '';
    try { contenu = fs.readFileSync(journalPath, 'utf8'); } catch { /* pas encore de journal */ }
    journalAuMomentDeLaDiffusion = { id: m.alert.id, contenu };
  };
  const recus = ecouterSSE(surMessage);
  await readAndBroadcast(fichierDeSession('avec-garde', flotJusquAuDeclencheur()));
  recus.fermer();

  assert.ok(journalAuMomentDeLaDiffusion, 'une alerte a bien ete diffusee');
  assert.match(
    journalAuMomentDeLaDiffusion.contenu,
    new RegExp(echapper(journalAuMomentDeLaDiffusion.id)),
    'la ligne du journal precede la diffusion',
  );

  const types = recus.map(m => m.type);
  assert.equal(types.filter(t => t === 'event').length, 7, 'le canevas recoit tout, comme avant');
  const alertes = recus.filter(m => m.type === 'alert');
  assert.equal(alertes.length, 1);
  assert.equal(alertes[0].alert.type, 'loop');
  // L'alerte est le DERNIER message : elle suit l'evenement qui l'a produite,
  // elle ne le precede pas.
  assert.equal(types.at(-1), 'alert');
  assert.equal(lignes(journalPath), 1);
});

test('event-reader: relire le meme fichier ne rediffuse pas l alerte', async () => {
  const idx = require('../../src/server/watchdog');
  assert.ok(idx.getWatchdogService(), 'precondition : le service est en place');

  const fp = fichierDeSession('rejeu', flotJusquAuDeclencheur());
  await readAndBroadcast(fp);
  // Une ligne de plus, donc de nouveaux octets a lire : le curseur avance et
  // le fichier repasse par le detecteur. Le fait, lui, est deja connu.
  const recus = ecouterSSE();
  fs.appendFileSync(fp, JSON.stringify(fail(4, T + 4500)) + '\n');
  await readAndBroadcast(fp);
  recus.fermer();
  assert.equal(recus.filter(m => m.type === 'event').length, 1);
  assert.equal(recus.filter(m => m.type === 'alert').length, 0, 'un fait deja consigne n est pas un fait nouveau');
});

test('cablage: le rattrapage s arrete la ou le chemin vif prend la main', async () => {
  const idx = require('../../src/server/watchdog');
  const SP = 'sess-partage';   // une session a part : les compteurs du detecteur
                               // sont par session, et les autres tests ont deja
                               // fait boucler `sess-1`.
  // UN appel deja sur le disque, DEUX de plus apres la prise en main : trois au
  // total, sous le seuil de `loop` (4 appels identiques en 60 s). Si les deux
  // chemins se recouvraient, le detecteur en compterait cinq — le journal
  // dedoublonne l'alerte, pas les compteurs qui la produisent — et le produit
  // annoncerait une boucle que l'utilisateur n'a jamais faite.
  const fp = fichierDeSession('partage', JSON.stringify(pre(1, T + 1000, SP)) + '\n');
  const priseEnMain = fs.statSync(fp).size;
  resetFileOffset(fp, priseEnMain);
  assert.equal(liveHandoffOffset(fp), priseEnMain, 'le lecteur d evenements expose sa frontiere');
  // Un fichier que personne ne suit : le balayage en est seul responsable.
  assert.equal(liveHandoffOffset(path.join(path.dirname(fp), 'jamais-suivi.jsonl')), null);
  // Et zero est une REPONSE, pas une absence de reponse : un watcher arme sur
  // un fichier vide possede tout ce qui y sera ecrit. Un test de veracite
  // (`get(fp) || null`) le retournerait en « lis tout » et rouvrirait le
  // recouvrement sur exactement les sessions qui viennent de naitre.
  const vide = path.join(path.dirname(fp), 'vide.jsonl');
  fs.writeFileSync(vide, '');
  resetFileOffset(vide, 0);
  assert.equal(liveHandoffOffset(vide), 0);
  fs.appendFileSync(fp, JSON.stringify(pre(2, T + 2000, SP)) + '\n'
                      + JSON.stringify(pre(3, T + 3000, SP)) + '\n');

  const recus = ecouterSSE();
  const { valeur } = await enEcoutant(() => idx.runCatchUp(path.dirname(fp), liveHandoffOffset));
  assert.equal(valeur, 1, 'le passe s arrete a l octet ou le vif commence');
  await readAndBroadcast(fp);   // le chemin vif livre exactement le reste
  recus.fermer();
  assert.equal(recus.filter(m => m.type === 'event').length, 2);
  assert.equal(recus.filter(m => m.type === 'alert').length, 0,
    'trois appels comptes trois fois, pas cinq');
});

test('cablage: la frontiere est l octet ou le vif a NOURRI, pas son curseur', async () => {
  const idx = require('../../src/server/watchdog');
  assert.ok(idx.getWatchdogService(), 'precondition : le service est en place');
  const SN = 'sess-nourri';
  // L1 : ecrite pendant que le serveur demarrait, AVANT que le service existe.
  const l1 = JSON.stringify(pre(1, T + 1000, SN)) + '\n';
  const fp = fichierDeSession('nourri', l1);
  // Le chemin vif a lu L1 et avance son curseur SANS nourrir personne : c est
  // ce que fait `readAndBroadcast` tant que `getWatchdogService()` rend null,
  // donc pendant tout `scanAndWatch()` puis `housekeep()`.
  resetFileOffset(fp, Buffer.byteLength(l1));
  // Puis le service arrive, et deux appels de plus sont livres a chaud — en
  // DEUX lectures vives, ce qui n'est pas un detail : la frontiere est celle de
  // la PREMIERE pature. Reecrite a chaque lecture, elle glisserait vers le haut
  // et le balayage repasserait tout ce qui a ete nourri avant la derniere.
  fs.appendFileSync(fp, JSON.stringify(pre(2, T + 2000, SN)) + '\n');
  await readAndBroadcast(fp);   // lecture A : nourrit L2
  fs.appendFileSync(fp, JSON.stringify(pre(3, T + 3000, SN)) + '\n');
  await readAndBroadcast(fp);   // lecture B : nourrit L3

  // La frontiere doit etre restee a L1 — la ou le vif a commence a NOURRIR —
  // et non au curseur, qui est passe au-dessus de L2 et L3, ni au debut de la
  // lecture B, qui est passe au-dessus de L2.
  assert.equal(liveHandoffOffset(fp), Buffer.byteLength(l1));

  const avant = lignes(journalPartage);
  const { valeur } = await enEcoutant(() => idx.runCatchUp(path.dirname(fp), liveHandoffOffset));
  assert.equal(valeur, 1, 'le balayage ne relit que ce qui precede la premiere pature');
  // Trois appels reels, comptes trois fois. Frontiere posee sur le curseur : le
  // detecteur en compte CINQ. Frontiere reecrite a chaque lecture : QUATRE. Les
  // deux franchissent le seuil de `loop` et produisent une alerte annoncant une
  // boucle que personne n a faite — une ligne DURABLE dans un journal en ajout
  // seul, que la tache 8 servira en HTTP.
  assert.equal(lignes(journalPartage), avant, 'trois appels comptes trois fois');
});

test('cablage: la frontiere s efface avec le watcher et avec la compaction', async () => {
  // DEUX fichiers, un par purge. Les eprouver sur le meme masquerait l une par
  // l autre : la premiere purge laisserait la frontiere deja absente, et la
  // seconde n aurait plus rien a effacer.
  const SN = 'sess-purge';
  const nourri = async (nom) => {
    const fp = fichierDeSession(nom, JSON.stringify(pre(1, T + 1000, SN)) + '\n');
    resetFileOffset(fp, 0);
    await readAndBroadcast(fp);
    assert.equal(liveHandoffOffset(fp), 0, 'le vif a nourri depuis le premier octet');
    return fp;
  };

  // Plus de watcher, plus de chemin vif : le balayage redevient seul maitre, et
  // garder la frontiere cloturerait une part du fichier que personne ne lit.
  const a = await nourri('purge-watcher');
  unwatchSession(a);
  assert.equal(liveHandoffOffset(a), null);

  // La compaction reecrit le fichier plus court : l ancien octet designe une
  // disposition qui n existe plus, et le garder cloturerait le balayage hors
  // d une partie du NOUVEAU fichier.
  const b = await nourri('purge-compaction');
  resetFileOffset(b, 42);
  assert.equal(liveHandoffOffset(b), 42, 'apres compaction, le curseur reprend la frontiere');
});

test('event-reader: un detecteur qui leve se dit une fois, et le canevas continue', async () => {
  const idx = require('../../src/server/watchdog');
  assert.ok(idx.getWatchdogService(), 'precondition : le service est en place');
  // Sans garde, l enveloppe `catch {}` de la boucle (elle est la pour
  // JSON.parse) avalerait l exception : le chien de garde cesserait de produire
  // des alertes POUR TOUJOURS et rien ne le dirait — le trou muet exact que le
  // solde 4 ferme dix lignes plus loin.
  const boum = { ...pre(9, T + 9000, 'sess-boum'), _boum: true };
  const contenu = JSON.stringify(boum) + '\n' + JSON.stringify(boum) + '\n';
  const recus = ecouterSSE();
  const { dits } = await enEcoutant(() => readAndBroadcast(fichierDeSession('boum', contenu)));
  recus.fermer();
  assert.equal(recus.filter(m => m.type === 'event').length, 2, 'le canevas est servi quand meme');
  const plaintes = dits.split('\n').filter(l => /detection failed/.test(l));
  assert.equal(plaintes.length, 1, 'dite une fois — pas zero, pas a chaque evenement');
  assert.match(plaintes[0], /detecteur casse/);
});

// ─── Le demarrage ────────────────────────────────────────────────────────────

function neufIndex() {
  const p = require.resolve('../../src/server/watchdog/index');
  delete require.cache[p];
  return require(p);
}

// Un faux module de detection qui casse a l'evenement : de quoi faire lever
// `runCatchUp`, qui propage deliberement.
const moduleCasse = async () => ({
  createWatchdog() {
    return {
      processEvent() { throw new Error('detecteur casse'); },
      tick() { return { newAlerts: [] }; },
      acknowledge() {},
      getActiveAlerts() { return []; },
    };
  },
});

// Et un qui casse au BATTEMENT : le rattrapage se passe bien, c'est le minuteur
// qui leve — la ou personne n'attrape.
const moduleQuiCasseAuBattement = async () => ({
  createWatchdog() {
    return {
      processEvent() { return { newAlerts: [] }; },
      tick() { throw new Error('battement casse'); },
      acknowledge() {},
      getActiveAlerts() { return []; },
    };
  },
});

test('demarrage: l instance d abord, le rattrapage ensuite', async () => {
  const idx = neufIndex();
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), flot());
  const journalPath = tmpFile();

  // Sans l'attente sur l'instance, le rattrapage tomberait sur un service qui
  // n'existe pas encore et rendrait 0 — le passe ne serait jamais relu, et
  // rien ne le dirait.
  const { valeur, dits } = await enEcoutant(() => idx.startWatchdog({
    dir, broadcastAlert: () => {}, liveFrom: () => null, cadenceMs: 60_000,
    init: { journalPath, now: HORLOGE },
  }));
  clearInterval(valeur);
  assert.match(dits, /rattrapage : 10 evenements relus/);
  assert.equal(lignes(journalPath), 1, 'la panne survenue serveur eteint est au journal');
});

test('demarrage: le rattrapage ne diffuse rien', async () => {
  const idx = neufIndex();
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), flot());
  const recus = [];
  const { valeur } = await enEcoutant(() => idx.startWatchdog({
    dir, broadcastAlert: a => recus.push(a), liveFrom: () => null, cadenceMs: 60_000,
    init: { journalPath: tmpFile(), now: HORLOGE },
  }));
  clearInterval(valeur);
  // Les curseurs d'evenements sont poses a la FIN des fichiers, deliberement :
  // rouvrir le serveur ne doit pas rejouer l'activite passee sur le canevas.
  assert.deepEqual(recus, [], 'le rattrapage nourrit le chien de garde, il ne parle pas au canevas');
});

test('demarrage: la ligne rapporte le nombre relu et n en conclut rien', async () => {
  const idx = neufIndex();
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), flot());
  const { valeur, dits } = await enEcoutant(() => idx.startWatchdog({
    dir, broadcastAlert: () => {}, liveFrom: () => null, cadenceMs: 60_000,
    init: { journalPath: tmpFile(), now: HORLOGE },
  }));
  clearInterval(valeur);
  assert.match(dits, /rattrapage : 10 evenements relus/);
  // `runCatchUp` rend 0 dans QUATRE situations : pas de service, pas de dossier
  // nomme, dossier absent, dossier vide. Aucune ne permet de conclure quoi que
  // ce soit sur les pannes.
  assert.doesNotMatch(dits, /aucune panne|pas de panne|rien a signaler/i);
});

test('demarrage: le battement bat, et ce qu il leve part sur le flux', async () => {
  const idx = neufIndex();
  const dir = tmpDir();
  // Un seul appel, jamais termine : l'outil est encore en vol. Quatre minutes
  // plus tard — dans la bande [silenceMs, abandonedMs] — `stuck` a quelque
  // chose a dire, mais seulement sur le chemin du battement.
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), JSON.stringify(pre(1, T)) + '\n');
  const journalPath = tmpFile();
  const recus = [];
  // L'anteriorite se mesure AU MOMENT de la diffusion, pas apres coup : un
  // controle final ne prouverait que la coexistence des deux, jamais l'ordre.
  const broadcastAlert = (alert) => {
    assert.match(fs.readFileSync(journalPath, 'utf8'), new RegExp(echapper(alert.id)),
      'consignee avant d etre dite');
    recus.push(alert);
  };
  const { valeur } = await enEcoutant(() => idx.startWatchdog({
    dir, broadcastAlert, liveFrom: () => null, cadenceMs: 5,
    init: { journalPath, now: () => T + 4 * 60_000 },
  }));
  try {
    await jusqua(() => recus.length > 0, 'une alerte levee par le battement');
  } finally { clearInterval(valeur); }
  assert.equal(recus[0].type, 'stuck', 'le battement rend une ALERTE, l enveloppe est l affaire du serveur');
  assert.equal(lignes(journalPath), 1);
});

test('demarrage: le minuteur ne retient jamais le processus', async () => {
  const idx = neufIndex();
  const { valeur } = await enEcoutant(() => idx.startWatchdog({
    dir: tmpDir(), broadcastAlert: () => {}, liveFrom: () => null, cadenceMs: 60_000,
    init: { journalPath: tmpFile(), now: HORLOGE },
  }));
  try {
    assert.equal(valeur.hasRef(), false, 'sans unref, `agent-viz start` ne rendrait jamais la main');
  } finally { clearInterval(valeur); }
});

test('demarrage: un rattrapage qui casse n empeche pas le serveur de demarrer', async () => {
  const idx = neufIndex();
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), flot());
  // `runCatchUp` propage l'exception du detecteur, deliberement : c'est a
  // l'appelant de decider. Ici on decide de demarrer sans le passe.
  const { valeur, dits } = await enEcoutant(() => idx.startWatchdog({
    dir, broadcastAlert: () => {}, liveFrom: () => null, cadenceMs: 60_000,
    init: { journalPath: tmpFile(), now: HORLOGE, loadModule: moduleCasse },
  }));
  try {
    assert.match(dits, /detecteur casse/, 'et l on dit pourquoi le passe manque');
    assert.ok(valeur, 'le battement est quand meme lance');
  } finally { clearInterval(valeur); }
});

test('demarrage: sans service, le battement ne tue pas le processus', async () => {
  const idx = neufIndex();
  const { valeur } = await enEcoutant(() => idx.startWatchdog({
    dir: tmpDir(), broadcastAlert: () => {}, liveFrom: () => null, cadenceMs: 5,
    // Module de detection introuvable : `initWatchdog` degrade et rend null.
    init: { journalPath: tmpFile(), now: HORLOGE, loadModule: async () => { throw new Error('introuvable'); } },
  }));
  try {
    // Une exception dans un rappel de minuteur n'est attrapee par personne :
    // elle tue le processus. Le chien de garde est un supplement.
    await new Promise(r => setTimeout(r, 60));
    assert.equal(idx.getWatchdogService(), null);
  } finally { clearInterval(valeur); }
});

test('demarrage: un battement qui leve ne tue pas le demon, et se dit une fois', async () => {
  const idx = neufIndex();
  const vraiErr = console.error;
  const vraiLog = console.log;
  const dits = [];
  console.error = (...a) => dits.push(a.map(String).join(' '));
  console.log = (...a) => dits.push(a.map(String).join(' '));
  let battement;
  try {
    // Le battement bat toutes les 5 ms ; sans garde, la premiere exception
    // partirait d'un rappel de minuteur — non attrapee, elle tue le demon, et
    // avec lui tout le produit. Avec garde, on le dit UNE fois : se plaindre a
    // chaque battement noierait la sortie sans rien apprendre de plus.
    battement = await idx.startWatchdog({
      dir: tmpDir(), broadcastAlert: () => {}, liveFrom: () => null, cadenceMs: 5,
      init: { journalPath: tmpFile(), now: HORLOGE, loadModule: moduleQuiCasseAuBattement },
    });
    await new Promise(r => setTimeout(r, 80));   // de quoi battre une dizaine de fois
  } finally {
    clearInterval(battement);
    console.error = vraiErr;
    console.log = vraiLog;
  }
  const plaintes = dits.filter(l => /battement en echec/.test(l));
  assert.equal(plaintes.length, 1, 'dite une fois — pas zero, pas a chaque battement');
  assert.match(plaintes[0], /battement casse/);
  assert.ok(idx.getWatchdogService(), 'et le service est toujours la, le processus aussi');
});

test('demarrage: ce que le serveur oublie de fournir se dit a voix haute', async () => {
  // `src/server/server.js` est le seul appelant de production, et le seul fichier
  // qu aucun test ne peut charger. Ce qu il oublie ici, rien d autre ne peut le
  // dire — et un `liveFrom` oublie ne casse rien de visible : il remet les deux
  // chemins a lire les memes octets, et le produit annonce des boucles qui n ont
  // pas eu lieu. Meme patron que `runCatchUp` devant un dossier absent.
  const sansFrontiere = await enEcoutant(() => neufIndex().startWatchdog({
    dir: tmpDir(), broadcastAlert: () => {}, cadenceMs: 60_000,
    init: { journalPath: tmpFile(), now: HORLOGE },
  }));
  clearInterval(sansFrontiere.valeur);
  assert.match(sansFrontiere.dits, /sans frontiere du chemin vif/);

  const sansCanal = await enEcoutant(() => neufIndex().startWatchdog({
    dir: tmpDir(), liveFrom: () => null, cadenceMs: 60_000,
    init: { journalPath: tmpFile(), now: HORLOGE },
  }));
  clearInterval(sansCanal.valeur);
  assert.match(sansCanal.dits, /sans canal de diffusion/);

  // Controle negatif : fournis tous les deux, le demarrage n a rien a redire.
  const complet = await enEcoutant(() => neufIndex().startWatchdog({
    dir: tmpDir(), liveFrom: () => null, broadcastAlert: () => {}, cadenceMs: 60_000,
    init: { journalPath: tmpFile(), now: HORLOGE },
  }));
  clearInterval(complet.valeur);
  assert.doesNotMatch(complet.dits, /sans frontiere|sans canal/);
});

// ─── Le dernier maillon : ce que `src/server/server.js` passe reellement ─────
//
// Ces deux tests lisent `src/server/server.js` comme du TEXTE, et c'est delibere. Ne
// pas les « ameliorer » en `require` : ce fichier est un point d'entree, le
// charger lie le port 3333 et tue le serveur agent-viz de la machine — sur
// celle-ci, l'instrument de mesure du projet. L'objection « aucun test ne peut
// charger server.js » est vraie du CHARGEMENT, pas de la lecture.
//
// Et il faut bien quelque chose ici, parce que le guet de type de
// `startWatchdog` ne couvre que l'OUBLI. Le REMPLACEMENT lui echappe :
// `broadcastAlert: broadcastSSE` est bien une fonction, elle passe la garde, et
// les alertes partiraient sur le flux sous la forme `{type:'stuck', …}` au lieu
// de `{type:'alert', alert}` — que le client de la tache 9 ignorerait en
// silence. C'est la moitie dangereuse : muette jusqu'a la tache 9.
//
// Le prix assume : reformater ces lignes fait rougir ces tests. C'est le but.
const SOURCE_SERVEUR = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'server', 'server.js'), 'utf8');

// L'appel, et RIEN que l'appel. Un `[\s\S]*?` parti de `startWatchdog({`
// balaierait jusqu'a la fin du fichier : n'importe quel `dir: DIR` ecrit PLUS
// BAS satisferait l'assertion pendant que l'appel, lui, passerait un faux
// dossier. Injoignable tant que le fichier s'arrete juste apres l'appel —
// c'est-a-dire jusqu'a ce que la tache 8 y ajoute une ligne.
//
// La borne est un COMPTAGE D'ACCOLADES, et il faut dire ce qu'elle n'est pas :
// elle ignore les chaines et les commentaires. Une accolade non appariee
// ECRITE DANS l'appel — un `// TODO: passer { dir depuis la config` — ferait
// deborder la tranche et rouvrirait exactement le faux vert qu'elle ferme ; un
// `}` dans une chaine la tronquerait et ferait rougir du code sain. Il n'y a
// rien de tel dans `src/server/server.js` aujourd'hui, donc elle tient. Ecrire un vrai
// analyseur pour garder trois lignes serait disproportionne : c'est un
// compromis, pas une garantie, et le voila dit.
//
// Rend null plutot que de lever : voir `appelSurveille`.
function decouperAppel(source, nom) {
  const debut = source.indexOf(`${nom}({`);
  if (debut === -1) return null;
  let profondeur = 0;
  for (let i = source.indexOf('{', debut); i < source.length; i++) {
    if (source[i] === '{') profondeur += 1;
    else if (source[i] === '}' && (profondeur -= 1) === 0) return source.slice(debut, i + 1);
  }
  return null;
}

// Calcule DANS le test, jamais au chargement du module. Au chargement, un
// simple reformatage de `src/server/server.js` — `startWatchdog(\n  {` — ferait
// exploser les vingt et un tests de ce fichier au lieu des deux que ce contrat
// concerne, et aucun message ne dirait pourquoi. Un garde-fou qui brule le
// fichier entier sur son propre faux positif est un mauvais garde-fou.
function appelSurveille() {
  const appel = decouperAppel(SOURCE_SERVEUR, 'startWatchdog');
  assert.ok(appel, 'appel `startWatchdog({` introuvable dans src/server/server.js — reformatage ?');
  return appel;
}

test('serveur: le chien de garde recoit le vrai dossier et la vraie frontiere', () => {
  const appel = appelSurveille();
  // `DIR` : la seule definition faisant autorite du dossier d evenements.
  assert.match(appel, /\bdir:\s*DIR\b/);
  // `liveFrom` : sans lui, les deux chemins relisent les memes octets et le
  // produit annonce des boucles qui n ont pas eu lieu. `startWatchdog` s en
  // plaint au demarrage, mais mieux vaut que la suite le dise d abord.
  assert.match(appel, /\bliveFrom:\s*liveHandoffOffset\b/);
});

test('serveur: l enveloppe SSE est composee ici, et le canal n est pas broadcastSSE nu', () => {
  // Le renvoi arriere `\1` est la charge utile de ce controle, pas un ornement :
  // il exige que la valeur mise dans le champ `alert` soit LE PARAMETRE de la
  // lambda. Sans lui, `a => broadcastSSE({ type: 'alert', alert })` passe —
  // `alert` n y est lie a rien, chaque alerte leve un ReferenceError, et les
  // `try/catch` de `feedWatchdog` et du battement l avalent.
  //
  // Et le raccourci se verifie DANS LES DEUX SENS, d ou le `(?<=\1)` : le
  // raccourci `{ …, alert }` n est licite que si le parametre s appelle
  // `alert`. Sans cette moitie, `a => broadcastSSE({ type: 'alert', a })`
  // passait aussi — le renvoi arriere etait satisfait, mais l enveloppe emise
  // etait `{type:'alert', a:{…}}` et le client de la tache 9 y lirait
  // `msg.alert === undefined`. La meme classe muette, prise par l autre bout.
  assert.match(
    appelSurveille(),
    /broadcastAlert:\s*(\w+)\s*=>\s*broadcastSSE\(\{\s*type:\s*'alert',\s*(?:alert(?<=\1)|alert:\s*\1)\s*\}\)/,
    'le chien de garde rend une alerte nue ; c est ICI que le protocole du serveur l habille',
  );
});

test('index: initWatchdog(null) ne fabrique pas une promesse rejetee', async () => {
  const idx = neufIndex();
  // La destructuration des parametres est HORS du `try` de `fabriquer` : un
  // `null` litteral y produit un TypeError, donc une promesse rejetee
  // memorisee — exactement le rejet non attrape que la tache 6 avait ferme
  // pour le module de detection absent.
  const service = await idx.initWatchdog(null);
  assert.ok(service, 'un appelant qui passe null merite un service, pas un plantage');
  assert.equal(idx.getWatchdogService(), service);
});
