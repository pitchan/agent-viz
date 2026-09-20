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

// ── Le bac a sable, pose AVANT le premier import de `src/server/**` ─────────
// Meme piege, meme parade que dans tests/unit/version-route.test.ts : charger
// `src/server/routes` cree `os.tmpdir()/agent-events` des sa lecture, et un
// journal sans chemin vit dans `os.homedir()/.agent-viz`, les vrais dossiers
// de l'utilisateur. Un import statique de ces modules s'evaluerait avant ces
// lignes (les imports sont hisses en tete) ; l'import dynamique plus bas
// s'assure qu'ils lisent l'environnement APRES cette redirection.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterAll, expect, test } from 'vitest';

const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-routes-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;
process.env.USERPROFILE = BAC;
process.env.HOME = BAC;

const { createWatchdogRoutes } = await import('../../src/server/watchdog/routes.ts');
const { createJournal, DEFAULT_PATH } = await import('../../src/server/watchdog/journal.ts');
const { DIR } = await import('../../src/server/session-index.ts');
const { ROUTES, dispatch } = await import('../../src/server/routes.ts');

afterAll(() => fs.rmSync(BAC, { recursive: true, force: true }));

// La redirection est verifiee, pas supposee : si elle ne prenait pas, tout ce
// fichier travaillerait sur les vraies donnees de l'utilisateur en silence.
test('bac a sable: ni le vrai dossier d evenements ni le vrai journal', () => {
  expect(DIR.startsWith(BAC), `dossier d evenements hors du bac : ${DIR}`).toBeTruthy();
  expect(DEFAULT_PATH.startsWith(BAC), `journal par defaut hors du bac : ${DEFAULT_PATH}`).toBeTruthy();
});

// ── Outillage ────────────────────────────────────────────────────────────────

