// The badge detects nothing: the server does, and it remembers.
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
// These tests pin that split, and the traps in it: an external alert (the
// pricing vigil) is current by construction, whatever its age, and must never
// be filtered away; an acknowledgement that the server refused must not leave
// the badge quiet about an alert that is coming back.
//
// Nothing here touches the real journal, the real home directory or the real
// event folder: the module is a pure reader over an injected fetch.

import { expect, test } from 'vitest';
import { pricingDriftAlert } from '../../src/web/viz-pricing-drift-alert.ts';
import type { LiveAlert } from '../../src/web/viz-watchdog-client.ts';

const T = 1_700_000_000_000;
const HOUR = 3_600_000;

// The full alert shape, as the journal serves it back: a line missing a field
// does not get past the browser's entry check.
const evt = (createdAt: number, id: string, extra: Partial<LiveAlert> = {}): LiveAlert => ({
  id, type: 'loop', sessionId: 's', agentId: '', agentType: '', toolName: 'Bash',
  count: 4, createdAt, message: 'x', subject: 'npm run build',
  occurrences: [], tools: [], cwd: 'f:\\p', standing: false, patternId: '',
  acknowledged: false, ...extra,
});
// A state, not a moment: no expiry of its own, liveness comes from the server.
const stuck = (createdAt: number, id: string): LiveAlert => evt(createdAt, id, {
  type: 'stuck', toolName: '', standing: true, message: 'No event since 16:22',
});
// The pricing vigil's alert, built by the same factory as the tab's.
const drift = (model: string) => pricingDriftAlert({ model, kind: 'tarif-different' }, 1);

