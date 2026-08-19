// The badge no longer detects anything: the server does, and it remembers.
// What the badge still owes the user is the live case — say what is wrong NOW
// — so it filters the server's journal. Two sieves, not one, because the
// journal is memory and memory has no notion of liveness:
//
//   * an EVENT-driven alert (loop, retryStorm) reports a moment, so the
//     freshness rule alone judges it;
//   * a STANDING alert (stuck) reports a state, so it has no expiry at all —
//     `isFresh` always says yes — and only the server's `activeIds` can say
//     whether it still holds. Served from the journal alone, a session stuck
//     yesterday would shout for ever.
//
// These tests pin that split, and the traps in it: an alert with no createdAt
// (the pricing vigil) is current by construction and must never be filtered
// away; an acknowledgement that the server refused must not leave the badge
// quiet about an alert that is coming back.
//
// Nothing here touches the real journal, the real home directory or the real
// event folder: the module is a pure reader over an injected fetch.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const T = 1_700_000_000_000;
const HOUR = 3_600_000;

// Uniform alert shape, as the journal serves it back.
const evt = (createdAt, id, extra = {}) => ({
  id, type: 'loop', sessionId: 's', agentId: '', toolName: 'Bash',
  createdAt, message: 'x', subject: 'npm run build',
  occurrences: [], tools: [], cwd: 'f:\\p', standing: false,
  acknowledged: false, ...extra,
});
// A state, not a moment: no expiry of its own, liveness comes from the server.
const stuck = (createdAt, id) => evt(createdAt, id, {
  type: 'stuck', toolName: '', standing: true, message: 'No event since 16:22',
});

