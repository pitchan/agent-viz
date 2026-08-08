// Tests unitaires du quatrieme detecteur : « l'agent n'a pas su appeler la
// commande ».
//
// Les trois premiers detecteurs regardent la FORME du flux — la meme entree
// quatre fois, trois echecs d'affilee, plus rien depuis trois minutes. Celui-ci
// est le seul qui lit le TEXTE de l'echec, et il pose une question differente :
// non pas « cet outil echoue-t-il en boucle » mais « cet appel a-t-il echoue a
// cause de la FACON dont il a ete ecrit ». Un chemin Windows avale par un shell
// POSIX, une cmdlet PowerShell lancee sous bash : des choses que l'utilisateur
// regle une fois et ne revoit plus.
//
// Ce que ces tests figent, et qui ne se voit nulle part ailleurs :
//   - le FILTRE est unique et c'est `workstationSetting`. Les autres motifs
//     sont reconnus pour etre EXCLUS, pas pour etre dits ;
//   - l'interruption humaine sort AVANT toute autre logique, comme chez `loop`
//     et `retryStorm` ;
//   - l'identite porte l'acteur ET le motif, jamais l'outil : deux sous-agents
//     butant sur le meme reglage sont deux faits, et le meme reglage manquant
//     n'est qu'une alerte ;
//   - AUCUN texte ne sort : ni la commande, ni le message d'erreur, ni un
//     extrait. Seul l'identifiant du motif.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWatchdog } from '../../public/viz-watchdog.mjs';

const T = 1_700_000_000_000;
const SID = 'sid1';
const iso = ms => new Date(ms).toISOString();

// Echantillons repris du releve (doc/27-calibration-invocation.md), caviardes.
// Ce ne sont pas des messages inventes.

// L'incident du 5 aout : trois sous-agents de la meme session butant a quelques
// minutes d'intervalle sur `cd F:\DEV\… && …` sous l'outil Bash.
const CHEMIN_WINDOWS =
  'Exit code 1 /usr/bin/bash: line 1: cd: D:dvf-postgis-pipelinefrontend: No such file or directory';

// Un second reglage du poste, pour verifier que deux motifs distincts du meme
// acteur font deux alertes. Cause A du releve doc/30 : un chemin de dossier
// termine par un antislash, que le shell POSIX lit comme un guillemet echappe.
// 11 occurrences.
const ANTISLASH_FINAL =
  'Exit code 2 /usr/bin/bash: eval: line 1: unexpected EOF while looking for matching `"\'';

// Cause B du meme releve : un heredoc de 8 a 15 Ko. 8 occurrences, et
// 9 commandes sur 9 au-dela de 8 Ko en echec dans tout l'historique.
const HEREDOC_TROP_GROS =
  "Exit code 2 /usr/bin/bash: -c: line 149: unexpected EOF while looking for matching `''";

// Le meme message SANS aucune des deux ancres — le scenario « le harnais a
// change sa facon d'appeler le shell ». Il doit SONNER : un motif muet ne
// compte pas non plus, le filtre du detecteur rendant null avant le compteur.
const QUOTE_SANS_ANCRE =
  'Exit code 2 /usr/bin/bash: line 42: unexpected EOF while looking for matching `"\'';

// Invocation reconnue, mais PAS un reglage du poste : une cmdlet PowerShell
// sous bash ne se distinguait d'un binaire absent que par la CASSE du nom
// (`Docker-Compose` sonnait, `docker-compose` se taisait — le meme echec). 1
// occurrence en 90 jours contre 51 pour le binaire absent : classee POUR ETRE
// EXCLUE, jamais dite — et pas comptee non plus. Se taire est ici le bon
// comportement : un binaire absent n a pas de reglage de poste.
const CMDLET_SOUS_BASH =
  'Exit code 127 /usr/bin/bash: line 1: Select-String: command not found';

