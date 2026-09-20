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
//   - le `message` (notification) ne sort aucun texte ; `subject` porte la
//     commande declenchante.

import { expect, test } from 'vitest';
import { createWatchdog, type Alert } from '../../src/engine/watchdog/detector.ts';

const T = 1_700_000_000_000;
const SID = 'sid1';
const iso = (ms: number) => new Date(ms).toISOString();

// `noUncheckedIndexedAccess` : `Array.prototype.filter`/`.processEvent(...).newAlerts`
// ne rendent jamais une tuple, donc `arr[0]` ou `const [x] = arr` typent `T | undefined`.
// Chaque appelant sait déjà, par son assertion de longueur, que l'élément existe.
function premier<T>(arr: T[]): T {
  return arr[0]!;
}

// Echantillons repris du releve decrit dans docs/sources-externes.md, caviardes.
// Ce ne sont pas des messages inventes.

// L'incident releve : trois sous-agents de la meme session butant a quelques
// minutes d'intervalle sur `cd F:\DEV\… && …` sous l'outil Bash.
const CHEMIN_WINDOWS =
  'Exit code 1 /usr/bin/bash: line 1: cd: D:dvf-postgis-pipelinefrontend: No such file or directory';

// Un second reglage du poste, pour verifier que deux motifs distincts du meme
// acteur font deux alertes. Cause A du second releve : un chemin de dossier
// termine par un antislash, que le shell POSIX lit comme un guillemet echappe.
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

// Invocation reconnue, mais PAS un reglage du poste : le motif ne distingue une cmdlet
// PowerShell d'un binaire absent que par la CASSE du nom. Classee POUR ETRE EXCLUE, jamais
// dite ni comptee : un binaire absent n a pas de reglage de poste.
const CMDLET_SOUS_BASH =
  'Exit code 127 /usr/bin/bash: line 1: Select-String: command not found';

// Invocation, mais PAS un reglage du poste : l'instruction existe deja dans la
// description de l'outil, relue a chaque tour. Reconnu pour etre exclu.
const LECTURE_AVANT_ECRITURE =
  '<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>';

// Verdict : la commande a tourne et a dit non. C'est le travail normal, et
// c'est 36 % des echecs du releve.
const VERDICT_NPM = 'npm ERR! code ELIFECYCLE\nnpm ERR! errno 1';

// Fixture volontairement lâche (`[key: string]: any`) : `...reste` doit pouvoir
// porter n'importe quel champ hook additionnel (`is_interrupt`, `tool_input`,
// `hook_event_name` en override...), et `error` accepte aussi `null` ou un objet
// mal formé — des entrées réelles que ces tests posent délibérément.
type EchecArgs = {
  at?: number; session?: string; tool?: string; error?: any;
  id?: string; agentId?: string; agentType?: string; cwd?: string;
  [key: string]: any;
};

function echec({
  at = T, session = SID, tool = 'Bash', error = CHEMIN_WINDOWS,
  id = 't1', agentId, agentType, cwd = 'f:\\DEV\\agent-viz', ...reste
}: EchecArgs = {}): Record<string, any> {
  const evt: Record<string, any> = {
    session_id: session, hook_event_name: 'PostToolUseFailure',
    tool_name: tool, tool_use_id: id, error, cwd, _ts: iso(at), ...reste,
  };
  if (agentId) evt.agent_id = agentId;
  if (agentType) evt.agent_type = agentType;
  return evt;
}

const leve = (wd: ReturnType<typeof createWatchdog>, evt: Record<string, any>): Alert[] =>
  wd.processEvent(evt).newAlerts.filter(a => a.type === 'badInvocation');

// ─── Ce que le detecteur nomme ─────────────────────────────────────────────

test('un chemin Windows avale par le shell POSIX est nomme, et par son motif', () => {
  const wd = createWatchdog({ now: () => T });
  const alerte = premier(leve(wd, echec()));
  expect(alerte, 'le chemin Windows avale par le shell POSIX doit lever une alerte').toBeTruthy();
  expect(alerte.type).toBe('badInvocation');
  expect(alerte.patternId).toBe('inv-bash-windows-path-unquoted');
  expect(alerte.toolName).toBe('Bash');
  expect(alerte.count).toBe(1);
  expect(alerte.cwd).toBe('f:\\DEV\\agent-viz');
  expect(alerte.createdAt, 'l heure est celle de l evenement, pas la notre').toBe(T);
});