// One module instance per test: the reader's state is a module singleton.
// The journal object stays mutable so a test can change what the next
// GET /alerts answers.
async function freshClient({ alerts = [], activeIds = [], now = T, ack }: {
  alerts?: (LiveAlert | null | undefined | { createdAt: number })[];
  activeIds?: string[];
  now?: number;
  ack?: any;
} = {}) {
  const journal = { alerts, activeIds };
  const posts: any[] = [];
  let clock = now;
  const fetchImpl = async (url: string, opts: any) => {
    if (String(url).startsWith('/alerts/ack')) {
      posts.push({ body: JSON.parse(opts.body), method: opts.method });
      if (typeof ack === 'function') return ack();
      return ack ?? { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({ alerts: journal.alerts, activeIds: journal.activeIds }) };
  };
  const mod = await import(`../../src/web/viz-watchdog-client.ts?t=${T}-${Math.random().toString(36).slice(2)}`);
  await mod.initAlertReader({ fetchImpl, now: () => clock });
  // Two different things, and the difference matters. `seen` is what gets
  // ANNOUNCED — the signal the desktop notification hangs off. `calls` is how
  // many times the interface was told to re-render at all, which is the only
  // thing that can carry a WITHDRAWAL: an alert leaving carries no alert.
  const seen: LiveAlert[] = [];
  const calls: LiveAlert[][] = [];
  mod.onAlertsChanged((a: LiveAlert[]) => { calls.push(a); seen.push(...a); });
  return { mod, journal, posts, seen, calls, at(ms: number) { clock = ms; } };
}

const ids = (list: LiveAlert[]) => list.map(a => a.id);

// ─── The freshness sieve on the event path ────────────────────────────────

test('la pastille montre ce que le serveur a vu recemment', async () => {
  const { mod } = await freshClient({ alerts: [evt(T - 1000, 'a'), evt(T - HOUR, 'b')] });
  expect(ids(mod.getActiveAlerts()), 'le journal contient l heure passee, la pastille ne la crie pas').toEqual(['a']);
});

test('une alerte acquittee cote serveur ne revient pas', async () => {
  const acked = evt(T - 1000, 'a', { acknowledged: true });
  const { mod } = await freshClient({ alerts: [acked] });
  expect(mod.getActiveAlerts()).toEqual([]);
});

test('une alerte poussee par le flux apparait sans attendre le prochain chargement', async () => {
  const { mod, seen } = await freshClient({});
  mod.applyServerAlert(evt(T - 500, 'live'));
  expect(ids(mod.getActiveAlerts())).toEqual(['live']);
  expect(ids(seen), 'et elle est annoncee, pas seulement affichee').toEqual(['live']);
});

test('une alerte externe vieille de dix minutes reste affichée : ni l\'âge ni activeIds ne la filtrent', async () => {
  // Arrange — l'horloge du lecteur est à T, bien au-delà de la fraîcheur, et
  // le serveur ne compte aucune alerte vive
  const { mod } = await freshClient({});
  // Act
  mod.raiseExternalAlert(pricingDriftAlert({ model: 'x', kind: 'modele-nouveau' }, T - 10 * 60_000));
  // Assert
  expect(ids(mod.getActiveAlerts())).toEqual(['pricingDrift:x']);
});

test('le module n expose ni feedEvent ni setObserving', async () => {
  const { mod } = await freshClient({});
  expect(mod.feedEvent, 'la detection vit au serveur').toBe(undefined);
  expect(mod.setObserving, 'l observation ne se pilote pas depuis le navigateur').toBe(undefined);
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
  expect(mod.getActiveAlerts(), 'une session bloquee hier n est pas une session bloquee').toEqual([]);
});

test('une alerte permanente que le serveur compte encore reste affichee, quel que soit son age', async () => {
  const { mod } = await freshClient({
    alerts: [stuck(T - 24 * HOUR, 'stuck:s')],
    activeIds: ['stuck:s'],
  });
  expect(ids(mod.getActiveAlerts()), 'ce qui dure encore doit se voir, meme vieux d un jour').toEqual(['stuck:s']);
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
  expect(mod.getActiveAlerts(), 'ce qui est fini est fini, quoi que le registre en garde').toEqual([]);
});

// ─── Expiry between two polls must turn the badge OFF ─────────────────────

test('une alerte qui expire entre deux chargements est retiree — et l abonne est PREVENU', async () => {
  // Le symptome : cloche a « 1 », volet « No active alerts ». La pastille n'est repeinte que
  // sur notification ; un `before` recalcule avec l'horloge COURANTE perdait l'alerte expiree
  // des DEUX cotes de la comparaison, et aucun retrait n'etait signale.
  // Arrange — une alerte evenementielle fraiche, affichee
  const { mod, calls, at } = await freshClient({ alerts: [evt(T - 1000, 'a')] });
  expect(ids(mod.getActiveAlerts())).toEqual(['a']);
  const repaints = calls.length;
  // Act — trois minutes passent (la fraicheur en accorde deux), le journal n'a pas change
  at(T + 3 * 60_000);
  await mod.refreshAlerts();
  // Assert — l'etat reel est vide, et l'interface doit l'apprendre
  expect(mod.getActiveAlerts()).toEqual([]);
  expect(calls.length > repaints, 'le retrait par expiration est un changement : sans notification, la cloche reste allumee a tort').toBeTruthy();
});

// ─── Same identity, several incidents ─────────────────────────────────────

test('de deux incidents de meme identite, c est le plus recent qui parle', async () => {
  // Le journal garde les deux : l identite d une alerte est `id`, sa cle est
  // (id, createdAt). `readAll` les rend du plus recent au plus ancien.
  const recent = evt(T - 1000, 'loop:s:Bash');
  const vieux = evt(T - HOUR, 'loop:s:Bash');
  const { mod } = await freshClient({ alerts: [recent, vieux] });
  expect(mod.getActiveAlerts().map((a: LiveAlert) => a.createdAt), 'la boucle en cours ne doit pas etre effacee par celle d il y a une heure').toEqual([T - 1000]);

  // Controle negatif : la reponse ne doit pas dependre de l ordre de la liste.
  const { mod: inverse } = await freshClient({ alerts: [vieux, recent] });
  expect(inverse.getActiveAlerts().map((a: LiveAlert) => a.createdAt), 'et pas davantage dans l autre sens').toEqual([T - 1000]);
});

// ─── The announce path ────────────────────────────────────────────────────
// Everything below guards the same failure: a desktop notification fired once
// per poll. The panel can afford to re-render; the operating system toast
// cannot afford to repeat.

test('un rechargement ne re-annonce pas ce qui est deja affiche', async () => {
  const { mod, seen } = await freshClient({ alerts: [evt(T - 1000, 'a')] });
  await mod.refreshAlerts();
  await mod.refreshAlerts();
  expect(seen, 'la meme alerte relue n est pas une nouvelle alerte').toEqual([]);
});

test('une alerte externe n est pas re-annoncee a chaque rechargement', async () => {
  const { mod, seen } = await freshClient({});
  mod.raiseExternalAlert(drift('x'));
  seen.length = 0;                       // la levee elle-meme a le droit de sonner
  await mod.refreshAlerts();
  await mod.refreshAlerts();
  expect(seen, 'la vigie tarifaire ne vient pas du journal : elle n y reapparait jamais').toEqual([]);
  expect(ids(mod.getActiveAlerts()), 'controle positif : elle est toujours affichee').toEqual(['pricingDrift:x']);
});

test('le retrait d une alerte previent quand meme l interface', async () => {
  // La SEULE voie qui ETEINT la pastille. Un retrait ne porte aucune alerte — le serveur a
  // cesse de compter un `stuck`, ou un autre onglet vient de l acquitter — donc n avertir que
  // sur `raised.length` laisserait l alerte affichee jusqu a ce qu autre chose bouge.
  const { mod, journal, calls } = await freshClient({ alerts: [evt(T - 1000, 'a')] });
  expect(ids(mod.getActiveAlerts()), 'controle positif : elle est la').toEqual(['a']);
  journal.alerts = [];
  await mod.refreshAlerts();
  expect(calls.length, 'l interface doit apprendre que la pastille s eteint').toBe(1);
  expect(calls[0], 'et ce changement n annonce rien : rien n est arrive').toEqual([]);
  expect(mod.getActiveAlerts()).toEqual([]);
});

test('le premier chargement montre, il n annonce pas', async () => {
  // `before` est vide au chargement, donc tout le vif y passerait pour du
  // nouveau. Une alerte permanente encore vraie sonnerait a CHAQUE F5 : la
  // notification bureau est faite pour ce qui SURVIENT pendant qu on regarde
  // ailleurs, la pastille rouge suffit a qui vient d ouvrir la page.
  const mod = await import(`../../src/web/viz-watchdog-client.ts?t=${T}-premier-${Math.random().toString(36).slice(2)}`);
  const calls: LiveAlert[][] = [];
  mod.onAlertsChanged((a: LiveAlert[]) => calls.push(a));
  await mod.initAlertReader({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ alerts: [stuck(T - 20 * 60_000, 'stuck:s')], activeIds: ['stuck:s'] }),
    }),
    now: () => T,
  });
  expect(calls, 'l interface est prevenue, personne n est reveille').toEqual([[]]);
  expect(ids(mod.getActiveAlerts()), 'controle positif : la pastille rougit quand meme').toEqual(['stuck:s']);
});

