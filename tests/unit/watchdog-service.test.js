'use strict';
// Le service est la jonction entre un module de detection pur (ESM, ecrit
// pour le navigateur) et un serveur CommonJS. Ce fichier fige ce qui doit
// rester vrai de cette jonction : ce qui est diffuse a deja ete consigne, un
// rattrapage n'ecrit rien deux fois, et pendant un rattrapage `stuck` se tait.
//
// Une note sur les horloges, parce qu'elle a coute un faux vert. Le detecteur
// et le journal ont chacun la leur, et elles doivent etre la MEME : le journal
// perime a la relecture ce qui est vieux pour son horloge a lui, si bien qu'un
// journal reste sur l'heure reelle pendant que le detecteur rejoue 2023
// repartirait avec une memoire vide — et reconsignerait tout. Le doublon ne se
// voit PAS depuis `list()`, qui lit la memoire vive : il ne se voit que dans le
// fichier. C'est pour ca que l'idempotence est mesuree ici sur le fichier.

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createJournal } = require('../../lib/server/watchdog/journal');
const { createWatchdogService } = require('../../lib/server/watchdog/service');
const { catchUpFromDisk } = require('../../lib/server/watchdog/catch-up');

const T = 1_700_000_000_000;
const SID = 'sess-1';
const HORLOGE = () => T + 3_600_000;
const lignes = fp => fs.readFileSync(fp, 'utf8').split('\n').filter(l => l.trim()).length;

// Les dossiers temporaires sont ramasses a la fin : cette machine porte
// l'instrument de mesure du projet, une quinzaine de dossiers abandonnes par
// execution finissent par se voir.
const aNettoyer = [];
const neufDossier = (prefixe) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefixe));
  aNettoyer.push(d);
  return d;
};
const tmpFile = () => path.join(neufDossier('avtest-svc-'), 'alerts.jsonl');
const tmpDir = () => neufDossier('avtest-events-');
after(() => { for (const d of aNettoyer) fs.rmSync(d, { recursive: true, force: true }); });