test('le message reste anglais et nomme le motif, comme les trois autres', () => {
  // `message` est la formulation PARTAGEE avec la notification bureau. Le
  // francais du bloc Pannes se compose ailleurs, a partir des champs.
  const wd = createWatchdog({ now: () => T });
  const alerte = premier(leve(wd, echec()));
  expect(alerte.message).toMatch(/^Bash /);
  expect(alerte.message.includes('inv-bash-windows-path-unquoted'), 'le motif doit se lire dans le message : c est tout ce que la notification aura').toBeTruthy();
});

// ─── Le filtre, et c est le seul ───────────────────────────────────────────

test('un motif d invocation hors reglage du poste est reconnu POUR ETRE TU', () => {
  // `inv-write-before-read` est le plus frequent du releve. Son instruction est
  // deja ecrite dans la description de l outil, relue a chaque tour : le releve
  // ne prouve pas qu une instruction manque, il prouve qu une instruction
  // existante ne tient pas. Deux diagnostics, un seul est demontre.
  const wd = createWatchdog({ now: () => T });
  expect(leve(wd, echec({ tool: 'Write', error: LECTURE_AVANT_ECRITURE }))).toEqual([]);
});

test('un verdict n est jamais une faute d invocation', () => {
  const wd = createWatchdog({ now: () => T });
  expect(leve(wd, echec({ error: VERDICT_NPM }))).toEqual([]);
});

test('un texte qu aucun motif ne reconnait est muet', () => {
  const wd = createWatchdog({ now: () => T });
  expect(leve(wd, echec({ error: 'la commande a fait ce qu on lui demandait' }))).toEqual([]);
});

test('un echec sans champ error est muet, il ne fait pas tomber le flux', () => {
  // `error` est un champ du hook, pas une valeur que le produit fabrique : il
  // peut etre absent, vide, ou n etre pas une chaine. Le champ ABSENT se
  // construit a la main — le passer `undefined` a l aide ci-dessus ne ferait
  // que reveiller sa valeur par defaut, et le test ne prouverait rien.
  const wd = createWatchdog({ now: () => T });
  const sansErreur = echec();
  delete sansErreur.error;
  expect(leve(wd, sansErreur)).toEqual([]);
  expect(leve(wd, echec({ id: 't2', error: '' }))).toEqual([]);
  expect(leve(wd, echec({ id: 't3', error: null }))).toEqual([]);
  expect(leve(wd, echec({ id: 't4', error: { message: CHEMIN_WINDOWS } }))).toEqual([]);
});

test('un echec qui ne nomme pas son outil ne fabrique pas une phrase creuse', () => {
  // Meme garde que `loop` et `retryStorm`, et le meme invariant : une alerte
  // nomme ce qui a echoue. Sans elle, la phrase partant a la notification
  // bureau dirait « undefined failed on how it was called ».
  const wd = createWatchdog({ now: () => T });
  const sansOutil = echec();
  delete sansOutil.tool_name;
  expect(leve(wd, sansOutil)).toEqual([]);
});

test('un echec sans session est muet : il n y a pas de fait a rattacher', () => {
  const wd = createWatchdog({ now: () => T });
  const sansSession = echec();
  delete sansSession.session_id;
  expect(leve(wd, sansSession)).toEqual([]);
});

// ─── L humain qui reprend la main ──────────────────────────────────────────

test('une interruption humaine n est pas une faute d invocation', () => {
  // Meme invariant que `loop` et `retryStorm`, et il sort AVANT toute autre
  // logique : quelqu un qui appuie sur Echap coupe l appel avant qu il ait pu
  // dire quoi que ce soit sur la facon dont il etait ecrit. Compter ca comme
  // une faute est tres exactement la fausse alerte que ce chien de garde
  // existe pour ne pas faire.
  const wd = createWatchdog({ now: () => T });
  expect(leve(wd, echec({ is_interrupt: true }))).toEqual([]);
});

test('l interruption ne consomme pas non plus le compteur du motif', () => {
  // Elle sort avant TOUTE autre logique, compteur compris : sans quoi le
  // premier echec reel serait annonce « 2 fois dans la session ».
  const wd = createWatchdog({ now: () => T });
  leve(wd, echec({ is_interrupt: true }));
  const alerte = premier(leve(wd, echec({ id: 't2', at: T + 1000 })));
  expect(alerte.count, 'l Echap de l utilisateur n a rien compte').toBe(1);
});

// ─── Seul PostToolUseFailure nourrit ce detecteur ──────────────────────────