// One module instance per test: the reader's state is a module singleton.
// The journal object stays mutable so a test can change what the next
// GET /alerts answers.
async function freshClient({ alerts = [], activeIds = [], now = T, ack } = {}) {
  const journal = { alerts, activeIds };
  const posts = [];
  let clock = now;
  const fetchImpl = async (url, opts) => {
    if (String(url).startsWith('/alerts/ack')) {
      posts.push({ body: JSON.parse(opts.body), method: opts.method });
      if (typeof ack === 'function') return ack();
      return ack ?? { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({ alerts: journal.alerts, activeIds: journal.activeIds }) };
  };
  const mod = await import(`../../src/web/viz-watchdog-client.js?t=${T}-${Math.random()}`);
  await mod.initAlertReader({ fetchImpl, now: () => clock });
  // Two different things, and the difference matters. `seen` is what gets
  // ANNOUNCED — the signal the desktop notification hangs off. `calls` is how
  // many times the interface was told to re-render at all, which is the only
  // thing that can carry a WITHDRAWAL: an alert leaving carries no alert.
  const seen = [];
  const calls = [];
  mod.onAlertsChanged(a => { calls.push(a); seen.push(...a); });
  return { mod, journal, posts, seen, calls, at(ms) { clock = ms; } };
}

const ids = list => list.map(a => a.id);

// ─── The freshness sieve on the event path ────────────────────────────────

test('la pastille montre ce que le serveur a vu recemment', async () => {
  const { mod } = await freshClient({ alerts: [evt(T - 1000, 'a'), evt(T - HOUR, 'b')] });
  assert.deepEqual(ids(mod.getActiveAlerts()), ['a'],
    'le journal contient l heure passee, la pastille ne la crie pas');
});

test('une alerte acquittee cote serveur ne revient pas', async () => {
  const acked = evt(T - 1000, 'a', { acknowledged: true });
  const { mod } = await freshClient({ alerts: [acked] });
  assert.deepEqual(mod.getActiveAlerts(), []);
});

test('une alerte poussee par le flux apparait sans attendre le prochain chargement', async () => {
  const { mod, seen } = await freshClient({});
  mod.applyServerAlert(evt(T - 500, 'live'));
  assert.deepEqual(ids(mod.getActiveAlerts()), ['live']);
  assert.deepEqual(ids(seen), ['live'], 'et elle est annoncee, pas seulement affichee');
});

test('une alerte externe sans createdAt n est jamais filtree', async () => {
  const { mod } = await freshClient({});
  mod.raiseExternalAlert({
    id: 'pricingDrift:x', type: 'pricingDrift', sessionId: '', toolName: 'x',
    count: 1, message: 'derive', occurrences: [], tools: [],
  });
  assert.deepEqual(ids(mod.getActiveAlerts()), ['pricingDrift:x']);
});

test('le module ne detecte plus rien', async () => {
  const { mod } = await freshClient({});
  assert.equal(mod.feedEvent, undefined, 'la detection a demenage au serveur');
  assert.equal(mod.setObserving, undefined, 'la cecite du navigateur n a plus d objet');
});

// ─── The second sieve: what only the server knows ─────────────────────────
// `isFresh` answers `true` for every standing alert, by design — a state does
// not go out of date. So freshness alone cannot retire one, and the journal
// cannot either: it is memory, it has no notion of liveness. Only `activeIds`
// can, and these two tests are a pair — the first says the sieve exists, the
// second that it is not simply "hide everything standing".

test('une alerte permanente d hier se tait si le serveur ne la compte plus', async () => {
  const { mod } = await freshClient({
    alerts: [stuck(T - 24 * HOUR, 'stuck:s')],
    activeIds: [],
  });
  assert.deepEqual(mod.getActiveAlerts(), [],
    'une session bloquee hier n est pas une session bloquee');
});

test('une alerte permanente que le serveur compte encore reste affichee, quel que soit son age', async () => {
  const { mod } = await freshClient({
    alerts: [stuck(T - 24 * HOUR, 'stuck:s')],
    activeIds: ['stuck:s'],
  });
  assert.deepEqual(ids(mod.getActiveAlerts()), ['stuck:s'],
    'ce qui dure encore doit se voir, meme vieux d un jour');
});

test('un incident evenementiel perime ne redevient pas vif parce que le serveur le garde en registre', async () => {
  // `loop` et `retryStorm` n ont pas d `isStale` : leur alerte reste au
  // registre du serveur jusqu a l acquittement, donc pour toujours si personne
  // ne clique. Prendre `activeIds` comme une union ferait rougir la pastille a
  // vie sur une boucle finie depuis une heure.
  const { mod } = await freshClient({
    alerts: [evt(T - HOUR, 'loop:s:Bash')],
    activeIds: ['loop:s:Bash'],
  });
  assert.deepEqual(mod.getActiveAlerts(), [],
    'ce qui est fini est fini, quoi que le registre en garde');
});

// ─── Expiry between two polls must turn the badge OFF ─────────────────────

test('une alerte qui expire entre deux chargements est retiree — et l abonne est PREVENU', async () => {
  // Le cas vecu (capture du 2026-08-19) : cloche a « 1 », volet « No active
  // alerts ». La vivacite se juge a l'instant de la lecture, mais la pastille
  // n'est repeinte que sur notification — et l'expiration n'en produisait
  // aucune : au chargement suivant, `before` etait recalcule avec l'horloge
  // COURANTE, donc l'alerte expiree manquait deja des DEUX cotes de la
  // comparaison. Aucun retrait signale, cloche allumee a vie.
  // Arrange — une alerte evenementielle fraiche, affichee
  const { mod, calls, at } = await freshClient({ alerts: [evt(T - 1000, 'a')] });
  assert.deepEqual(ids(mod.getActiveAlerts()), ['a']);
  const repaints = calls.length;
  // Act — trois minutes passent (la fraicheur en accorde deux), le journal n'a pas change
  at(T + 3 * 60_000);
  await mod.refreshAlerts();
  // Assert — l'etat reel est vide, et l'interface doit l'apprendre
  assert.deepEqual(mod.getActiveAlerts(), []);
  assert.ok(calls.length > repaints,
    'le retrait par expiration est un changement : sans notification, la cloche reste allumee a tort');
});

// ─── Same identity, several incidents ─────────────────────────────────────

test('de deux incidents de meme identite, c est le plus recent qui parle', async () => {
  // Le journal garde les deux : l identite d une alerte est `id`, sa cle est
  // (id, createdAt). `readAll` les rend du plus recent au plus ancien.
  const recent = evt(T - 1000, 'loop:s:Bash');
  const vieux = evt(T - HOUR, 'loop:s:Bash');
  const { mod } = await freshClient({ alerts: [recent, vieux] });
  assert.deepEqual(mod.getActiveAlerts().map(a => a.createdAt), [T - 1000],
    'la boucle en cours ne doit pas etre effacee par celle d il y a une heure');

  // Controle negatif : la reponse ne doit pas dependre de l ordre de la liste.
  const { mod: inverse } = await freshClient({ alerts: [vieux, recent] });
  assert.deepEqual(inverse.getActiveAlerts().map(a => a.createdAt), [T - 1000],
    'et pas davantage dans l autre sens');
});

// ─── The announce path ────────────────────────────────────────────────────
// Everything below guards the same failure: a desktop notification fired once
// per poll. The panel can afford to re-render; the operating system toast
// cannot afford to repeat.

test('un rechargement ne re-annonce pas ce qui est deja affiche', async () => {
  const { mod, seen } = await freshClient({ alerts: [evt(T - 1000, 'a')] });
  await mod.refreshAlerts();
  await mod.refreshAlerts();
  assert.deepEqual(seen, [], 'la meme alerte relue n est pas une nouvelle alerte');
});

test('une alerte externe n est pas re-annoncee a chaque rechargement', async () => {
  const { mod, seen } = await freshClient({});
  mod.raiseExternalAlert({
    id: 'pricingDrift:x', type: 'pricingDrift', sessionId: '', toolName: 'x',
    count: 1, message: 'derive', occurrences: [], tools: [],
  });
  seen.length = 0;                       // la levee elle-meme a le droit de sonner
  await mod.refreshAlerts();
  await mod.refreshAlerts();
  assert.deepEqual(seen, [],
    'la vigie tarifaire ne vient pas du journal : elle n y reapparait jamais');
  assert.deepEqual(ids(mod.getActiveAlerts()), ['pricingDrift:x'],
    'controle positif : elle est toujours affichee');
});

test('le retrait d une alerte previent quand meme l interface', async () => {
  // La SEULE voie qui ETEINT la pastille. Un retrait ne porte aucune alerte —
  // le serveur a cesse de compter un `stuck`, ou un autre onglet vient de
  // l acquitter — donc n avertir que sur `raised.length` laisserait l alerte
  // affichee jusqu a ce qu autre chose bouge. C est ce que gardait le
  // commentaire de l ancienne boucle de battement, retire avec elle.
  const { mod, journal, calls } = await freshClient({ alerts: [evt(T - 1000, 'a')] });
  assert.deepEqual(ids(mod.getActiveAlerts()), ['a'], 'controle positif : elle est la');
  journal.alerts = [];
  await mod.refreshAlerts();
  assert.equal(calls.length, 1, 'l interface doit apprendre que la pastille s eteint');
  assert.deepEqual(calls[0], [], 'et ce changement n annonce rien : rien n est arrive');
  assert.deepEqual(mod.getActiveAlerts(), []);
});

test('le premier chargement montre, il n annonce pas', async () => {
  // `before` est vide au chargement, donc tout le vif y passerait pour du
  // nouveau. Une alerte permanente encore vraie sonnerait a CHAQUE F5 : la
  // notification bureau est faite pour ce qui SURVIENT pendant qu on regarde
  // ailleurs, la pastille rouge suffit a qui vient d ouvrir la page.
  const mod = await import(`../../src/web/viz-watchdog-client.js?t=${T}-premier-${Math.random()}`);
  const calls = [];
  mod.onAlertsChanged(a => calls.push(a));
  await mod.initAlertReader({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ alerts: [stuck(T - 20 * 60_000, 'stuck:s')], activeIds: ['stuck:s'] }),
    }),
    now: () => T,
  });
  assert.deepEqual(calls, [[]], 'l interface est prevenue, personne n est reveille');
  assert.deepEqual(ids(mod.getActiveAlerts()), ['stuck:s'],
    'controle positif : la pastille rougit quand meme');
});