// Plusieurs des garanties de ce module ne se distinguent de leur absence QUE
// par la plainte : un balayage sans dossier rend 0 comme un dossier vide, un
// acquittement refuse ne rend rien de visible. Sans lire la plainte, le test
// ne pourrait pas voir la difference — et ne pourrait donc pas echouer.
async function enEcoutant(fn) {
  const vrai = console.error;
  const dits = [];
  console.error = (...a) => dits.push(a.map(String).join(' '));
  try { return { valeur: await fn(), dits }; } finally { console.error = vrai; }
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

// L'horloge est passee au journal AUSSI. Voir l'en-tete : c'est la condition
// pour que la relecture du fichier voie ce que le detecteur vient d'y ecrire.
async function svc(filePath, opts = {}) {
  const now = opts.now || HORLOGE;
  return createWatchdogService({
    journal: createJournal({ filePath, now }), now, ...opts,
  });
}

test('service: une boucle d echecs est consignee et rendue une fois', async () => {
  const filePath = tmpFile();
  const s = await svc(filePath);
  const raised = [];
  for (let i = 1; i <= 5; i++) {
    raised.push(...s.onEvent(pre(i, T + i * 1000)));
    raised.push(...s.onEvent(fail(i, T + i * 1000 + 500)));
  }
  assert.deepEqual(raised.map(a => a.type), ['loop']);
  assert.equal(s.list({ sinceDays: 90 }).length, 1);
  // Consigne AVANT d'etre rendue : ce que l'appelant s'appretera a diffuser
  // est deja sur le disque, pas seulement en memoire vive.
  assert.equal(lignes(filePath), 1);
});

test('service: rejouer le meme flot n ajoute rien', async () => {
  const filePath = tmpFile();
  const s1 = await svc(filePath);
  for (let i = 1; i <= 5; i++) { s1.onEvent(pre(i, T + i * 1000)); s1.onEvent(fail(i, T + i * 1000 + 500)); }
  const s2 = await svc(filePath);   // redemarrage : le journal est relu
  const raised = [];
  for (let i = 1; i <= 5; i++) {
    raised.push(...s2.onEvent(pre(i, T + i * 1000)));
    raised.push(...s2.onEvent(fail(i, T + i * 1000 + 500)));
  }
  assert.deepEqual(raised, [], 'un fait deja consigne n est pas un fait nouveau');
  assert.equal(s2.list({ sinceDays: 90 }).length, 1);
  assert.equal(lignes(filePath), 1, 'et rien de plus n a ete ecrit');
});

test('service: pendant un rattrapage, stuck se tait - et reparle apres', async () => {
  let catching = true;
  const filePath = tmpFile();
  // 4 minutes apres l evenement : dans la bande [silenceMs, abandonnedMs], donc
  // le detecteur A quelque chose a dire. C est ce qui fait du second appel un
  // vrai controle positif, et pas une absence qui s explique toute seule.
  const s = await svc(filePath, { now: () => T + 4 * 60_000, isCatchingUp: () => catching });
  s.onEvent(pre(1, T));                       // outil encore en vol
  assert.deepEqual(s.tick(), [], 'l horloge murale n est pas l heure des evenements relus');
  catching = false;
  assert.equal(s.tick().length, 1, 'controle positif : le rattrapage fini, il parle');
  // Le battement consigne comme l evenement : une alerte qui n existe que sur
  // le chemin de l horloge doit se retrouver au journal comme les autres.
  assert.equal(lignes(filePath), 1);
});

test('service: acquitter rend la parole au detecteur, pas seulement au journal', async () => {
  const filePath = tmpFile();
  let maintenant = T + 4 * 60_000;
  const s = await svc(filePath, { now: () => maintenant });
  s.onEvent(pre(1, T));                       // outil encore en vol
  const [a] = s.tick();
  assert.equal(a.type, 'stuck');
  maintenant = T + 5 * 60_000;
  assert.deepEqual(s.tick(), [], 'non acquittee, la meme condition ne se redit pas');
  s.ack(a.id, a.createdAt);
  maintenant = T + 6 * 60_000;
  // `stuck` ne declare pas de fin d episode : l acquittement est la SEULE
  // chose qui lui rende la parole. Si `ack` n allait qu au journal, cette
  // alerte-la ne pourrait plus jamais se redire de toute la session.
  assert.equal(s.tick().length, 1, 'acquittee, la condition qui dure peut se redire');
  assert.equal(lignes(filePath), 3, 'alerte, acquittement, alerte');
});

test('service: un acquittement que le journal refuse n eteint pas l alerte', async () => {
  const filePath = tmpFile();
  let maintenant = T + 4 * 60_000;
  const s = await svc(filePath, { now: () => maintenant });
  s.onEvent(pre(1, T));                       // outil encore en vol
  const [a] = s.tick();
  // Une cle hors contrat — exactement ce qu'un parametre de route sait
  // produire. Le journal la refuse, donc l acquittement n a PAS eu lieu.
  const { dits } = await enEcoutant(() => s.ack(a.id, 'pas une date'));
  assert.match(dits.join('\n'), /acquittement sans \(id, createdAt\)/);
  maintenant = T + 6 * 60_000;
  // Le controle positif est le test precedent : avec une cle valide, elle
  // reparle. Ici elle doit rester eteinte, sinon l utilisateur aurait vu son
  // geste pris en compte et l alerte reviendrait NON acquittee au redemarrage.
  assert.deepEqual(s.tick(), [], 'rien n a ete consigne, donc rien n a ete acquitte');
  assert.equal(lignes(filePath), 1, 'seule l alerte est au journal');
});

test('service: acquitter ecrit une ligne et le relit', async () => {
  const filePath = tmpFile();
  const s = await svc(filePath);
  for (let i = 1; i <= 5; i++) { s.onEvent(pre(i, T + i * 1000)); s.onEvent(fail(i, T + i * 1000 + 500)); }
  const [a] = s.list({ sinceDays: 90 });
  s.ack(a.id, a.createdAt);
  assert.equal((await svc(filePath)).list({ sinceDays: 90 })[0].acknowledged, true);
});

test('service: list se mesure sur l horloge du service, pas sur celle du journal', async () => {
  // Un journal construit avec l'horloge reelle — ce que fait tout appelant qui
  // fournit son propre journal — pendant que le service rejoue une vieille
  // session. La fenetre demandee doit se compter depuis l'heure du service.
  const filePath = tmpFile();
  const s = await createWatchdogService({
    journal: createJournal({ filePath }), now: HORLOGE,
  });
  for (let i = 1; i <= 5; i++) { s.onEvent(pre(i, T + i * 1000)); s.onEvent(fail(i, T + i * 1000 + 500)); }
  assert.equal(s.list({ sinceDays: 90 }).length, 1);
  // Et l'horloge du service gagne aussi sur celle qu'un appelant croirait
  // pouvoir imposer : c'est le service qui dit quelle heure il est.
  assert.equal(s.list({ sinceDays: 90, now: T + 400 * 86_400_000 }).length, 1);
});

test('catch-up: relit les fichiers en entier, deux fois sans doublon', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), flot());
  fs.writeFileSync(path.join(dir, '_hook-errors.log'), 'bruit\n');
  // Des evenements PARFAITEMENT valides sous une extension qui n'est pas la
  // notre : si le filtre d'extension tombe, ils entrent et se comptent.
  fs.writeFileSync(path.join(dir, 'bruit.log'), flot('sess-2'));

  const filePath = tmpFile();
  const s1 = await svc(filePath);
  assert.equal(await catchUpFromDisk(s1, dir), 10);
  assert.equal(s1.list({ sinceDays: 90 }).length, 1);
  assert.equal(lignes(filePath), 1);

  const s2 = await svc(filePath);
  // Le nombre rendu mesure le BALAYAGE, pas la nouveaute : le second passage
  // relit exactement autant, et ne consigne rien.
  assert.equal(await catchUpFromDisk(s2, dir), 10, 'le balayage relit tout, encore');
  assert.equal(s2.list({ sinceDays: 90 }).length, 1);
  assert.equal(lignes(filePath), 1, 'le rattrapage est idempotent — mesure sur le FICHIER');
});