// Invocation, mais PAS un reglage du poste : l'instruction existe deja dans la
// description de l'outil, relue a chaque tour. Reconnu pour etre exclu.
const LECTURE_AVANT_ECRITURE =
  '<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>';

// Verdict : la commande a tourne et a dit non. C'est le travail normal, et
// c'est 36 % des echecs du releve.
const VERDICT_NPM = 'npm ERR! code ELIFECYCLE\nnpm ERR! errno 1';

function echec({
  at = T, session = SID, tool = 'Bash', error = CHEMIN_WINDOWS,
  id = 't1', agentId, agentType, cwd = 'f:\\DEV\\agent-viz', ...reste
} = {}) {
  const evt = {
    session_id: session, hook_event_name: 'PostToolUseFailure',
    tool_name: tool, tool_use_id: id, error, cwd, _ts: iso(at), ...reste,
  };
  if (agentId) evt.agent_id = agentId;
  if (agentType) evt.agent_type = agentType;
  return evt;
}

const leve = (wd, evt) => wd.processEvent(evt).newAlerts.filter(a => a.type === 'badInvocation');

// ─── Ce que le detecteur nomme ─────────────────────────────────────────────

test('un chemin Windows avale par le shell POSIX est nomme, et par son motif', () => {
  const wd = createWatchdog({ now: () => T });
  const [alerte] = leve(wd, echec());
  assert.ok(alerte, 'l incident du 5 aout doit lever une alerte');
  assert.equal(alerte.type, 'badInvocation');
  assert.equal(alerte.patternId, 'inv-bash-windows-path-unquoted');
  assert.equal(alerte.toolName, 'Bash');
  assert.equal(alerte.count, 1);
  assert.equal(alerte.cwd, 'f:\\DEV\\agent-viz');
  assert.equal(alerte.createdAt, T, 'l heure est celle de l evenement, pas la notre');
});

test('le message reste anglais et nomme le motif, comme les trois autres', () => {
  // `message` est la formulation PARTAGEE avec la notification bureau. Le
  // francais du bloc Pannes se compose ailleurs, a partir des champs.
  const wd = createWatchdog({ now: () => T });
  const [alerte] = leve(wd, echec());
  assert.match(alerte.message, /^Bash /);
  assert.ok(alerte.message.includes('inv-bash-windows-path-unquoted'),
    'le motif doit se lire dans le message : c est tout ce que la notification aura');
});

// ─── Le filtre, et c est le seul ───────────────────────────────────────────

test('un motif d invocation hors reglage du poste est reconnu POUR ETRE TU', () => {
  // `inv-write-before-read` est le plus frequent du releve. Son instruction est
  // deja ecrite dans la description de l outil, relue a chaque tour : le releve
  // ne prouve pas qu une instruction manque, il prouve qu une instruction
  // existante ne tient pas. Deux diagnostics, un seul est demontre.
  const wd = createWatchdog({ now: () => T });
  assert.deepEqual(leve(wd, echec({ tool: 'Write', error: LECTURE_AVANT_ECRITURE })), []);
});

test('un verdict n est jamais une faute d invocation', () => {
  const wd = createWatchdog({ now: () => T });
  assert.deepEqual(leve(wd, echec({ error: VERDICT_NPM })), []);
});

test('un texte qu aucun motif ne reconnait est muet', () => {
  const wd = createWatchdog({ now: () => T });
  assert.deepEqual(leve(wd, echec({ error: 'la commande a fait ce qu on lui demandait' })), []);
});

test('un echec sans champ error est muet, il ne fait pas tomber le flux', () => {
  // `error` est un champ du hook, pas une valeur que le produit fabrique : il
  // peut etre absent, vide, ou n etre pas une chaine. Le champ ABSENT se
  // construit a la main — le passer `undefined` a l aide ci-dessus ne ferait
  // que reveiller sa valeur par defaut, et le test ne prouverait rien.
  const wd = createWatchdog({ now: () => T });
  const sansErreur = echec();
  delete sansErreur.error;
  assert.deepEqual(leve(wd, sansErreur), []);
  assert.deepEqual(leve(wd, echec({ id: 't2', error: '' })), []);
  assert.deepEqual(leve(wd, echec({ id: 't3', error: null })), []);
  assert.deepEqual(leve(wd, echec({ id: 't4', error: { message: CHEMIN_WINDOWS } })), []);
});

