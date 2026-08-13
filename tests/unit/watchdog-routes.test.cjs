'use strict';
// La premiere frontiere HTTP du chien de garde. Les routes ne font que
// traduire : lire l'URL ou le corps, appeler le service, serialiser. Aucune
// logique de detection ici — c'est ce que ce fichier verifie, autant que le
// contrat HTTP lui-meme.
//
// Et il verifie une chose de plus, qui n'est pas dans le contrat HTTP : ce que
// ces routes ne peuvent PAS faire. Le balayage de demarrage n'est sur qu'au
// demarrage ; rejoue depuis une requete, il recompte des appels dont la borne
// vive vient d'etre retiree et consigne une alerte annoncant plus d'appels
// qu'il n'y en a eu — dans un journal en ajout seul, donc pour de bon.

// ── Le bac a sable, pose AVANT le premier require de `src/server/**` ─────────
// Meme piege, meme parade que dans watchdog-wiring.test.mjs, et il est ACTIF :
// charger `src/server/routes` charge `session-index`, qui cree
// `os.tmpdir()/agent-events` des sa lecture ; un journal sans chemin explicite
// vit dans `os.homedir()/.agent-viz`. Sur cette machine ce sont le vrai dossier
// d'evenements et la vraie memoire des pannes de l'utilisateur — un test de la
// tache 6 y a lu 747 evenements reels avant correction. `os.tmpdir()` et
// `os.homedir()` relisent l'environnement a chaque appel, donc les detourner
// ici suffit, et `node --test` donne un processus par fichier.
const fs = require('fs');
const os = require('os');
const path = require('path');

const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-routes-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;
process.env.USERPROFILE = BAC;
process.env.HOME = BAC;

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');

const { createWatchdogRoutes } = require('../../src/server/watchdog/routes');
const { createJournal, DEFAULT_PATH } = require('../../src/server/watchdog/journal');
const { DIR } = require('../../src/server/session-index');
const { ROUTES, dispatch } = require('../../src/server/routes');

after(() => fs.rmSync(BAC, { recursive: true, force: true }));

// La redirection est verifiee, pas supposee : si elle ne prenait pas, tout ce
// fichier travaillerait sur les vraies donnees de l'utilisateur en silence.
test('bac a sable: ni le vrai dossier d evenements ni le vrai journal', () => {
  assert.ok(DIR.startsWith(BAC), `dossier d evenements hors du bac : ${DIR}`);
  assert.ok(DEFAULT_PATH.startsWith(BAC), `journal par defaut hors du bac : ${DEFAULT_PATH}`);
});

// ── Outillage ────────────────────────────────────────────────────────────────

function fakeRes() {
  return {
    code: null, headers: null, body: null,
    writeHead(c, h) { this.code = c; this.headers = h; },
    end(b) { this.body = b; },
    json() { return JSON.parse(this.body); },
  };
}

// Une requete de papier. `fire()` joue le ou les morceaux du corps puis la
// fin ; `casser()` joue l'incident reseau — une requete coupee en plein corps
// n'emet jamais `end`.
//
// Les morceaux sont joues TELS QUELS, et c'est delibere : une vraie
// `IncomingMessage` rend des Buffers, mais un appelant qui aurait pose un
// encodage sur le flux rend du texte. Les tests d'ensemble passent des chaines,
// celui du decoupage passe des Buffers — les deux formes sont donc exercees.
function fakeReq(...morceaux) {
  const handlers = {};
  return {
    on(ev, fn) { handlers[ev] = fn; return this; },
    fire() {
      for (const m of morceaux) if (m !== undefined) handlers.data?.(m);
      handlers.end?.();
    },
    casser() { handlers.error?.(new Error('connexion coupee')); },
  };
}

const urlOf = s => new URL(s, 'http://localhost');