test('catch-up: un fichier prefixe par _ n est pas un flux d evenements', async () => {
  const dir = tmpDir();
  // Meme contenu que le flot qui declenche `loop`, sous un nom que la
  // convention du dossier reserve aux fichiers de service.
  fs.writeFileSync(path.join(dir, '_rejeu.jsonl'), flot());
  const filePath = tmpFile();
  const s = await svc(filePath);
  assert.equal(await catchUpFromDisk(s, dir), 0);
  assert.equal(s.list({ sinceDays: 90 }).length, 0);
});

test('catch-up: une ligne illisible est sautee, celles d apres passent', async () => {
  const dir = tmpDir();
  // La ligne cassee est en 2e position : si elle faisait abandonner le fichier,
  // les trois appels suivants manqueraient et `loop` n atteindrait pas 4.
  const lines = [
    JSON.stringify(pre(1, T + 1000)),
    '{ceci n est pas du json',
    JSON.stringify(pre(2, T + 2000)),
    JSON.stringify(pre(3, T + 3000)),
    JSON.stringify(pre(4, T + 4000)),
  ];
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), lines.join('\n') + '\n');
  const s = await svc(tmpFile());
  assert.equal(await catchUpFromDisk(s, dir), 4, 'quatre lignes lisibles, la cassee ne se compte pas');
  assert.equal(s.list({ sinceDays: 90 }).length, 1);
});