test('un incident nouveau sous une identite deja connue est bien annonce', async () => {
  // Controle positif de la deduplication ci-dessus : deduire de l `id` seul
  // rendrait muet le deuxieme episode d une meme boucle.
  const { mod, journal, seen } = await freshClient({ alerts: [evt(T - 1000, 'loop:s:Bash')] });
  journal.alerts = [evt(T - 500, 'loop:s:Bash')];
  await mod.refreshAlerts();
  expect(seen.map(a => a.createdAt), 'une nouvelle boucle sous le meme nom reste une nouvelle boucle').toEqual([T - 500]);
});

test('le flux n annonce pas un incident deja perime', async () => {
  // Le serveur diffuse ce qu il consigne, y compris une alerte nee d un
  // evenement ancien lu en direct. La consigner ici, oui ; la crier, non.
  const { mod, seen } = await freshClient({});
  mod.applyServerAlert(evt(T - HOUR, 'vieux'));
  expect(seen, 'rien ne doit sonner pour ce qui est fini').toEqual([]);
  expect(mod.getActiveAlerts(), 'ni s afficher').toEqual([]);
});

test('le flux marque l identite comme vive, donc une alerte permanente s affiche aussitot', async () => {
  // `activeIds` vient de GET /alerts, qui ne repasse que toutes les 30 s. Sans
  // ce marquage, un `stuck` pousse par le flux resterait invisible jusqu au
  // prochain chargement — le direct que ce chemin existe pour servir.
  const { mod, seen } = await freshClient({});
  mod.applyServerAlert(stuck(T - 4 * 60_000, 'stuck:s'));
  expect(ids(mod.getActiveAlerts())).toEqual(['stuck:s']);
  expect(ids(seen)).toEqual(['stuck:s']);
});