test('un incident nouveau sous une identite deja connue est bien annonce', async () => {
  // Controle positif de la deduplication ci-dessus : deduire de l `id` seul
  // rendrait muet le deuxieme episode d une meme boucle.
  const { mod, journal, seen } = await freshClient({ alerts: [evt(T - 1000, 'loop:s:Bash')] });
  journal.alerts = [evt(T - 500, 'loop:s:Bash')];
  await mod.refreshAlerts();
  assert.deepEqual(seen.map(a => a.createdAt), [T - 500],
    'une nouvelle boucle sous le meme nom reste une nouvelle boucle');
});

test('le flux n annonce pas un incident deja perime', async () => {
  // Le serveur diffuse ce qu il consigne, y compris une alerte nee d un
  // evenement ancien lu en direct. La consigner ici, oui ; la crier, non.
  const { mod, seen } = await freshClient({});
  mod.applyServerAlert(evt(T - HOUR, 'vieux'));
  assert.deepEqual(seen, [], 'rien ne doit sonner pour ce qui est fini');
  assert.deepEqual(mod.getActiveAlerts(), [], 'ni s afficher');
});

test('le flux marque l identite comme vive, donc une alerte permanente s affiche aussitot', async () => {
  // `activeIds` vient de GET /alerts, qui ne repasse que toutes les 30 s. Sans
  // ce marquage, un `stuck` pousse par le flux resterait invisible jusqu au
  // prochain chargement — le direct que ce chemin existe pour servir.
  const { mod, seen } = await freshClient({});
  mod.applyServerAlert(stuck(T - 4 * 60_000, 'stuck:s'));
  assert.deepEqual(ids(mod.getActiveAlerts()), ['stuck:s']);
  assert.deepEqual(ids(seen), ['stuck:s']);
});