test('un echec qui ne nomme pas son outil ne fabrique pas une phrase creuse', () => {
  // Meme garde que `loop` et `retryStorm`, et le meme invariant : une alerte
  // nomme ce qui a echoue. Sans elle, la phrase partant a la notification
  // bureau dirait « undefined failed on how it was called ».
  const wd = createWatchdog({ now: () => T });
  const sansOutil = echec();
  delete sansOutil.tool_name;
  assert.deepEqual(leve(wd, sansOutil), []);
});

test('un echec sans session est muet : il n y a pas de fait a rattacher', () => {
  const wd = createWatchdog({ now: () => T });
  const sansSession = echec();
  delete sansSession.session_id;
  assert.deepEqual(leve(wd, sansSession), []);
});

// ─── L humain qui reprend la main ──────────────────────────────────────────

test('une interruption humaine n est pas une faute d invocation', () => {
  // Meme invariant que `loop` et `retryStorm`, et il sort AVANT toute autre
  // logique : quelqu un qui appuie sur Echap coupe l appel avant qu il ait pu
  // dire quoi que ce soit sur la facon dont il etait ecrit. Compter ca comme
  // une faute est tres exactement la fausse alerte que ce chien de garde
  // existe pour ne pas faire.
  const wd = createWatchdog({ now: () => T });
  assert.deepEqual(leve(wd, echec({ is_interrupt: true })), []);
});

test('l interruption ne consomme pas non plus le compteur du motif', () => {
  // Elle sort avant TOUTE autre logique, compteur compris : sans quoi le
  // premier echec reel serait annonce « 2 fois dans la session ».
  const wd = createWatchdog({ now: () => T });
  leve(wd, echec({ is_interrupt: true }));
  const [alerte] = leve(wd, echec({ id: 't2', at: T + 1000 }));
  assert.equal(alerte.count, 1, 'l Echap de l utilisateur n a rien compte');
});

// ─── Seul PostToolUseFailure nourrit ce detecteur ──────────────────────────

test('ni PreToolUse ni PostToolUse ne nourrissent ce detecteur', () => {
  const wd = createWatchdog({ now: () => T });
  assert.deepEqual(leve(wd, echec({ hook_event_name: 'PreToolUse' })), []);
  assert.deepEqual(leve(wd, echec({ hook_event_name: 'PostToolUse' })), []);
});

// ─── L identite : l acteur ET le motif, jamais l outil ─────────────────────

test('l identite porte la session, l acteur et le motif', () => {
  const wd = createWatchdog({ now: () => T });
  const [principal] = leve(wd, echec());
  assert.equal(principal.id, 'badInvocation:sid1:inv-bash-windows-path-unquoted');

  const autre = createWatchdog({ now: () => T });
  const [sousAgent] = leve(autre, echec({ agentId: 'ag-a', agentType: 'Explore' }));
  assert.equal(sousAgent.id, 'badInvocation:sid1:ag-a:inv-bash-windows-path-unquoted');
  assert.equal(sousAgent.agentId, 'ag-a');
  assert.equal(sousAgent.agentType, 'Explore');
});

test('deux sous-agents butant sur le meme reglage sont deux alertes', () => {
  // C est litteralement l incident mesure : trois sous-agents de la meme
  // session, a quelques minutes d intervalle, sur le meme piege de shell.
  const wd = createWatchdog({ now: () => T });
  const a = leve(wd, echec({ id: 'a1', agentId: 'ag-a', agentType: 'Explore' }));
  const b = leve(wd, echec({ id: 'b1', at: T + 60_000, agentId: 'ag-b', agentType: 'Plan' }));
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.notEqual(a[0].id, b[0].id);
  assert.equal(wd.getActiveAlerts().length, 2);
});