test('catch-up: une entree illisible n arrete pas les fichiers suivants', async () => {
  const dir = tmpDir();
  // Un DOSSIER nomme comme un flux : `readFile` echoue (EISDIR). Il passe
  // avant l autre dans l ordre alphabetique de readdir.
  fs.mkdirSync(path.join(dir, 'aaa.jsonl'));
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), flot());
  const s = await svc(tmpFile());
  assert.equal(await catchUpFromDisk(s, dir), 10, 'le fichier d apres a bien ete lu');
  assert.equal(s.list({ sinceDays: 90 }).length, 1);
});

test('catch-up: un dossier absent n est pas une erreur', async () => {
  const s = await svc(tmpFile());
  assert.equal(await catchUpFromDisk(s, path.join(os.tmpdir(), 'avtest-nexiste-pas-xyz')), 0);
});

// ─── Le cablage (index.js) ────────────────────────────────────────────────
// Le module tient une instance unique dans une variable de module : chaque
// test en reprend une neuve en vidant le cache de `require`, plutot que
// d ajouter au produit une porte de remise a zero qui n existe que pour eux.

function neufIndex() {
  const p = require.resolve('../../lib/server/watchdog/index');
  delete require.cache[p];
  return require(p);
}

// Un faux module de detection : il ne detecte rien, il rapporte ce que
// `canObserve` repondait au moment ou l evenement lui est passe.
function fauxModule(vu, casse = false) {
  return async () => ({
    createWatchdog({ canObserve }) {
      vu.sonde = canObserve;
      return {
        processEvent() {
          vu.pendant.push(canObserve());
          if (casse) throw new Error('detecteur casse');
          return { newAlerts: [] };
        },
        tick() { return { newAlerts: [] }; },
        acknowledge() {},
        getActiveAlerts() { return []; },
      };
    },
  });
}

test('index: une seule instance, et getWatchdogService la rend', async () => {
  const idx = neufIndex();
  assert.equal(idx.getWatchdogService(), null, 'rien avant l initialisation');
  const vu = { pendant: [], sonde: null };
  const opts = {
    journalPath: tmpFile(), now: HORLOGE, loadModule: fauxModule(vu),
    // Un appelant qui croirait pouvoir tenir ce drapeau lui-meme : c est
    // `runCatchUp` qui le tient, sinon le balayage de demarrage serait muet
    // sans que rien ne le dise.
    isCatchingUp: () => true,
  };
  const a = await idx.initWatchdog(opts);
  const b = await idx.initWatchdog(opts);
  assert.equal(b, a, 'la seconde initialisation rend la premiere instance');
  assert.equal(idx.getWatchdogService(), a);
  assert.equal(vu.sonde(), true, 'le drapeau du module fait autorite, pas l option');
});

test('index: deux initialisations CONCURRENTES ne font qu un seul service', async () => {
  const idx = neufIndex();
  const journalPath = tmpFile();
  const opts = { journalPath, now: HORLOGE };
  // Deux `await` enchaines ne prouvent rien : la garde est franchie par le
  // premier appel AVANT que le second commence. Il faut deux appels qui se
  // chevauchent vraiment pour atteindre le `await` interne a deux.
  const [a, b] = await Promise.all([idx.initWatchdog(opts), idx.initWatchdog(opts)]);
  assert.equal(a, b, 'une garde posee sur la valeur ne survit pas a un await');

  // Et la consequence, qui est ce qui compte : deux services, ce serait deux
  // journaux, donc deux `seen` — et le meme fait consigne deux fois dans le
  // meme fichier, le doublon exact que ce module existe pour empecher.
  for (let i = 1; i <= 5; i++) { a.onEvent(pre(i, T + i * 1000)); a.onEvent(fail(i, T + i * 1000 + 500)); }
  for (let i = 1; i <= 5; i++) { b.onEvent(pre(i, T + i * 1000)); b.onEvent(fail(i, T + i * 1000 + 500)); }
  assert.equal(lignes(journalPath), 1);
});