// Le service tel que les routes le voient : `list`, `activeIds`, `ack`, et rien
// d'autre. Les surcharges arrivent par `sur`.
function faux(sur = {}) {
  return {
    list: () => [],
    activeIds: () => [],
    ack: () => true,
    ...sur,
  };
}

// Appelle la route GET et rend la reponse.
async function GET(service, chemin = '/alerts') {
  const [get] = createWatchdogRoutes(() => service);
  const res = fakeRes();
  await get.handler({}, res, urlOf(chemin));
  return res;
}

// Appelle la route POST avec un corps deja serialise et rend la reponse.
async function POST(service, corps) {
  const [, post] = createWatchdogRoutes(() => service);
  const res = fakeRes();
  const req = fakeReq(corps);
  const fini = post.handler(req, res, urlOf('/alerts/ack'));
  req.fire();
  await fini;
  return res;
}

// Le corps tel qu'un client l'envoie : du JSON.
const ack = (service, charge) => POST(service, JSON.stringify(charge));

// Plusieurs refus ne se distinguent de leur absence que par la plainte, et le
// journal se plaint sur `console.error`. Sans ca, la sortie des tests serait
// bruyante et les plaintes reelles invisibles.
async function enEcoutant(fn) {
  const vrai = console.error;
  const dits = [];
  console.error = (...a) => dits.push(a.map(String).join(' '));
  try { return { valeur: await fn(), dits: dits.join('\n') }; }
  finally { console.error = vrai; }
}

// ── La declaration, et le branchement reel ───────────────────────────────────

test('les deux routes sont declarees, et seul l acquittement est garde', () => {
  const routes = createWatchdogRoutes(() => faux());
  assert.deepEqual(
    routes.map(r => `${r.method} ${r.path || r.prefix}`),
    ['GET /alerts', 'POST /alerts/ack'],
  );
  // Le garde est sur l'ECRITURE, et sur elle seule : lire le journal depuis un
  // autre onglet ne change rien, l'acquitter si.
  assert.deepEqual(
    routes.filter(r => r.sameOrigin).map(r => r.path),
    ['/alerts/ack'],
  );
});

test('le serveur les sert vraiment : la table de routage les porte', async () => {
  const declarees = ROUTES.map(r => `${r.method} ${r.path || r.prefix}`);
  assert.ok(declarees.includes('GET /alerts'), 'GET /alerts absent de la table de routage');
  assert.ok(declarees.includes('POST /alerts/ack'), 'POST /alerts/ack absent de la table de routage');

  // Et pas seulement declarees : servies. Dans ce processus le chien de garde
  // n'a jamais ete initialise, donc le service est nul — c'est exactement l'etat
  // du serveur entre le require de la table et la fin du demarrage.
  const res = fakeRes();
  await dispatch({ url: '/alerts?days=90', method: 'GET', headers: {} }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.json(), { alerts: [], activeIds: [] });

  // Le garde `sameOrigin` est pose par la table, pas par la route : c'est le
  // repartiteur qui l'applique. Un site tiers ne doit pas pouvoir acquitter.
  const refus = fakeRes();
  await dispatch(
    { url: '/alerts/ack', method: 'POST', headers: { origin: 'http://ailleurs.example' } },
    refus,
  );
  assert.equal(refus.code, 405, 'un POST venu d ailleurs doit etre refuse par le repartiteur');
});

// ── Traduction seulement ─────────────────────────────────────────────────────