test('ni PreToolUse ni PostToolUse ne nourrissent ce detecteur', () => {
  const wd = createWatchdog({ now: () => T });
  expect(leve(wd, echec({ hook_event_name: 'PreToolUse' }))).toEqual([]);
  expect(leve(wd, echec({ hook_event_name: 'PostToolUse' }))).toEqual([]);
});

// ─── L identite : l acteur ET le motif, jamais l outil ─────────────────────

test('l identite porte la session, l acteur et le motif', () => {
  const wd = createWatchdog({ now: () => T });
  const principal = premier(leve(wd, echec()));
  expect(principal.id).toBe('badInvocation:sid1:inv-bash-windows-path-unquoted');

  const autre = createWatchdog({ now: () => T });
  const sousAgent = premier(leve(autre, echec({ agentId: 'ag-a', agentType: 'Explore' })));
  expect(sousAgent.id).toBe('badInvocation:sid1:ag-a:inv-bash-windows-path-unquoted');
  expect(sousAgent.agentId).toBe('ag-a');
  expect(sousAgent.agentType).toBe('Explore');
});

test('deux sous-agents butant sur le meme reglage sont deux alertes', () => {
  // C est litteralement l incident mesure : trois sous-agents de la meme
  // session, a quelques minutes d intervalle, sur le meme piege de shell.
  const wd = createWatchdog({ now: () => T });
  const a = leve(wd, echec({ id: 'a1', agentId: 'ag-a', agentType: 'Explore' }));
  const b = leve(wd, echec({ id: 'b1', at: T + 60_000, agentId: 'ag-b', agentType: 'Plan' }));
  expect(a.length).toBe(1);
  expect(b.length).toBe(1);
  expect(premier(a).id).not.toBe(premier(b).id);
  expect(wd.getActiveAlerts().length).toBe(2);
});

test('deux motifs differents du meme acteur sont deux alertes', () => {
  const wd = createWatchdog({ now: () => T });
  const un = leve(wd, echec({ id: 'x1' }));
  const deux = leve(wd, echec({ id: 'x2', at: T + 1000, error: ANTISLASH_FINAL }));
  expect(premier(un).patternId).toBe('inv-bash-windows-path-unquoted');
  expect(premier(deux).patternId).toBe('inv-bash-trailing-backslash-in-path');
  expect(wd.getActiveAlerts().length).toBe(2);
});

test('une cmdlet PowerShell sous bash est reconnue mais ne dit rien', () => {
  // Le filtre est unique et c est `workstationSetting` : ce motif est a false parce qu il ne
  // distingue un cmdlet d un binaire absent que par la casse du nom. Le detecteur n a rien a
  // decider ici — il lit le drapeau.
  const wd = createWatchdog({ now: () => T });
  expect(leve(wd, echec({ id: 'z1', error: CMDLET_SOUS_BASH }))).toEqual([]);
  expect(wd.getActiveAlerts().length).toBe(0);
});

test('un heredoc trop gros leve une alerte, avec son propre motif', () => {
  const wd = createWatchdog({ now: () => T });
  const a = leve(wd, echec({ id: 'h1', error: HEREDOC_TROP_GROS }));
  expect(a.length).toBe(1);
  expect(premier(a).patternId).toBe('inv-bash-heredoc-too-large');
});

test('une forme non caracterisee sonne quand meme, sous le motif du filet', () => {
  // La garantie de non-silence : toute forme estampillee unexpected EOF sonne. Si le filet
  // se taisait, les formes qu aucune des deux ancres ne reconnait deviendraient muettes.
  const wd = createWatchdog({ now: () => T });
  const a = leve(wd, echec({ id: 'q1', error: QUOTE_SANS_ANCRE }));
  expect(a.length, 'une forme non reconnue ne doit jamais se taire').toBe(1);
  expect(premier(a).patternId).toBe('inv-bash-unbalanced-quote');
});

test('le meme reglage manquant ne merite qu une alerte tant qu elle n est pas acquittee', () => {
  const wd = createWatchdog({ now: () => T });
  const premiere = leve(wd, echec({ id: 'y1' }));
  expect(premiere.length).toBe(1);
  expect(leve(wd, echec({ id: 'y2', at: T + 1000 })), 'un reglage a poser une fois ne se dit pas deux fois').toEqual([]);

  wd.acknowledge(premier(premiere).id);
  const apres = leve(wd, echec({ id: 'y3', at: T + 2000 }));
  expect(apres.length, 'acquittee, elle peut reparler').toBe(1);
  expect(premier(apres).count, 'et elle dit combien de fois, pas seulement qu elle revient').toBe(3);
});