test('index: un module de detection introuvable degrade, il ne tue pas le serveur', async () => {
  const idx = neufIndex();
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), flot());
  const { valeur, dits } = await enEcoutant(() => idx.initWatchdog({
    journalPath: tmpFile(), now: HORLOGE,
    loadModule: async () => { throw new Error("Cannot find module 'viz-watchdog.mjs'"); },
  }));
  // Une promesse rejetee et non attrapee tue le processus sous Node 24 : le
  // chien de garde est un supplement, il ne doit pas emporter le serveur.
  assert.equal(valeur, null, 'la promesse se resout a null, elle ne rejette pas');
  assert.equal(idx.getWatchdogService(), null);
  assert.match(dits.join('\n'), /detection indisponible/);
  assert.equal(await idx.runCatchUp(dir), 0, 'et le reste du demarrage continue');
});

test('index: un balayage sans dossier se plaint au lieu de passer pour un dossier vide', async () => {
  const idx = neufIndex();
  await idx.initWatchdog({ journalPath: tmpFile(), now: HORLOGE });
  // `runCatchUp` n a plus de dossier par defaut : l appelant doit le nommer.
  // S il l oublie, `catchUpFromDisk` rendrait 0 sans un mot — indiscernable
  // d un dossier legitimement vide. La plainte est la seule difference.
  const { valeur, dits } = await enEcoutant(() => idx.runCatchUp());
  assert.equal(valeur, 0);
  assert.match(dits.join('\n'), /sans dossier d evenements/);
});

test('index: le drapeau est leve pendant le rattrapage et baisse apres', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), flot());
  const idx = neufIndex();
  const vu = { pendant: [], sonde: null };
  await idx.initWatchdog({ journalPath: tmpFile(), now: HORLOGE, loadModule: fauxModule(vu) });
  assert.equal(vu.sonde(), true, 'hors rattrapage, le service observe');
  assert.equal(await idx.runCatchUp(dir), 10);
  assert.equal(vu.pendant.length, 10);
  assert.deepEqual([...new Set(vu.pendant)], [false], 'aucun evenement relu ne s est cru observe');
  assert.equal(vu.sonde(), true, 'le drapeau est retombe');
});

test('index: le drapeau retombe meme si le balayage casse', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), flot());
  const idx = neufIndex();
  const vu = { pendant: [], sonde: null };
  await idx.initWatchdog({ journalPath: tmpFile(), now: HORLOGE, loadModule: fauxModule(vu, true) });
  await assert.rejects(() => idx.runCatchUp(dir), /detecteur casse/);
  assert.equal(vu.sonde(), true, 'sinon `stuck` resterait muet pour toujours');
});

test('index: sans service, le balayage ne fait rien plutot que de casser', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), flot());
  // Le service est asynchrone a creer ; un demarrage qui appellerait le
  // balayage trop tot ne doit pas tomber sur un `null`.
  assert.equal(await neufIndex().runCatchUp(dir), 0);
});

test('index: un redemarrage complet ne reconsigne pas le passe', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), flot());
  const journalPath = tmpFile();

  const un = neufIndex();
  await un.initWatchdog({ journalPath, now: HORLOGE });
  assert.equal(await un.runCatchUp(dir), 10);
  assert.equal(lignes(journalPath), 1);

  // Serveur eteint, serveur rallume, meme dossier d evenements. Le journal
  // qu `initWatchdog` fabrique doit relire son fichier avec l horloge du
  // service, sans quoi il repart la memoire vide et ecrit tout une 2e fois.
  const deux = neufIndex();
  await deux.initWatchdog({ journalPath, now: HORLOGE });
  assert.equal(await deux.runCatchUp(dir), 10);
  assert.equal(lignes(journalPath), 1, 'le passe etait deja connu');
  assert.equal(deux.getWatchdogService().list({ sinceDays: 90 }).length, 1);
});