test('un rappel du flux ne remplace pas un incident plus recent par un plus ancien', async () => {
  const { mod } = await freshClient({ alerts: [evt(T - 1000, 'loop:s:Bash')] });
  mod.applyServerAlert(evt(T - HOUR, 'loop:s:Bash'));
  expect(mod.getActiveAlerts().map((a: LiveAlert) => a.createdAt), 'ce qui est deja connu de plus recent fait autorite').toEqual([T - 1000]);
});

// ─── Acknowledgement ──────────────────────────────────────────────────────

test('acquitter poste la paire au serveur et retire l alerte', async () => {
  const { mod, posts } = await freshClient({ alerts: [evt(T - 1000, 'a')] });
  await mod.acknowledgeAlert('a', T - 1000);
  expect(posts.map(p => p.body), 'la cle du journal est la paire, pas le seul identifiant').toEqual([{ id: 'a', createdAt: T - 1000 }]);
  expect(posts[0].method).toBe('POST');
  expect(mod.getActiveAlerts()).toEqual([]);
});

test('on acquitte l incident affiche, pas celui qui vient d arriver', async () => {
  // Un incident plus recent sous le meme id a pu atterrir entre le rendu et le
  // clic. Envoyer ce que le module TIENT acquitterait celui que personne n a
  // lu, et laisserait au journal, non acquitte, celui que l utilisateur
  // regardait — donc visible pour toujours dans le bloc Pannes.
  const { mod, posts } = await freshClient({ alerts: [evt(T - 1000, 'loop:s:Bash')] });
  await mod.acknowledgeAlert('loop:s:Bash', T - 30_000);
  expect(posts.map(p => p.body), 'la moitie de la cle qui dit LEQUEL vient de l appelant').toEqual([{ id: 'loop:s:Bash', createdAt: T - 30_000 }]);
  expect(mod.getActiveAlerts().map((a: LiveAlert) => a.createdAt), 'et le plus recent, jamais vu, reste a l ecran').toEqual([T - 1000]);
});

test('un createdAt inutilisable retombe sur celui du journal', async () => {
  // Le panneau reconstruit cette valeur depuis un attribut du DOM. Envoyer un
  // NaN ferait refuser la route (400) et le geste de l utilisateur serait
  // perdu ; le journal, lui, nous a donne une valeur sure.
  const { mod, posts } = await freshClient({ alerts: [evt(T - 1000, 'a')] });
  await mod.acknowledgeAlert('a', Number('pas un nombre'));
  expect(posts.map(p => p.body)).toEqual([{ id: 'a', createdAt: T - 1000 }]);
  expect(mod.getActiveAlerts(), 'controle positif : l acquittement a bien eu lieu').toEqual([]);
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
  expect(ids(mod.getActiveAlerts()), 'ce que le disque ignore, la pastille ne doit pas le taire').toEqual(['a']);
});

test('un acquittement perdu en route ne fait pas disparaitre l alerte non plus', async () => {
  const { mod } = await freshClient({
    alerts: [evt(T - 1000, 'a')],
    ack: () => { throw new Error('reseau coupe'); },
  });
  await mod.acknowledgeAlert('a', T - 1000);
  expect(ids(mod.getActiveAlerts())).toEqual(['a']);
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
  expect(ids(mod.getActiveAlerts())).toEqual(['stuck:s']);
});