test('un rappel du flux ne remplace pas un incident plus recent par un plus ancien', async () => {
  const { mod } = await freshClient({ alerts: [evt(T - 1000, 'loop:s:Bash')] });
  mod.applyServerAlert(evt(T - HOUR, 'loop:s:Bash'));
  assert.deepEqual(mod.getActiveAlerts().map(a => a.createdAt), [T - 1000],
    'ce qui est deja connu de plus recent fait autorite');
});

// ─── Acknowledgement ──────────────────────────────────────────────────────

test('acquitter poste la paire au serveur et retire l alerte', async () => {
  const { mod, posts } = await freshClient({ alerts: [evt(T - 1000, 'a')] });
  await mod.acknowledgeAlert('a', T - 1000);
  assert.deepEqual(posts.map(p => p.body), [{ id: 'a', createdAt: T - 1000 }],
    'la cle du journal est la paire, pas le seul identifiant');
  assert.equal(posts[0].method, 'POST');
  assert.deepEqual(mod.getActiveAlerts(), []);
});

test('on acquitte l incident affiche, pas celui qui vient d arriver', async () => {
  // Un incident plus recent sous le meme id a pu atterrir entre le rendu et le
  // clic. Envoyer ce que le module TIENT acquitterait celui que personne n a
  // lu, et laisserait au journal, non acquitte, celui que l utilisateur
  // regardait — donc visible pour toujours dans le bloc Pannes.
  const { mod, posts } = await freshClient({ alerts: [evt(T - 1000, 'loop:s:Bash')] });
  await mod.acknowledgeAlert('loop:s:Bash', T - 30_000);
  assert.deepEqual(posts.map(p => p.body), [{ id: 'loop:s:Bash', createdAt: T - 30_000 }],
    'la moitie de la cle qui dit LEQUEL vient de l appelant');
  assert.deepEqual(mod.getActiveAlerts().map(a => a.createdAt), [T - 1000],
    'et le plus recent, jamais vu, reste a l ecran');
});