function fakeRes() {
  return {
    code: null as number | null,
    headers: null as Record<string, string> | null,
    body: null as string | null,
    writeHead(c: number, h: Record<string, string>) { this.code = c; this.headers = h; },
    end(b: string) { this.body = b; },
    json() { return JSON.parse(this.body!); },
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
function fakeReq(...morceaux: (string | Buffer | undefined)[]) {
  const handlers: Record<string, ((arg?: any) => void) | undefined> = {};
  return {
    on(ev: string, fn: (arg?: any) => void) { handlers[ev] = fn; return this; },
    fire() {
      for (const m of morceaux) if (m !== undefined) handlers.data?.(m);
      handlers.end?.();
    },
    casser() { handlers.error?.(new Error('connexion coupee')); },
  };
}

const urlOf = (s: string) => new URL(s, 'http://localhost');

// Le service tel que les routes le voient : `list`, `activeIds`, `ack`, et rien
// d'autre. Les surcharges arrivent par `sur`.
function faux(sur: Record<string, any> = {}): any {
  return {
    list: () => [],
    activeIds: () => [],
    ack: () => true,
    ...sur,
  };
}

// Appelle la route GET et rend la reponse.
async function GET(service: any, chemin = '/alerts') {
  const [get] = createWatchdogRoutes(() => service);
  const res = fakeRes();
  await get!.handler({} as any, res, urlOf(chemin));
  return res;
}

// Appelle la route POST avec un corps deja serialise et rend la reponse.
async function POST(service: any, corps: string | Buffer) {
  const [, post] = createWatchdogRoutes(() => service);
  const res = fakeRes();
  const req = fakeReq(corps);
  const fini = post!.handler(req as any, res, urlOf('/alerts/ack'));
  req.fire();
  await fini;
  return res;
}

// Le corps tel qu'un client l'envoie : du JSON.
const ack = (service: any, charge: unknown) => POST(service, JSON.stringify(charge));

// Plusieurs refus ne se distinguent de leur absence que par la plainte, et le
// journal se plaint sur `console.error`. Sans ca, la sortie des tests serait
// bruyante et les plaintes reelles invisibles.
async function enEcoutant<T>(fn: () => Promise<T> | T) {
  const vrai = console.error;
  const dits: string[] = [];
  console.error = (...a: any[]) => dits.push(a.map(String).join(' '));
  try { return { valeur: await fn(), dits: dits.join('\n') }; }
  finally { console.error = vrai; }
}

// ── La declaration, et le branchement reel ───────────────────────────────────

test('les deux routes sont declarees, et seul l acquittement est garde', () => {
  const routes = createWatchdogRoutes(() => faux());
  expect(routes.map(r => `${r.method} ${r.path || (r as any).prefix}`)).toEqual(['GET /alerts', 'POST /alerts/ack']);
  // Le garde est sur l'ECRITURE, et sur elle seule : lire le journal depuis un
  // autre onglet ne change rien, l'acquitter si.
  expect(routes.filter(r => r.sameOrigin).map(r => r.path)).toEqual(['/alerts/ack']);
});

test('le serveur les sert vraiment : la table de routage les porte', async () => {
  const declarees = ROUTES.map(r => `${r.method} ${r.path || r.prefix}`);
  expect(declarees.includes('GET /alerts'), 'GET /alerts absent de la table de routage').toBeTruthy();
  expect(declarees.includes('POST /alerts/ack'), 'POST /alerts/ack absent de la table de routage').toBeTruthy();

  // Et pas seulement declarees : servies. Dans ce processus le chien de garde
  // n'a jamais ete initialise, donc le service est nul — c'est exactement l'etat
  // du serveur entre le require de la table et la fin du demarrage.
  const res = fakeRes();
  await dispatch(
    { url: '/alerts?days=90', method: 'GET', headers: {} } as unknown as IncomingMessage,
    res as unknown as ServerResponse,
  );
  expect(res.code).toBe(200);
  expect(res.json()).toEqual({ alerts: [], activeIds: [] });

  // Le garde `sameOrigin` est pose par la table, pas par la route : c'est le
  // repartiteur qui l'applique. Un site tiers ne doit pas pouvoir acquitter.
  const refus = fakeRes();
  await dispatch(
    { url: '/alerts/ack', method: 'POST', headers: { origin: 'http://ailleurs.example' } } as unknown as IncomingMessage,
    refus as unknown as ServerResponse,
  );
  expect(refus.code, 'un POST venu d ailleurs doit etre refuse par le repartiteur').toBe(405);
});

// ── Traduction seulement ─────────────────────────────────────────────────────

test('traduction seulement : la route ne peut atteindre aucun autre module', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'server', 'watchdog', 'routes.ts'), 'utf8');
  // Sans AUCUNE dependance, ce module ne peut pas rejouer le balayage de demarrage. Rejoue depuis une
  // requete, ce balayage recompte des appels dont la frontiere vient d'etre retiree et ecrit une ligne
  // fausse et DURABLE dans un journal en ajout seul (voir le PIEGE de src/server/watchdog/index.ts).
  //
  // Les DEUX formes, et la seconde n est pas theorique : les gestionnaires sont
  // deja `async`, donc `await import('../watchdog')` y est licite et atteint
  // exactement le meme module. Une garde posee sur la seule forme `require` est
  // une garde posee d un seul cote.
  //
  // Le prix est connu, et il faut le dire : cette assertion regarde le TEXTE,
  // commentaires compris. Le jour ou ce module aura une vraie raison de
  // dependre de quelque chose, elle rougira — et ce sera une decision a
  // prendre, pas un accident.
  expect(source, 'la surface HTTP du chien de garde ne depend de rien, c est ce qui la borne').not.toMatch(/\brequire\s*\(/);
  expect(source, 'ni par require, ni par import() — les gestionnaires sont async').not.toMatch(/\bimport\s*\(/);
  // La TROISIEME forme : dans un module ES, la forme qu une dependance prend d abord
  // est l import STATIQUE, que ni `require(` ni `import(` ne voit. Une garde qui ne
  // rougit pas sur la forme la plus probable est une garde morte. L ancre `^` en mode
  // multiligne evite `import.meta` (pas d espace apres le mot) et la forme dynamique
  // `import(` (deja couverte).
  expect(source, 'ni par un import statique — c est la forme qu une dependance prend en ES modules').not.toMatch(/^\s*import[\s{*'"]/m);
  // La QUATRIEME forme. `export … from './y.js'` est une dependance statique au
  // meme titre qu un `import` : le module charge la cible et en reexporte. Une
  // garde qui ne la voit pas rend la revendication « ne depend de rien » d une
  // forme trop courte — c est le meme defaut d un seul cote que la troisieme
  // forme reparait. Le motif exige `from` APRES un `*` ou une accolade fermante,
  // ce qui laisse passer `export { createWatchdogRoutes };` (aucun `from`),
  // `export function`, `export const` et `export default`.
  expect(source, 'ni par un export-depuis — `export … from` est une dependance statique elle aussi').not.toMatch(/^\s*export\s*(\*(\s+as\s+[A-Za-z_$][\w$]*)?|\{[^}]*\})\s*from\s*['"]/m);
});

// ── GET /alerts ──────────────────────────────────────────────────────────────

test('GET /alerts rend le journal sur la fenetre demandee', async () => {
  const calls: any[] = [];
  const service = faux({ list: (o: any) => { calls.push(o); return [{ id: 'a', createdAt: 1 }]; } });
  const res = await GET(service, '/alerts?days=90');
  expect(res.code).toBe(200);
  expect(calls).toEqual([{ sinceDays: 90 }]);
  expect(res.json().alerts).toEqual([{ id: 'a', createdAt: 1 }]);
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
  expect(res.json().activeIds).toEqual(['loop:s2:Bash']);
  expect(res.json().alerts.map((a: any) => a.id), 'la memoire reste entiere : la vivacite ne la filtre pas').toEqual(['stuck:s1:Bash', 'loop:s2:Bash']);
});

test('GET /alerts: la table 7/30/90 passe telle quelle', async () => {
  // Controle negatif : ce que l'utilisateur a choisi ne doit jamais retomber
  // sur le defaut.
  for (const jours of [7, 30, 90]) {
    const calls: any[] = [];
    await GET(faux({ list: (o: any) => { calls.push(o); return []; } }), `/alerts?days=${jours}`);
    expect(calls, `?days=${jours} doit passer tel quel`).toEqual([{ sinceDays: jours }]);
  }
});

test('GET /alerts: une fenetre illisible retombe sur 30, jamais sur du vide', async () => {
  // `readAll` n'a AUCUNE garde : son defaut `= 30` ne joue que sur `undefined`, tout le reste donne
  // un plancher `NaN`, donc zero alerte en silence. Sur un panneau de chien de garde, « vide sans un
  // mot » est indiscernable de « tout va bien ».
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
    const calls: any[] = [];
    await GET(faux({ list: (o: any) => { calls.push(o); return []; } }), `/alerts?days=${valeur}`);
    expect(calls, `${quoi} doit retomber sur 30`).toEqual([{ sinceDays: 30 }]);
  }
  // Et le parametre absent, qui est le cas courant.
  const calls: any[] = [];
  await GET(faux({ list: (o: any) => { calls.push(o); return []; } }));
  expect(calls, 'sans parametre, la fenetre par defaut').toEqual([{ sinceDays: 30 }]);
});

test('GET /alerts sans service repond une liste vide, jamais une erreur', async () => {
  // Un service pas encore pret n'est pas une panne du produit : la table de
  // routage est construite au chargement du serveur, le chien de garde n'arrive
  // qu'a la fin du demarrage. Le tiroir s'ouvre vide, il ne s'ouvre pas en rouge.
  const res = await GET(null);
  expect(res.code).toBe(200);
  expect(res.json()).toEqual({ alerts: [], activeIds: [] });
});

// ── POST /alerts/ack ─────────────────────────────────────────────────────────

test('POST /alerts/ack transmet id et createdAt', async () => {
  const acks: any[] = [];
  const res = await ack(faux({ ack: (id: any, at: any) => { acks.push([id, at]); return true; } }),
    { id: 'loop:s:Bash', createdAt: 42 });
  expect(acks).toEqual([['loop:s:Bash', 42]]);
  expect(res.code).toBe(200);
  expect(res.json()).toEqual({ ok: true });
});

test('POST /alerts/ack accepte un createdAt en chaine et le rend en NOMBRE', async () => {
  // Un client qui serialise son horodatage en chaine est le cas normal, pas une
  // anomalie. Le journal sait le convertir, mais la route ne s'en remet pas a
  // lui pour ce qu'elle peut faire elle-meme : ce qui traverse la frontiere est
  // deja au contrat.
  const acks: any[] = [];
  await ack(faux({ ack: (id: any, at: any) => { acks.push([id, at]); return true; } }),
    { id: 'x', createdAt: '1700000000000' });
  expect(acks).toEqual([['x', 1700000000000]]);
  expect(typeof acks[0][1], 'le journal doit recevoir un nombre, pas une chaine').toBe('number');
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
    expect(res.code === 200, `desaccord sur ${JSON.stringify(v)} : route ${res.code}, journal ${retenu}`).toBe(retenu);
  }
});

test('POST /alerts/ack refuse un id qui n est pas une clef, et n acquitte rien', async () => {
  // `estClef` ne teste de l'id que `id != null` : sans garde de la route, chacune de ces valeurs
  // ecrirait une ligne d'acquittement, SANS deduplication, que chaque demarrage relirait
  // pendant 90 jours.
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
    expect(res.code, `${quoi} doit etre refuse`).toBe(400);
    expect(appele, `${quoi} ne doit RIEN ecrire`).toBe(false);
  }
  // Controle negatif : la vraie forme d'un identifiant d'alerte passe.
  const acks: any[] = [];
  const ok = await ack(faux({ ack: (id: any) => { acks.push(id); return true; } }),
    { id: 'stuck:sess-1:agent-7:Bash', createdAt: 42 });
  expect(ok.code).toBe(200);
  expect(acks).toEqual(['stuck:sess-1:agent-7:Bash']);
});

test('POST /alerts/ack elague les blancs : ce qui est valide est ce qui est transmis', async () => {
  // La validite se juge « apres elagage des blancs » ; transmettre la valeur
  // NON elaguee ferait diverger la garde et la charge — la garde dirait oui
  // d'une clef, et le journal en ecrirait une autre, qui ne correspond a aucune
  // alerte. Meme parti que le journal, qui ecrit `createdAt` normalise et non
  // la valeur brute.
  const acks: any[] = [];
  const res = await ack(faux({ ack: (id: any) => { acks.push(id); return true; } }),
    { id: '  loop:s:Bash \n', createdAt: 42 });
  expect(res.code).toBe(200);
  expect(acks).toEqual(['loop:s:Bash']);
});

test('POST /alerts/ack refuse un corps illisible', async () => {
  for (const corps of ['', 'pas du json', '{"id":', 'null', '"une chaine"', '[1,2]', '42']) {
    let appele = false;
    const res = await POST(faux({ ack: () => { appele = true; return true; } }), corps);
    expect(res.code, `corps ${JSON.stringify(corps)} doit etre refuse`).toBe(400);
    expect(appele, `corps ${JSON.stringify(corps)} ne doit RIEN ecrire`).toBe(false);
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
  const acks: any[] = [];
  const [, post] = createWatchdogRoutes(() => faux({ ack: (v: any) => { acks.push(v); return true; } }));
  const res = fakeRes();
  const req = fakeReq(corps.subarray(0, coupe), corps.subarray(coupe));
  const fini = post!.handler(req as any, res, urlOf('/alerts/ack'));
  req.fire();
  await fini;
  expect(res.code).toBe(200);
  expect(acks, 'la clef doit traverser la frontiere intacte').toEqual([id]);
});

test('POST /alerts/ack: une requete coupee repond, elle ne reste pas en suspens', async () => {
  // Sans ecoute de `error`, une connexion coupee en plein corps n'emet jamais
  // `end` : la promesse ne se resout pas, le gestionnaire reste en l'air et la
  // requete n'a jamais de reponse. Le test le prouve par sa propre terminaison
  // — sans la garde, l'`await` ci-dessous ne rend jamais la main et le test
  // meurt sur le delai de node:test.
  const [, post] = createWatchdogRoutes(() => faux({ ack: () => expect.fail('ne doit pas etre appele') }));
  const res = fakeRes();
  const req = fakeReq('{"id":"x"');
  const fini = post!.handler(req as any, res, urlOf('/alerts/ack'));
  req.casser();
  await fini;
  expect(res.code).toBe(400);
});

test('POST /alerts/ack honore le refus du journal : jamais 200', async () => {
  // `ack` rend un booleen parce que le journal peut REFUSER. Jeter cette reponse ferait
  // dire 200 sur un acquittement qui n'a pas eu lieu : l'utilisateur verrait son geste pris
  // en compte et l'alerte reviendrait non acquittee au redemarrage suivant.
  const res = await ack(faux({ ack: () => false }), { id: 'x', createdAt: 42 });
  expect(res.code, 'un refus ne se dit pas 200').not.toBe(200);
  expect(res.code).toBe(500);
  expect(res.json().ok).not.toBe(true);
  // Controle negatif : retenu, c'est bien 200.
  const ok = await ack(faux({ ack: () => true }), { id: 'x', createdAt: 42 });
  expect(ok.code).toBe(200);
});

test('POST /alerts/ack sans service ne repond pas 200', async () => {
  // Meme raison que le refus, en plus fort : sans service, RIEN n'a ete
  // consigne. Repondre 200 serait mentir sur un geste que le disque ignore.
  // Le tiroir peut s'ouvrir vide (c'est une lecture) ; un acquittement qui
  // n'acquitte rien, non.
  const res = await ack(null, { id: 'x', createdAt: 42 });
  expect(res.code).not.toBe(200);
  expect(res.code).toBe(503);
});