test('on ne poste jamais une clef qu on n a pas recue', async () => {
  // La route valide la FORME de la clef, pas son existence : un identifiant
  // bien forme mais inconnu ecrit une ligne definitive qui n acquitte rien, et
  // les acquittements ne sont pas dedupliques.
  const { mod, posts } = await freshClient({ alerts: [evt(T - 1000, 'a')] });
  await mod.acknowledgeAlert('jamais-vue', T - 1000);
  expect(posts, 'le journal ne doit pas garder trace d un geste sans objet').toEqual([]);
  expect(ids(mod.getActiveAlerts()), 'controle positif : rien d autre n a bouge').toEqual(['a']);
});

test('acquitter une alerte externe ne poste rien au journal', async () => {
  // La vigie tarifaire ne vient pas du journal du serveur : il n a rien a y
  // acquitter, et la clef n y existe pas.
  const { mod, posts } = await freshClient({});
  mod.raiseExternalAlert(drift('x'));
  await mod.acknowledgeAlert('pricingDrift:x');
  expect(posts).toEqual([]);
  expect(mod.getActiveAlerts()).toEqual([]);
});

// ─── The server going quiet ───────────────────────────────────────────────

test('un serveur muet ne fait pas tomber la pastille', async () => {
  const mod = await import(`../../src/web/viz-watchdog-client.ts?t=${T}-muet-${Math.random().toString(36).slice(2)}`);
  await mod.initAlertReader({
    fetchImpl: async () => { throw new Error('connexion refusee'); },
    now: () => T,
  });
  expect(mod.getActiveAlerts()).toEqual([]);
});

test('un serveur qui repond n importe quoi ne casse pas la pastille', async () => {
  // 200 avec une charge hors contrat. Le module de forme leve, et la lecture
  // compte comme ratee : personne n attend cette promesse, un rejet non
  // rattrape arreterait le rafraichissement periodique sans un mot.
  const mod = await import(`../../src/web/viz-watchdog-client.ts?t=${T}-charge-${Math.random().toString(36).slice(2)}`);
  await mod.initAlertReader({
    fetchImpl: async () => ({ ok: true, json: async () => ({ alerts: 5, activeIds: 7 }) }),
    now: () => T,
  });
  expect(mod.getActiveAlerts()).toEqual([]);
});

test('une entree hors forme dans le journal ne casse pas la lecture', async () => {
  // Le module de forme lit chaque ligne : `null`, `undefined` et une ligne
  // sans ses champs sont ecartes, le reste du journal est lu. Une entree sans
  // identifiant est inutilisable — c est la moitie de la cle du journal.
  const { mod } = await freshClient({
    alerts: [null, evt(T - 1000, 'a'), { createdAt: T - 1000 }, undefined],
  });
  expect(ids(mod.getActiveAlerts()), 'on saute ce qu on ne sait pas lire, on lit le reste').toEqual(['a']);
});

test('un rechargement en echec laisse la pastille sur ce qu elle savait', async () => {
  const { mod } = await freshClient({ alerts: [evt(T - 1000, 'a')] });
  expect(ids(mod.getActiveAlerts()), 'controle positif : elle le savait').toEqual(['a']);
  // Le serveur repond, mais pas 200 : une lecture ratee n est pas la preuve
  // que tout va bien. Vider la liste ferait passer une panne de lecture pour
  // un retour au calme.
  await mod.initAlertReader({ fetchImpl: async () => ({ ok: false, status: 500 }), now: () => T });
  expect(ids(mod.getActiveAlerts())).toEqual(['a']);
});

test('un 200 dont le corps est illisible laisse aussi la pastille sur ce qu elle savait', async () => {
  // Arrange — l autre facon d echouer : le statut dit oui, le corps n est pas du JSON, et le
  // client HTTP partage rend alors `null`. Le prendre pour un journal vide ferait passer une
  // lecture ratee pour un retour au calme.
  const { mod } = await freshClient({ alerts: [evt(T - 1000, 'a')] });
  expect(ids(mod.getActiveAlerts()), 'controle positif : elle le savait').toEqual(['a']);

  // Act
  await mod.initAlertReader({
    fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } }),
    now: () => T,
  });

  // Assert
  expect(ids(mod.getActiveAlerts())).toEqual(['a']);
});