test('un createdAt inutilisable retombe sur celui du journal', async () => {
  // Le panneau reconstruit cette valeur depuis un attribut du DOM. Envoyer un
  // NaN ferait refuser la route (400) et le geste de l utilisateur serait
  // perdu ; le journal, lui, nous a donne une valeur sure.
  const { mod, posts } = await freshClient({ alerts: [evt(T - 1000, 'a')] });
  await mod.acknowledgeAlert('a', Number('pas un nombre'));
  assert.deepEqual(posts.map(p => p.body), [{ id: 'a', createdAt: T - 1000 }]);
  assert.deepEqual(mod.getActiveAlerts(), [], 'controle positif : l acquittement a bien eu lieu');
});

test('un acquittement refuse par le serveur ne fait pas disparaitre l alerte', async () => {
  // 503 : le port est servi avant que le chien de garde existe, la fenetre est
  // reelle. Rien n a ete consigne — laisser la pastille eteinte ferait revenir
  // l alerte au rechargement sans que personne ne l ait vue partir.
  const { mod } = await freshClient({
    alerts: [evt(T - 1000, 'a')],
    ack: async () => ({ ok: false, status: 503, json: async () => ({ error: 'indisponible' }) }),
  });
  await mod.acknowledgeAlert('a', T - 1000);
  assert.deepEqual(ids(mod.getActiveAlerts()), ['a'],
    'ce que le disque ignore, la pastille ne doit pas le taire');
});

test('un acquittement perdu en route ne fait pas disparaitre l alerte non plus', async () => {
  const { mod } = await freshClient({
    alerts: [evt(T - 1000, 'a')],
    ack: () => { throw new Error('reseau coupe'); },
  });
  await mod.acknowledgeAlert('a', T - 1000);
  assert.deepEqual(ids(mod.getActiveAlerts()), ['a']);
});