test('le compteur suit le motif ET l acteur, pas la session seule', () => {
  const wd = createWatchdog({ now: () => T });
  const a = leve(wd, echec({ id: 'a1', agentId: 'ag-a' }));
  const b = leve(wd, echec({ id: 'b1', at: T + 1000, agentId: 'ag-b' }));
  expect(premier(a).count).toBe(1);
  expect(premier(b).count, 'l echec de ag-a n est pas au compte de ag-b').toBe(1);
});

test('deux sessions ne partagent pas leur compte', () => {
  const wd = createWatchdog({ now: () => T });
  leve(wd, echec({ id: 's1', session: 'sessA' }));
  const autre = premier(leve(wd, echec({ id: 's2', at: T + 1000, session: 'sessB' })));
  expect(autre.count).toBe(1);
});

// ─── Ni isStale ni isPastEpisode : le defaut sur ───────────────────────────

test('une erreur passee ne se de-produit pas : aucun battement ne la retire', () => {
  const wd = createWatchdog({ now: () => T });
  const alerte = premier(leve(wd, echec()));
  expect(alerte.standing, 'un echec est un moment, pas un etat').toBe(false);
  wd.tick();
  expect(wd.getActiveAlerts().map(a => a.id), 'rien de temporel ne peut la retirer : elle attend d etre lue').toEqual([alerte.id]);
});

test('le temps qui passe ne rouvre pas le verrou de deduplication', () => {
  // `loop` declare `isPastEpisode` parce que sa fenetre EST la definition d un
  // episode. Ici il n y en a pas : le meme reglage manquant reste le meme
  // reglage manquant, une heure plus tard comme une seconde plus tard.
  const wd = createWatchdog({ now: () => T });
  leve(wd, echec({ id: 'z1' }));
  expect(leve(wd, echec({ id: 'z2', at: T + 3_600_000 }))).toEqual([]);
});

// ─── Le sujet : la commande declenchante, jamais le message ni le motif seul ──

test('l alerte consigne la commande declenchante', () => {
  const wd = createWatchdog({ now: () => T });
  const alerte = premier(leve(wd, echec({ tool_input: { command: 'cd F:\\DEV\\agent-viz && npm test' } })));
  expect(alerte, 'le chemin Windows doit lever une alerte').toBeTruthy();
  expect(alerte.subject, 'la commande integrale, non tronquee').toBe('cd F:\\DEV\\agent-viz && npm test');
  expect(alerte.message.includes('inv-bash-windows-path-unquoted')).toBeTruthy();
  expect(!alerte.message.includes('npm test'), 'le message notification reste sans commande : seul subject la porte').toBeTruthy();
});

test('le texte de l erreur, lui, ne se consigne toujours pas — seul subject porte du texte', () => {
  // La retention s arrete a la commande declenchante : rien du message d erreur ne traverse.
  const wd = createWatchdog({ now: () => T });
  const alerte = premier(leve(wd, echec({ tool_input: { command: 'npm run build' } })));
  const serialisee = JSON.stringify(alerte);
  expect(!serialisee.includes('dvf-postgis-pipeline'), 'aucun fragment du message d erreur ne doit etre consigne').toBeTruthy();
  expect(alerte.subject).toBe('npm run build');
});

test('sans tool_input le sujet est vide, jamais absent', () => {
  const wd = createWatchdog({ now: () => T });
  const alerte = premier(leve(wd, echec()));
  expect(alerte.subject).toBe('');
});

// ─── Le contrat uniforme d alerte ──────────────────────────────────────────

test('patternId existe sur TOUTE alerte, pas seulement sur la sienne', () => {
  // « A consumer can read any field of any alert without type-sniffing. » Un
  // champ present sur une seule sorte d alerte casserait ca en silence : le
  // bloc Pannes lirait `undefined` sur une boucle et composerait une phrase
  // creuse au lieu de tomber sur son repli.
  const wd = createWatchdog({ now: () => T });
  const vues = new Map<string, Alert>();
  const garde = (alertes: Alert[]) => { for (const a of alertes) vues.set(a.type, a); };

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

  expect([...vues.keys()].sort(), 'les quatre sortes d alertes doivent avoir ete produites pour que ce test prouve quelque chose').toEqual(['badInvocation', 'loop', 'retryStorm', 'stuck']);
  for (const [type, a] of vues) {
    expect(typeof a.patternId, `${type} : patternId n est pas une chaine`).toBe('string');
    if (type !== 'badInvocation') {
      expect(a.patternId, `${type} doit porter la valeur par defaut, pas rien`).toBe('');
    }
  }
});