test('deux motifs differents du meme acteur sont deux alertes', () => {
  const wd = createWatchdog({ now: () => T });
  const un = leve(wd, echec({ id: 'x1' }));
  const deux = leve(wd, echec({ id: 'x2', at: T + 1000, error: ANTISLASH_FINAL }));
  assert.equal(un[0].patternId, 'inv-bash-windows-path-unquoted');
  assert.equal(deux[0].patternId, 'inv-bash-trailing-backslash-in-path');
  assert.equal(wd.getActiveAlerts().length, 2);
});

test('une cmdlet PowerShell sous bash est reconnue mais ne dit rien', () => {
  // Le filtre est unique et c est `workstationSetting` : ce motif est passe a
  // false parce qu il ne distinguait un cmdlet d un binaire absent que par la
  // casse du nom. Le detecteur n a rien a decider ici — il lit le drapeau.
  const wd = createWatchdog({ now: () => T });
  assert.deepEqual(leve(wd, echec({ id: 'z1', error: CMDLET_SOUS_BASH })), []);
  assert.equal(wd.getActiveAlerts().length, 0);
});

test('un heredoc trop gros leve une alerte, avec son propre motif', () => {
  const wd = createWatchdog({ now: () => T });
  const a = leve(wd, echec({ id: 'h1', error: HEREDOC_TROP_GROS }));
  assert.equal(a.length, 1);
  assert.equal(a[0].patternId, 'inv-bash-heredoc-too-large');
});

test('une forme non caracterisee sonne quand meme, sous le motif du filet', () => {
  // C est la garantie de non-silence de toute la scission. Avant elle, toute
  // forme estampillee unexpected EOF sonnait ; si le filet se taisait, la
  // scission RETRECIRAIT la couverture au lieu de l affiner.
  const wd = createWatchdog({ now: () => T });
  const a = leve(wd, echec({ id: 'q1', error: QUOTE_SANS_ANCRE }));
  assert.equal(a.length, 1, 'une forme non reconnue ne doit jamais se taire');
  assert.equal(a[0].patternId, 'inv-bash-unbalanced-quote');
});

test('le meme reglage manquant ne merite qu une alerte tant qu elle n est pas acquittee', () => {
  const wd = createWatchdog({ now: () => T });
  const premiere = leve(wd, echec({ id: 'y1' }));
  assert.equal(premiere.length, 1);
  assert.deepEqual(leve(wd, echec({ id: 'y2', at: T + 1000 })), [],
    'un reglage a poser une fois ne se dit pas deux fois');

  wd.acknowledge(premiere[0].id);
  const apres = leve(wd, echec({ id: 'y3', at: T + 2000 }));
  assert.equal(apres.length, 1, 'acquittee, elle peut reparler');
  assert.equal(apres[0].count, 3, 'et elle dit combien de fois, pas seulement qu elle revient');
});

test('le compteur suit le motif ET l acteur, pas la session seule', () => {
  const wd = createWatchdog({ now: () => T });
  const a = leve(wd, echec({ id: 'a1', agentId: 'ag-a' }));
  const b = leve(wd, echec({ id: 'b1', at: T + 1000, agentId: 'ag-b' }));
  assert.equal(a[0].count, 1);
  assert.equal(b[0].count, 1, 'l echec de ag-a n est pas au compte de ag-b');
});

test('deux sessions ne partagent pas leur compte', () => {
  const wd = createWatchdog({ now: () => T });
  leve(wd, echec({ id: 's1', session: 'sessA' }));
  const [autre] = leve(wd, echec({ id: 's2', at: T + 1000, session: 'sessB' }));
  assert.equal(autre.count, 1);
});

// ─── Ni isStale ni isPastEpisode : le defaut sur ───────────────────────────

