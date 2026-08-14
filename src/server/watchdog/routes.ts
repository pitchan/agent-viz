'use strict';
// routes.js — la surface HTTP du chien de garde.
//
// Traduction seulement : lire l'URL ou le corps, appeler le service,
// serialiser la reponse. Aucune logique de detection ici — meme regle que
// src/server/observatory/routes.js. Le service arrive par un accesseur, jamais
// par une valeur : la table de routage est construite au chargement du serveur,
// le chien de garde n'existe qu'a la fin de son demarrage.
//
// Ce module n'a AUCUNE dependance, et c'en est une propriete, pas un hasard —
// un test le verifie sur le texte, y compris `import type` : c'est pourquoi
// tous les types ci-dessous sont locaux, aucun n'est importe. Deux raisons, et
// la seconde est mesuree :
//
//  1. une traduction qui a besoin d'une dependance n'est plus une traduction ;
//  2. le balayage de demarrage du chien de garde n'est sur qu'AU demarrage,
//     avant qu'une session ait pu etre desarmee. Rejoue depuis une requete, il
//     relit ce dont la purge de frontiere vient de retirer la borne : le
//     detecteur compte deux fois, et le produit consigne une alerte annoncant
//     plus d'appels qu'il n'y en a eu — dans un journal en ajout seul, donc
//     pour de bon. Voir le PIEGE en bas de src/server/watchdog/index.js. Sans
//     acces au module de cablage, ces routes ne peuvent pas le rejouer.
//
// Ces routes sont la PREMIERE frontiere HTTP du chien de garde, et le journal
// ne valide pas ce qu'on lui passe : `estClef` ne teste que `id != null`, et
// `readAll` n'a aucune garde sur sa fenetre. Les deux valeurs qui traversent
// ici sont donc validees ici — voir `fenetreDe`, `enClef` et `enHorodatage`.

// La forme du service telle que CES routes la voient, et rien de plus — pas
// d'import de service.ts (voir l'en-tete : zero dependance, verifie sur le
// texte). `sinceDays` est TOUJOURS fourni ici (voir `fenetreDe`), jamais
// `undefined` : la garde vit dans cette route, pas dans le service.
interface ServiceLike {
  list(opts: { sinceDays: number }): unknown;
  activeIds(): unknown;
  ack(id: string, createdAt: number): boolean;
}

interface ResponseLike {
  writeHead(code: number, headers: Record<string, string>): unknown;
  end(body: string): unknown;
}