test('une alerte permanente refusee a l acquittement redevient visible', async () => {
  // Cas separe : la vivacite d une alerte permanente ne tient pas a sa
  // fraicheur mais a `activeIds`. Remettre l alerte sans remettre son identite
  // dans le vif la rendrait invisible malgre le refus.
  const { mod } = await freshClient({
    alerts: [stuck(T - 24 * HOUR, 'stuck:s')],
    activeIds: ['stuck:s'],
    ack: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  await mod.acknowledgeAlert('stuck:s', T - 24 * HOUR);
  assert.deepEqual(ids(mod.getActiveAlerts()), ['stuck:s']);
});

test('on ne poste jamais une clef qu on n a pas recue', async () => {
  // La route valide la FORME de la clef, pas son existence : un identifiant
  // bien forme mais inconnu ecrit une ligne definitive qui n acquitte rien, et
  // les acquittements ne sont pas dedupliques.
  const { mod, posts } = await freshClient({ alerts: [evt(T - 1000, 'a')] });
  await mod.acknowledgeAlert('jamais-vue', T - 1000);
  assert.deepEqual(posts, [], 'le journal ne doit pas garder trace d un geste sans objet');
  assert.deepEqual(ids(mod.getActiveAlerts()), ['a'], 'controle positif : rien d autre n a bouge');
});

test('acquitter une alerte externe ne poste rien au journal', async () => {
  // La vigie tarifaire ne vient pas du journal du serveur : il n a rien a y
  // acquitter, et la clef n y existe pas.
  const { mod, posts } = await freshClient({});
  mod.raiseExternalAlert({
    id: 'pricingDrift:x', type: 'pricingDrift', sessionId: '', toolName: 'x',
    count: 1, message: 'derive', occurrences: [], tools: [],
  });
  await mod.acknowledgeAlert('pricingDrift:x');
  assert.deepEqual(posts, []);
  assert.deepEqual(mod.getActiveAlerts(), []);
});

// ─── The server going quiet ───────────────────────────────────────────────

test('un serveur muet ne fait pas tomber la pastille', async () => {
  const mod = await import(`../../src/web/viz-watchdog-client.js?t=${T}-muet-${Math.random()}`);
  await mod.initAlertReader({
    fetchImpl: async () => { throw new Error('connexion refusee'); },
    now: () => T,
  });
  assert.deepEqual(mod.getActiveAlerts(), []);
});

test('un serveur qui repond n importe quoi ne casse pas la pastille', async () => {
  // 200 avec une charge hors contrat. `for...of` sur un nombre et `new Set`
  // d un nombre levent tous les deux, et personne n attend cette promesse :
  // le rejet ne serait rattrape par rien, et le rafraichissement periodique
  // s arreterait la, sans un mot.
  const mod = await import(`../../src/web/viz-watchdog-client.js?t=${T}-charge-${Math.random()}`);
  await mod.initAlertReader({
    fetchImpl: async () => ({ ok: true, json: async () => ({ alerts: 5, activeIds: 7 }) }),
    now: () => T,
  });
  assert.deepEqual(mod.getActiveAlerts(), []);
});

test('une entree hors forme dans le journal ne casse pas la lecture', async () => {
  // La garde par TABLEAU ne protege pas de ce qu il y a DEDANS. `null.id` leve,
  // et personne n attend cette promesse : meme panne muette qu une charge hors
  // contrat, une case plus bas. Une entree sans identifiant est aussi
  // inutilisable — c est la moitie de la cle du journal.
  const { mod } = await freshClient({
    alerts: [null, evt(T - 1000, 'a'), { createdAt: T - 1000 }, undefined],
  });
  assert.deepEqual(ids(mod.getActiveAlerts()), ['a'],
    'on saute ce qu on ne sait pas lire, on lit le reste');
});

test('un rechargement en echec laisse la pastille sur ce qu elle savait', async () => {
  const { mod } = await freshClient({ alerts: [evt(T - 1000, 'a')] });
  assert.deepEqual(ids(mod.getActiveAlerts()), ['a'], 'controle positif : elle le savait');
  // Le serveur repond, mais pas 200 : une lecture ratee n est pas la preuve
  // que tout va bien. Vider la liste ferait passer une panne de lecture pour
  // un retour au calme.
  await mod.initAlertReader({ fetchImpl: async () => ({ ok: false, status: 500 }), now: () => T });
  assert.deepEqual(ids(mod.getActiveAlerts()), ['a']);
});

test('un 200 dont le corps est illisible laisse aussi la pastille sur ce qu elle savait', async () => {
  // Arrange — meme principe que le test precedent, sur l autre facon d echouer :
  // le statut dit oui, le corps n est pas du JSON. Un client HTTP partage rend
  // volontiers `null` dans ce cas ; le prendre pour un journal vide viderait la
  // pastille, c est-a-dire ferait passer une lecture ratee pour un retour au
  // calme. Cas non couvert avant C6, et c est celui que la mise en commun
  // pouvait casser en silence.
  const { mod } = await freshClient({ alerts: [evt(T - 1000, 'a')] });
  assert.deepEqual(ids(mod.getActiveAlerts()), ['a'], 'controle positif : elle le savait');

  // Act
  await mod.initAlertReader({
    fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } }),
    now: () => T,
  });

  // Assert
  assert.deepEqual(ids(mod.getActiveAlerts()), ['a']);
});