test('traduction seulement : la route ne peut atteindre aucun autre module', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'server', 'watchdog', 'routes.js'), 'utf8');
  // Ce module n'a besoin d'AUCUNE dependance, et c'est ce qui le rend incapable
  // de rejouer le balayage de demarrage : sans acces au module de cablage, il
  // ne peut pas l'appeler. Rejoue depuis une requete, ce balayage relit ce dont
  // `unwatchSession` vient de retirer la frontiere et le detecteur compte deux
  // fois — trois appels annonces comme quatre, une ligne fausse et DURABLE dans
  // un journal en ajout seul (mesure de la revue de la tache 7, voir le PIEGE
  // en bas de src/server/watchdog/index.js).
  //
  // Les DEUX formes, et la seconde n est pas theorique : les gestionnaires sont
  // deja `async`, donc `await import('../watchdog')` y est licite et atteint
  // exactement le meme module. Une garde posee sur la seule forme `require` est
  // une garde posee d un seul cote — le defaut le plus frequent de ce chantier.
  //
  // Le prix assume, et il faut le dire : cette assertion regarde le TEXTE,
  // commentaires compris. Le jour ou ce module aura une vraie raison de
  // dependre de quelque chose, elle rougira — et ce sera une decision a
  // prendre, pas un accident.
  assert.doesNotMatch(source, /\brequire\s*\(/,
    'la surface HTTP du chien de garde ne depend de rien, c est ce qui la borne');
  assert.doesNotMatch(source, /\bimport\s*\(/,
    'ni par require, ni par import() — les gestionnaires sont async');
  // La TROISIEME forme, et c est la bascule en ES modules qui la rend
  // necessaire : dans un module ES, la forme qu une dependance prend d abord
  // est l import STATIQUE, que ni `require(` ni `import(` ne voit. Une garde
  // qui ne peut plus rougir sur la forme la plus probable est une garde morte
  // (regle du motif mort). L ancre `^` en mode multiligne evite `import.meta`
  // (pas d espace apres le mot) et la forme dynamique `import(` (deja couverte).
  assert.doesNotMatch(source, /^\s*import[\s{*'"]/m,
    'ni par un import statique — c est la forme qu une dependance prend en ES modules');
  // La QUATRIEME forme. `export … from './y.js'` est une dependance statique au
  // meme titre qu un `import` : le module charge la cible et en reexporte. Une
  // garde qui ne la voit pas rend la revendication « ne depend de rien » d une
  // forme trop courte — c est le meme defaut d un seul cote que la troisieme
  // forme reparait. Le motif exige `from` APRES un `*` ou une accolade fermante,
  // ce qui laisse passer `export { createWatchdogRoutes };` (aucun `from`),
  // `export function`, `export const` et `export default`.
  assert.doesNotMatch(source, /^\s*export\s*(\*(\s+as\s+[A-Za-z_$][\w$]*)?|\{[^}]*\})\s*from\s*['"]/m,
    'ni par un export-depuis — `export … from` est une dependance statique elle aussi');
});

// ── GET /alerts ──────────────────────────────────────────────────────────────

test('GET /alerts rend le journal sur la fenetre demandee', async () => {
  const calls = [];
  const service = faux({ list: (o) => { calls.push(o); return [{ id: 'a', createdAt: 1 }]; } });
  const res = await GET(service, '/alerts?days=90');
  assert.equal(res.code, 200);
  assert.deepEqual(calls, [{ sinceDays: 90 }]);
  assert.deepEqual(res.json().alerts, [{ id: 'a', createdAt: 1 }]);
});

test('GET /alerts rend aussi ce qui est ENCORE vif', async () => {
  // Une alerte `standing` decrit un etat, pas un moment : elle n'a pas de
  // peremption. Servie depuis le seul journal, une session bloquee hier
  // ressortirait vive pour toujours — le journal est la memoire, il n'a aucune
  // notion de vivacite. C'est le detecteur qui sait laquelle l'est encore.
  //
  // Les deux reponses sont deliberement DISJOINTES : le journal porte une
  // alerte `standing` que le detecteur ne juge plus vive (session terminee), et
  // le detecteur en tient une que le journal ne marque pas `standing`. Sans
  // cela, une `activeIds` deduite du journal — « les alertes standing » — les
  // rendrait identiques et passerait ce test sans rien demander au detecteur.
  const service = faux({
    list: () => [
      { id: 'stuck:s1:Bash', createdAt: 1, standing: true },
      { id: 'loop:s2:Bash', createdAt: 2, standing: false },
    ],
    activeIds: () => ['loop:s2:Bash'],
  });
  const res = await GET(service);
  assert.deepEqual(res.json().activeIds, ['loop:s2:Bash']);
  assert.deepEqual(res.json().alerts.map(a => a.id), ['stuck:s1:Bash', 'loop:s2:Bash'],
    'la memoire reste entiere : la vivacite ne la filtre pas');
});

test('GET /alerts: la table 7/30/90 passe telle quelle', async () => {
  // Controle negatif : ce que l'utilisateur a choisi ne doit jamais retomber
  // sur le defaut.
  for (const jours of [7, 30, 90]) {
    const calls = [];
    await GET(faux({ list: (o) => { calls.push(o); return []; } }), `/alerts?days=${jours}`);
    assert.deepEqual(calls, [{ sinceDays: jours }], `?days=${jours} doit passer tel quel`);
  }
});

test('GET /alerts: une fenetre illisible retombe sur 30, jamais sur du vide', async () => {
  // Mesure de la revue de la tache 5 : `readAll` n'a AUCUNE garde, son defaut
  // `= 30` ne joue que sur `undefined`, et tout le reste fait un plancher `NaN`
  // — donc zero alerte, en silence. Sur un panneau de chien de garde, « vide
  // sans un mot » est indiscernable de « tout va bien » : c'est le pire mode de
  // panne possible.
  const cas = [
    ['', 'la chaine vide'],
    ['abc', 'un mot'],
    ['%20%20%20', 'du blanc'],
    ['null', 'la chaine null'],
    ['NaN', 'la chaine NaN'],
    ['4000', 'une fenetre hors table'],
    ['0', 'zero'],
    ['-7', 'une fenetre negative'],
    ['7.5', 'une fenetre fractionnaire'],
  ];
  for (const [valeur, quoi] of cas) {
    const calls = [];
    await GET(faux({ list: (o) => { calls.push(o); return []; } }), `/alerts?days=${valeur}`);
    assert.deepEqual(calls, [{ sinceDays: 30 }], `${quoi} doit retomber sur 30`);
  }
  // Et le parametre absent, qui est le cas courant.
  const calls = [];
  await GET(faux({ list: (o) => { calls.push(o); return []; } }));
  assert.deepEqual(calls, [{ sinceDays: 30 }], 'sans parametre, la fenetre par defaut');
});

test('GET /alerts sans service repond une liste vide, jamais une erreur', async () => {
  // Un service pas encore pret n'est pas une panne du produit : la table de
  // routage est construite au chargement du serveur, le chien de garde n'arrive
  // qu'a la fin du demarrage. Le tiroir s'ouvre vide, il ne s'ouvre pas en rouge.
  const res = await GET(null);
  assert.equal(res.code, 200);
  assert.deepEqual(res.json(), { alerts: [], activeIds: [] });
});

// ── POST /alerts/ack ─────────────────────────────────────────────────────────

test('POST /alerts/ack transmet id et createdAt', async () => {
  const acks = [];
  const res = await ack(faux({ ack: (id, at) => { acks.push([id, at]); return true; } }),
    { id: 'loop:s:Bash', createdAt: 42 });
  assert.deepEqual(acks, [['loop:s:Bash', 42]]);
  assert.equal(res.code, 200);
  assert.deepEqual(res.json(), { ok: true });
});

test('POST /alerts/ack accepte un createdAt en chaine et le rend en NOMBRE', async () => {
  // Un client qui serialise son horodatage en chaine est le cas normal, pas une
  // anomalie. Le journal sait le convertir, mais la route ne s'en remet pas a
  // lui pour ce qu'elle peut faire elle-meme : ce qui traverse la frontiere est
  // deja au contrat.
  const acks = [];
  await ack(faux({ ack: (id, at) => { acks.push([id, at]); return true; } }),
    { id: 'x', createdAt: '1700000000000' });
  assert.deepEqual(acks, [['x', 1700000000000]]);
  assert.equal(typeof acks[0][1], 'number', 'le journal doit recevoir un nombre, pas une chaine');
});

test('POST /alerts/ack: la garde sur createdAt est celle du journal, ni plus ni moins', async () => {
  // La route duplique le contrat des horodatages du journal — elle n'a aucun
  // `require`, elle ne peut pas le partager. Une copie qui derive est la
  // premiere facon de rouvrir une asymetrie : une valeur refusee ici mais
  // acceptee la (ou l'inverse) et l'une des deux gardes ne sert plus a rien.
  // Ce test tient les deux cotes ensemble.
  const filePath = path.join(BAC, 'contrat.jsonl');
  const journal = createJournal({ filePath, now: () => 1_700_000_000_000 });
  const valeurs = [
    0, 42, '42', ' 42 ', '0x2a', '1e3',
    '', '   ', 'abc', 'NaN', null, true, {}, [],
    '2023-11-14T00:00:00Z', '14/11/2023',
  ];
  for (const v of valeurs) {
    const { valeur: res } = await enEcoutant(() => ack(faux(), { id: 'x', createdAt: v }));
    const { valeur: retenu } = await enEcoutant(() => journal.appendAck('x', v, 1));
    assert.equal(res.code === 200, retenu,
      `desaccord sur ${JSON.stringify(v)} : route ${res.code}, journal ${retenu}`);
  }
});

test('POST /alerts/ack refuse un id qui n est pas une clef, et n acquitte rien', async () => {
  // Mesure de la revue de la tache 5 : `estClef` ne teste que `id != null`.
  // Toutes ces valeurs ecrivent une ligne d'acquittement sur le disque, sans
  // plainte et SANS deduplication — trois `?id=` font trois lignes — et le
  // rechargement les relit a chaque demarrage, ou elles pesent 90 jours.
  const cas = [
    [undefined, 'absent'],
    [null, 'null'],
    ['', 'la chaine vide'],
    ['   ', 'du blanc'],
    [['a', 'b'], 'un tableau (ce que Node fait de ?id=a&id=b)'],
    [{ x: 1 }, 'un objet (ce que Node fait de ?id[x]=1)'],
    [0, 'zero'],
    [false, 'false'],
    [true, 'true'],
  ];
  for (const [id, quoi] of cas) {
    let appele = false;
    const res = await ack(faux({ ack: () => { appele = true; return true; } }), { id, createdAt: 42 });
    assert.equal(res.code, 400, `${quoi} doit etre refuse`);
    assert.equal(appele, false, `${quoi} ne doit RIEN ecrire`);
  }
  // Controle negatif : la vraie forme d'un identifiant d'alerte passe.
  const acks = [];
  const ok = await ack(faux({ ack: (id) => { acks.push(id); return true; } }),
    { id: 'stuck:sess-1:agent-7:Bash', createdAt: 42 });
  assert.equal(ok.code, 200);
  assert.deepEqual(acks, ['stuck:sess-1:agent-7:Bash']);
});

test('POST /alerts/ack elague les blancs : ce qui est valide est ce qui est transmis', async () => {
  // La validite se juge « apres elagage des blancs » ; transmettre la valeur
  // NON elaguee ferait diverger la garde et la charge — la garde dirait oui
  // d'une clef, et le journal en ecrirait une autre, qui ne correspond a aucune
  // alerte. Meme parti que le journal, qui ecrit `createdAt` normalise et non
  // la valeur brute.
  const acks = [];
  const res = await ack(faux({ ack: (id) => { acks.push(id); return true; } }),
    { id: '  loop:s:Bash \n', createdAt: 42 });
  assert.equal(res.code, 200);
  assert.deepEqual(acks, ['loop:s:Bash']);
});

test('POST /alerts/ack refuse un corps illisible', async () => {
  for (const corps of ['', 'pas du json', '{"id":', 'null', '"une chaine"', '[1,2]', '42']) {
    let appele = false;
    const res = await POST(faux({ ack: () => { appele = true; return true; } }), corps);
    assert.equal(res.code, 400, `corps ${JSON.stringify(corps)} doit etre refuse`);
    assert.equal(appele, false, `corps ${JSON.stringify(corps)} ne doit RIEN ecrire`);
  }
});

test('POST /alerts/ack: un corps coupe au milieu d un caractere arrive entier', async () => {
  // Le decoupage en morceaux suit les segments du reseau, pas les caracteres.
  // Recoller en TEXTE decoderait chaque morceau separement et un caractere
  // multi-octets coupe en deux ressortirait en U+FFFD — et la clef abimee est
  // encore une chaine non vide : elle passerait la garde et s'ecrirait au
  // journal, ou elle n'acquitterait jamais rien pendant 90 jours.
  const id = 'loop:sess-é:Bash';
  const corps = Buffer.from(JSON.stringify({ id, createdAt: 42 }), 'utf8');
  const coupe = corps.indexOf(Buffer.from('é', 'utf8')) + 1;   // entre les deux octets du « é »
  const acks = [];
  const [, post] = createWatchdogRoutes(() => faux({ ack: (v) => { acks.push(v); return true; } }));
  const res = fakeRes();
  const req = fakeReq(corps.subarray(0, coupe), corps.subarray(coupe));
  const fini = post.handler(req, res, urlOf('/alerts/ack'));
  req.fire();
  await fini;
  assert.equal(res.code, 200);
  assert.deepEqual(acks, [id], 'la clef doit traverser la frontiere intacte');
});

test('POST /alerts/ack: une requete coupee repond, elle ne reste pas en suspens', async () => {
  // Sans ecoute de `error`, une connexion coupee en plein corps n'emet jamais
  // `end` : la promesse ne se resout pas, le gestionnaire reste en l'air et la
  // requete n'a jamais de reponse. Le test le prouve par sa propre terminaison
  // — sans la garde, l'`await` ci-dessous ne rend jamais la main et le test
  // meurt sur le delai de node:test.
  const [, post] = createWatchdogRoutes(() => faux({ ack: () => assert.fail('ne doit pas etre appele') }));
  const res = fakeRes();
  const req = fakeReq('{"id":"x"');
  const fini = post.handler(req, res, urlOf('/alerts/ack'));
  req.casser();
  await fini;
  assert.equal(res.code, 400);
});

test('POST /alerts/ack honore le refus du journal : jamais 200', async () => {
  // `ack` rend un booleen parce que le journal peut REFUSER. Jeter cette
  // reponse ferait dire 200 sur un acquittement qui n'a pas eu lieu :
  // l'utilisateur verrait son geste pris en compte et l'alerte reviendrait non
  // acquittee au redemarrage suivant. C'est exactement la panne muette que ce
  // chantier repare.
  const res = await ack(faux({ ack: () => false }), { id: 'x', createdAt: 42 });
  assert.notEqual(res.code, 200, 'un refus ne se dit pas 200');
  assert.equal(res.code, 500);
  assert.notEqual(res.json().ok, true);
  // Controle negatif : retenu, c'est bien 200.
  const ok = await ack(faux({ ack: () => true }), { id: 'x', createdAt: 42 });
  assert.equal(ok.code, 200);
});

test('POST /alerts/ack sans service ne repond pas 200', async () => {
  // Meme raison que le refus, en plus fort : sans service, RIEN n'a ete
  // consigne. Repondre 200 serait mentir sur un geste que le disque ignore.
  // Le tiroir peut s'ouvrir vide (c'est une lecture) ; un acquittement qui
  // n'acquitte rien, non.
  const res = await ack(null, { id: 'x', createdAt: 42 });
  assert.notEqual(res.code, 200);
  assert.equal(res.code, 503);
});
