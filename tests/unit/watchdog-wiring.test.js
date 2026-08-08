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

// ── Le bac a sable, pose AVANT le premier require de `lib/**` ────────────────
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

const { createJournal, DEFAULT_PATH } = require('../../lib/server/watchdog/journal');
const { createWatchdogService } = require('../../lib/server/watchdog/service');
const { sseClients } = require('../../lib/server/sse');
const { DIR, sessionIndex } = require('../../lib/server/session-index');
const { readAndBroadcast } = require('../../lib/server/event-reader');

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
  const idx = require('../../lib/server/watchdog');
  assert.equal(idx.getWatchdogService(), null, 'precondition : l instance partagee n est pas encore initialisee');

  const recus = ecouterSSE();
  await readAndBroadcast(fichierDeSession('sans-garde', flotJusquAuDeclencheur()));
  recus.fermer();
  assert.equal(recus.filter(m => m.type === 'event').length, 7);
  assert.equal(recus.filter(m => m.type === 'alert').length, 0);
});

test('event-reader: ce que le chien de garde voit part sur le flux, apres l evenement', async () => {
  const idx = require('../../lib/server/watchdog');
  const journalPath = tmpFile();
  await idx.initWatchdog({ journalPath, now: HORLOGE });

  // Au moment ou l'alerte part sur le flux, sa ligne doit deja etre sur le
  // disque : la meme regle qu'au niveau du service, mesuree cette fois au bout
  // de toute la chaine.
  const surMessage = (m) => {
    if (m.type !== 'alert') return;
    assert.match(fs.readFileSync(journalPath, 'utf8'), new RegExp(m.alert.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  };
  const recus = ecouterSSE(surMessage);
  await readAndBroadcast(fichierDeSession('avec-garde', flotJusquAuDeclencheur()));
  recus.fermer();

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
  const idx = require('../../lib/server/watchdog');
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

// ─── Le demarrage ────────────────────────────────────────────────────────────

function neufIndex() {
  const p = require.resolve('../../lib/server/watchdog/index');
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

test('demarrage: l instance d abord, le rattrapage ensuite', async () => {
  const idx = neufIndex();
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), flot());
  const journalPath = tmpFile();

  // Sans l'attente sur l'instance, le rattrapage tomberait sur un service qui
  // n'existe pas encore et rendrait 0 — le passe ne serait jamais relu, et
  // rien ne le dirait.
  const { valeur, dits } = await enEcoutant(() => idx.demarrerChienDeGarde({
    dir, diffuser: () => {}, cadenceMs: 60_000,
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
  const battement = await idx.demarrerChienDeGarde({
    dir, diffuser: m => recus.push(m), cadenceMs: 60_000,
    init: { journalPath: tmpFile(), now: HORLOGE },
  });
  clearInterval(battement);
  // Les curseurs d'evenements sont poses a la FIN des fichiers, deliberement :
  // rouvrir le serveur ne doit pas rejouer l'activite passee sur le canevas.
  assert.deepEqual(recus, [], 'le rattrapage nourrit le chien de garde, il ne parle pas au canevas');
});

test('demarrage: la ligne rapporte le nombre relu et n en conclut rien', async () => {
  const idx = neufIndex();
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), flot());
  const { valeur, dits } = await enEcoutant(() => idx.demarrerChienDeGarde({
    dir, diffuser: () => {}, cadenceMs: 60_000,
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
  const battement = await idx.demarrerChienDeGarde({
    dir, diffuser: m => recus.push(m), cadenceMs: 5,
    init: { journalPath, now: () => T + 4 * 60_000 },
  });
  try {
    await jusqua(() => recus.length > 0, 'une alerte levee par le battement');
  } finally { clearInterval(battement); }
  assert.equal(recus[0].type, 'alert');
  assert.equal(recus[0].alert.type, 'stuck');
  assert.equal(lignes(journalPath), 1, 'et consignee avant d etre dite');
});

test('demarrage: le minuteur ne retient jamais le processus', async () => {
  const idx = neufIndex();
  const battement = await idx.demarrerChienDeGarde({
    dir: tmpDir(), diffuser: () => {}, cadenceMs: 60_000,
    init: { journalPath: tmpFile(), now: HORLOGE },
  });
  try {
    assert.equal(battement.hasRef(), false, 'sans unref, `agent-viz start` ne rendrait jamais la main');
  } finally { clearInterval(battement); }
});

test('demarrage: un rattrapage qui casse n empeche pas le serveur de demarrer', async () => {
  const idx = neufIndex();
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), flot());
  // `runCatchUp` propage l'exception du detecteur, deliberement : c'est a
  // l'appelant de decider. Ici on decide de demarrer sans le passe.
  const { valeur, dits } = await enEcoutant(() => idx.demarrerChienDeGarde({
    dir, diffuser: () => {}, cadenceMs: 60_000,
    init: { journalPath: tmpFile(), now: HORLOGE, loadModule: moduleCasse },
  }));
  try {
    assert.match(dits, /detecteur casse/, 'et l on dit pourquoi le passe manque');
    assert.ok(valeur, 'le battement est quand meme lance');
  } finally { clearInterval(valeur); }
});

test('demarrage: sans service, le battement ne tue pas le processus', async () => {
  const idx = neufIndex();
  const { valeur } = await enEcoutant(() => idx.demarrerChienDeGarde({
    dir: tmpDir(), diffuser: () => {}, cadenceMs: 5,
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