interface RequestLike {
  on(event: 'data', handler: (chunk: Buffer | string) => void): unknown;
  on(event: 'end', handler: () => void): unknown;
  on(event: 'error', handler: () => void): unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sendJson(res: ResponseLike, code: number, payload: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

// La table 7/30/90 est celle du tiroir Conseils : la page n'a qu'une seule
// notion de periode.
const FENETRES = new Set([7, 30, 90]);
const FENETRE_DEFAUT = 30;

// La fenetre demandee, ou le defaut. Le test d'appartenance a la table est ce
// qui rend cette fonction sure : elle ne peut rendre que 7, 30 ou 90, quoi
// qu'on lui donne. C'est la propriete qui compte, parce que `readAll` n'a
// AUCUNE garde — son defaut `= 30` ne joue que sur `undefined`, et tout le
// reste ('' , '   ', 'abc', 'null') fait un plancher `NaN`, donc zero alerte,
// EN SILENCE. Sur un panneau de chien de garde, « vide sans un mot » est
// indiscernable de « tout va bien » : le pire mode de panne possible.
//
// Une valeur hors table retombe sur le defaut plutot que d'etre refusee : le
// tiroir doit s'ouvrir. Une periode que l'utilisateur n'a pas choisie se voit
// (le panneau affiche laquelle) ; une liste vide, non.
function fenetreDe(url: URL): number {
  const n = Number(url.searchParams.get('days'));
  return FENETRES.has(n) ? n : FENETRE_DEFAUT;
}

// Le contrat des horodatages du journal, applique ICI : millisecondes epoch,
// nombre ou chaine de chiffres, et rien d'autre. Ni ISO 8601, ni format local
// — leur interpretation depend du moteur, et l'on echangerait une perte
// visible contre une donnee fausse silencieuse.
//
// La conversion est restreinte aux chaines qui portent autre chose que du
// blanc, parce que Number(''), Number('   ') et Number(null) valent tous 0 :
// sans ca, une valeur absente deviendrait un horodatage a l'epoque Unix au lieu
// d'un refus franc.
//
// Oui, c'est une COPIE de ce que fait le journal, et c'est assume : sans
// dependance, cette frontiere ne peut pas partager sa garde. Le prix est une
// derive possible entre les deux, et le test les tient cote a cote sur la meme
// liste de valeurs pour que la derive rougisse.
//
// Rend null quand ce n'est pas un horodatage.
function enHorodatage(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

// La clef d'une alerte est une chaine non vide. Ici la garde est
// DELIBEREMENT plus stricte que celle du journal, qui ne teste que
// `id != null` : mesure de la revue de la tache 5, `''`, `'   '`, un tableau
// (ce que Node fait de `?id=a&id=b`), un objet, `0` et `false` y ecrivent tous
// une ligne d'acquittement, sans plainte et sans deduplication, que le
// rechargement relit a chaque demarrage pendant 90 jours.
//
// Rend la clef ELAGUEE, pas la valeur brute : ce qui a ete juge valide est ce
// qui doit etre transmis. Juger apres elagage puis transmettre avant ferait
// diverger la garde et la charge — la garde dirait oui d'une clef et le journal
// en ecrirait une autre, qui ne correspondrait a aucune alerte. Meme parti que
// le journal, qui ecrit son `createdAt` normalise et non la valeur brute.
//
// Rend null quand ce n'est pas une clef.
function enClef(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const clef = v.trim();
  return clef === '' ? null : clef;
}

// Le corps de la requete, ou null si elle a ete coupee avant sa fin. L'ecoute
// de `error` n'est pas un ornement : une connexion coupee en plein corps
// n'emet jamais `end`, et sans elle la promesse ne se resoudrait jamais — le
// gestionnaire resterait en l'air et la requete n'aurait aucune reponse.
//
// Les morceaux sont recolles en OCTETS, decodes une seule fois a la fin. Les
// concatener en texte (`corps += c`) decoderait chaque morceau separement, et
// un caractere multi-octets coupe a la frontiere de deux morceaux ressortirait
// en U+FFFD. Ici, ce serait une corruption SILENCIEUSE : la clef d'alerte
// abimee est encore une chaine non vide, elle traverse la garde et s'ecrit au
// journal — une ligne qui n'acquitte aucune alerte, et qui y reste 90 jours.
// Le decoupage n'est pas notre affaire, il suit les segments du reseau.
function lireCorps(req: RequestLike): Promise<string | null> {
  return new Promise((resolve) => {
    const morceaux: Buffer[] = [];
    // `Buffer.from` pour le cas ou un appelant aurait pose un encodage sur le
    // flux, auquel cas les morceaux arrivent deja en texte.
    req.on('data', (c) => { morceaux.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); });
    req.on('end', () => resolve(Buffer.concat(morceaux).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

function createWatchdogRoutes(getService: () => ServiceLike | null) {
  return [
    {
      method: 'GET',
      path: '/alerts',
      // Un service pas encore pret n'est pas une panne du produit : le tiroir
      // s'ouvre sur une liste vide, jamais sur un message d'erreur. C'est une
      // LECTURE — ne rien avoir a montrer est un etat legitime.
      handler: async (_req: RequestLike, res: ResponseLike, url: URL) => {
        const service = getService();
        if (!service) { sendJson(res, 200, { alerts: [], activeIds: [] }); return; }
        // Deux questions, deux reponses. `list` rend la memoire — ce qui a ete
        // consigne sur la fenetre demandee. `activeIds` rend ce qui est ENCORE
        // vif, que le journal ne peut pas savoir : une alerte `standing` decrit
        // un etat, donc elle n'a pas de peremption, et une session bloquee hier
        // ressortirait vive pour toujours si l'on servait le seul journal.
        sendJson(res, 200, {
          alerts: service.list({ sinceDays: fenetreDe(url) }),
          activeIds: service.activeIds(),
        });
      },
    },
    {
      method: 'POST',
      path: '/alerts/ack',
      // Meme garde que la purge d'analyse, et pour la meme raison : un site
      // tiers ouvert dans un autre onglet ne doit pas pouvoir eteindre les
      // alertes de l'utilisateur. Lire le journal ne change rien ; l'acquitter
      // si — d'ou le garde sur cette route et sur elle seule.
      sameOrigin: true,
      handler: async (req: RequestLike, res: ResponseLike) => {
        const brut = await lireCorps(req);
        let charge: unknown;
        // `JSON.parse(null)` rend null au lieu de lever (coercion `ToString`
        // du runtime : `null` -> `"null"`) : le corps coupe suit le meme
        // chemin qu'un corps JSON valide qui ne serait pas un objet, ci-dessous.
        try { charge = JSON.parse(brut === null ? 'null' : brut); }
        catch { sendJson(res, 400, { error: 'corps JSON invalide' }); return; }
        const objet = isRecord(charge) ? charge : {};
        const clef = enClef(objet.id);
        const quand = enHorodatage(objet.createdAt);
        if (clef === null || quand === null) {
          sendJson(res, 400, {
            error: 'id (chaine non vide) et createdAt (millisecondes epoch) requis',
          });
          return;
        }
        const service = getService();
        // Sans service, RIEN n'a ete consigne. Repondre 200 ferait voir a
        // l'utilisateur un geste pris en compte que le disque ignore, et
        // l'alerte reviendrait non acquittee au redemarrage. La lecture peut
        // rendre du vide ; une ecriture qui n'ecrit pas, non.
        if (!service) {
          sendJson(res, 503, { error: 'chien de garde indisponible, acquittement non consigne' });
          return;
        }
        // `ack` rend un booleen parce que le journal peut REFUSER — c'est la
        // seule chose qui sache si l'acquittement a ete retenu. Le jeter ferait
        // dire 200 sur un acquittement qui n'a pas eu lieu : exactement la
        // panne muette que ce chantier repare.
        //
        // 500 et non 400 : la route vient de verifier tout ce que le journal
        // verifie, donc un refus ici est un desaccord entre les deux, pas une
        // faute du client — qui n'y peut rien et n'a rien a corriger.
        if (!service.ack(clef, quand)) {
          sendJson(res, 500, { error: 'acquittement refuse par le journal' });
          return;
        }
        sendJson(res, 200, { ok: true });
      },
    },
  ];
}

export { createWatchdogRoutes };