test('une erreur passee ne se de-produit pas : aucun battement ne la retire', () => {
  const wd = createWatchdog({ now: () => T });
  const [alerte] = leve(wd, echec());
  assert.equal(alerte.standing, false, 'un echec est un moment, pas un etat');
  wd.tick();
  assert.deepEqual(wd.getActiveAlerts().map(a => a.id), [alerte.id],
    'rien de temporel ne peut la retirer : elle attend d etre lue');
});

test('le temps qui passe ne rouvre pas le verrou de deduplication', () => {
  // `loop` declare `isPastEpisode` parce que sa fenetre EST la definition d un
  // episode. Ici il n y en a pas : le meme reglage manquant reste le meme
  // reglage manquant, une heure plus tard comme une seconde plus tard.
  const wd = createWatchdog({ now: () => T });
  leve(wd, echec({ id: 'z1' }));
  assert.deepEqual(leve(wd, echec({ id: 'z2', at: T + 3_600_000 })), []);
});

// ─── Vie privee : un identifiant, jamais un texte ──────────────────────────

test('l alerte ne porte aucun morceau du texte recu, ni de la commande', () => {
  // La promesse du produit : aucun contenu de sortie d outil ni de commande
  // n est conserve. L alerte part au journal, en ajout seul, pour 90 jours.
  const wd = createWatchdog({ now: () => T });
  const [alerte] = leve(wd, echec({
    tool_input: { command: 'cd D:\\dvf-postgis-pipeline\\frontend && npm run build' },
  }));
  const serialisee = JSON.stringify(alerte);
  assert.ok(!serialisee.includes('dvf-postgis-pipeline'),
    'ni le chemin du message d erreur, ni celui de la commande');
  assert.ok(!serialisee.includes('npm run build'), 'ni la commande elle-meme');
  assert.equal(alerte.subject, '', 'le sujet est vide, et c est la decision');
});

// ─── Le contrat uniforme d alerte ──────────────────────────────────────────

test('patternId existe sur TOUTE alerte, pas seulement sur la sienne', () => {
  // « A consumer can read any field of any alert without type-sniffing. » Un
  // champ present sur une seule sorte d alerte casserait ca en silence : le
  // bloc Pannes lirait `undefined` sur une boucle et composerait une phrase
  // creuse au lieu de tomber sur son repli.
  const wd = createWatchdog({ now: () => T });
  const vues = new Map();
  const garde = alertes => { for (const a of alertes) vues.set(a.type, a); };

  for (let i = 0; i < 4; i++) {
    garde(wd.processEvent({
      session_id: 'boucle', hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_input: { command: 'npm run build' }, tool_use_id: `p${i}`,
      _ts: iso(T + i * 1000),
    }).newAlerts);
  }
  for (let i = 0; i < 3; i++) {
    garde(wd.processEvent(echec({
      session: 'orage', id: `o${i}`, at: T + i * 1000,
      error: `commande-${i} : ${VERDICT_NPM}`,
      tool_input: { command: `commande-${i}` },
    })).newAlerts);
  }
  garde(leve(wd, echec({ session: 'invoc', id: 'i1' })));

  const parBattement = createWatchdog({ now: () => T + 4 * 60_000 });
  parBattement.processEvent({
    session_id: 'bloquee', hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'npm run build' }, tool_use_id: 'b1', _ts: iso(T),
  });
  garde(parBattement.tick().newAlerts);

  assert.deepEqual([...vues.keys()].sort(), ['badInvocation', 'loop', 'retryStorm', 'stuck'],
    'les quatre sortes d alertes doivent avoir ete produites pour que ce test prouve quelque chose');
  for (const [type, a] of vues) {
    assert.equal(typeof a.patternId, 'string', `${type} : patternId n est pas une chaine`);
    if (type !== 'badInvocation') {
      assert.equal(a.patternId, '', `${type} doit porter la valeur par defaut, pas rien`);
    }
  }
});
