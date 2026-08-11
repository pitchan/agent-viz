// Tests unitaires de public/viz-invocation-patterns.mjs — la table de motifs
// qui distingue « l'agent n'a pas su appeler » de « la commande a répondu non ».
//
// La table vient d'un relevé sur 370 sessions et 587 échecs réels (doc/27 du
// dépôt privé, cf. docs/sources-externes.md). Les échantillons ci-dessous sont
// repris de ses extraits, caviardés ; ce ne sont pas des messages inventés.
//
// Six choses sont vérifiées ici et nulle part ailleurs :
//   - la LANGUE : sur cette machine 100 % des messages PowerShell sont en
//     français et onze ont leurs accents corrompus en U+FFFD. Un motif ancré
//     sur la prose anglaise relèverait ZÉRO cas, en silence.
//   - le ZÉRO FAUX POSITIF : un test rouge, un build cassé, un refus de
//     permission ne doivent JAMAIS être classés « invocation ».
//   - CITER n'est pas ÉMETTRE (section 5) : un texte qui porte la preuve
//     qu'un programme a tourné n'atteint jamais le sous-ensemble qui alerte,
//     et « Exit code N » reste le dernier filet, jamais le premier.
//   - le COÛT (section 6) : classify tourne synchrone dans la boucle du
//     démon, donc aucun motif n'a le droit de rétro-explorer.
//   - le TÉMOIN DU RELEVÉ (section 8) : les 37 expressions sont celles du
//     relevé, écart par écart déclaré, et aucun écart n'élargit.
//   - la VIE PRIVÉE : la sortie est tirée d'un vocabulaire fermé, fixé au
//     chargement — c'est cela, et non un test de sous-chaîne, qui interdit
//     qu'un morceau du texte reçu ressorte.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, PATTERNS } from '../../public/viz-invocation-patterns.mjs';

// ─── Échantillons, un par motif, dans l'ordre de la table ──────────────────
//
// U+FFFD est écrit \uFFFD en clair : c'est l'accent corrompu tel qu'il arrive
// vraiment, et l'écrire en échappement le rend visible à la relecture.

const PS_COMMAND_NOT_FOUND_FR = [
  "head : Le terme \u00abhead\u00bb n'est pas reconnu comme nom d'applet de commande, fonction,",
  "fichier de script ou programme ex\uFFFDcutable. V\uFFFDrifiez l'orthographe du nom, ou si un",
  "chemin d'acc\uFFFDs existe, v\uFFFDrifiez que le chemin d'acc\uFFFDs est correct et r\uFFFDessayez.",
  'Au caract\uFFFDre Ligne:1 : 33',
  '+ ... git diff | head -50',
  '+                        ~~~~',
  '    + CategoryInfo          : ObjectNotFound: (head:String) [], CommandNotFoundException',
  '    + FullyQualifiedErrorId : CommandNotFoundException',
].join('\n');

const PS_PARAMETER_NOT_FOUND_FR = [
  'Select-String : Impossible de trouver un param\uFFFDtre correspondant au nom \u00ab Recurse \u00bb.',
  'Au caract\uFFFDre Ligne:1 : 390',
  '    + CategoryInfo          : InvalidArgument: (:) [Select-String], ParameterBindingException',
  '    + FullyQualifiedErrorId : NamedParameterNotFound,Microsoft.PowerShell.Commands.SelectStringCommand',
].join('\n');

const PS_ARGUMENT_TYPE_FR = [
  'Select-Object : Impossible de lier le param\uFFFDtre \u00ab Index \u00bb. Impossible de convertir',
  'la valeur \u00ab 30..35 \u00bb en type \u00ab System.Int32 \u00bb.',
  '    + CategoryInfo          : InvalidArgument: (:) [Select-Object], ParameterBindingException',
  '    + FullyQualifiedErrorId : CannotConvertArgument,Microsoft.PowerShell.Commands.SelectObjectCommand',
].join('\n');

const PS_SYNTAX_FR = [
  'Vous devez indiquer une expression de valeur apr\uFFFDs l\u2019op\uFFFDrateur \u00ab -match \u00bb.',
  'Au caract\uFFFDre Ligne:1 : 42',
  '    + CategoryInfo          : ParserError: (:) [], ParentContainsErrorRecordException',
  '    + FullyQualifiedErrorId : ExpectedValueExpression',
].join('\n');

const PS_ARGUMENT_EXCEPTION_FR = [
  "ConvertFrom-Json : Objet non valide pass\uFFFD, ':' ou '}' attendu. (82)",
  '    + CategoryInfo          : NotSpecified: (:) [ConvertFrom-Json], ArgumentException',
  '    + FullyQualifiedErrorId : System.ArgumentException,Microsoft.PowerShell.Commands.ConvertFromJsonCommand',
].join('\n');

// Un test rouge de vitest : la classe VERDICT la plus volumineuse du relevé.
const VITEST_RED = [
  ' RUN  v3.2.0 F:/DEV/agent-viz/netgain',
  ' \u2713 src/doctor/rules/r1.test.ts (12)',
  ' \u00d7 src/doctor/rules/r6.test.ts (1)',
  ' Test Files  1 failed | 22 passed (23)',
].join('\n');

// Une pile Node qui contient AUSSI « No such file or directory » : c'est le
// cas exact que le contrôle anti-faux-positif du relevé a compté (4 fuites de
// inv-path-not-found, dont 2 ici). Il ne passe que si le motif générique reste
// derrière les motifs de verdict.
const NODE_STACK_WITH_PATH = [
  'node:internal/child_process:290',
  '    throw errnoException(err, code);',
  'Error: spawn bash ENOENT: No such file or directory',
  '    at ChildProcess.spawn (node:internal/child_process:290:11)',
].join('\n');

const PYTHON_TRACEBACK_WITH_PATH = [
  'Traceback (most recent call last):',
  '  File "<CHEMIN>/main.py", line 12, in <module>',
  '    open(cfg)',
  "FileNotFoundError: [Errno 2] No such file or directory: '<CHEMIN>/cfg.yml'",
].join('\n');

// [id attendu, texte]. L'ordre suit celui de la table : un échantillon placé
// ici prouve à la fois que son motif matche ET qu'aucun motif plus haut ne le
// lui prend.
const SAMPLES = [
  // couche 1 — le harnais a refuse l appel
  ['harness-tool-disabled',
   'No such tool available: mcp__mdb-explorer__mdb_geocode. This tool is not enabled in this context.'],
  ['harness-classifier-denied',
   'This command was denied by the Claude Code auto mode classifier.'],
  ['harness-model-unavailable',
   'The model is temporarily unavailable, so auto mode cannot determine the safety of this command.'],
  ['harness-user-rejected',
   "The user doesn't want to proceed with this tool use. The tool use was rejected."],

  // couche 2 — l environnement : reseau, permission, service, binaire, navigateur
  ['env-ssh-host-key-changed',
   '@@@@@@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@@@@@@'],
  ['env-binary-missing',
   'Exit code 1 uv is not installed. Install it from https://astral.sh/uv'],
  ['env-browser-timeout',
   'Timeout 5000ms exceeded while waiting for the page to settle.'],
  ['env-network',
   'Error: connect ECONNREFUSED 127.0.0.1:3000'],
  ['env-permission-denied',
   "EACCES: permission denied, open '<CHEMIN>'"],

  // couche 3 — un programme a tourne et rendu un rapport
  ['vrd-test-runner', VITEST_RED],
  ['vrd-node-stacktrace', NODE_STACK_WITH_PATH],
  ['vrd-python-traceback', PYTHON_TRACEBACK_WITH_PATH],
  ['vrd-npm-script',
   'npm ERR! code ELIFECYCLE\nnpm ERR! errno 1'],
  ['vrd-compiler-diagnostic',
   "src/doctor/rules/r6.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'."],

  // couche 4 — invocation, reglage du poste : le seul sous-ensemble qui alerte
  ['inv-bash-windows-path-unquoted',
   'Exit code 1 /usr/bin/bash: line 1: cd: D:dvf-postgis-pipelinefrontend: No such file or directory'],
  ['inv-bash-cd-too-many-args',
   'Exit code 1 /usr/bin/bash: line 1: cd: too many arguments'],
  // Deux causes disjointes, mesurees le 2026-08-08 (doc/30) : 11 antislash
  // final avant le guillemet fermant, 8 heredoc au-dela de 8 Ko. Elles se
  // separent sur le message SEUL — 19/19 — et sur deux ancres a la fois : la
  // voie d'appel (`eval:` / `-c:`) ET le caractere cherche (`"` / `'`).
  ['inv-bash-trailing-backslash-in-path',
   'Exit code 2 /usr/bin/bash: eval: line 1: unexpected EOF while looking for matching `"\''],
  ['inv-bash-heredoc-too-large',
   "Exit code 2 /usr/bin/bash: -c: line 149: unexpected EOF while looking for matching `''"],
  // Le filet. Ni `eval:` ni `-c:` : aucune des deux ancres neuves ne le prend,
  // et il ALERTE, sous sa phrase vague. C'est exactement le scenario « le
  // harnais a change sa facon d'appeler le shell » : la forme n'est plus
  // reconnue par les ancres, mais elle sonne quand meme. Un motif muet ne
  // compterait pas non plus — le filtre du detecteur rend null avant le
  // compteur.
  ['inv-bash-unbalanced-quote',
   'Exit code 2 /usr/bin/bash: line 42: unexpected EOF while looking for matching `"\''],
  ['inv-bash-syntax-error',
   "Exit code 2 /usr/bin/bash: -c: line 1: syntax error near unexpected token `newline'"],
  ['inv-cross-shell-cmdlet-in-posix',
   'Exit code 127 /usr/bin/bash: line 1: Select-String: command not found'],
  ['inv-ps-command-not-found', PS_COMMAND_NOT_FOUND_FR],
  ['inv-ps-parameter-not-found', PS_PARAMETER_NOT_FOUND_FR],
  ['inv-ps-argument-type', PS_ARGUMENT_TYPE_FR],
  ['inv-ps-syntax', PS_SYNTAX_FR],
  ['inv-ps-argument-exception', PS_ARGUMENT_EXCEPTION_FR],

  // couche 5 — invocation, protocole d outil : reconnue pour etre exclue
  ['inv-tool-schema-rejected',
   '<tool_use_error>InputValidationError: Glob failed due to the following issue: An unexpected parameter `head_limit` was provided</tool_use_error>'],
  ['inv-write-before-read',
   '<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>'],
  ['inv-read-without-pagination',
   'File content (30570 tokens) exceeds maximum allowed tokens (25000). Use offset and limit parameters to read specific portions of the file, or search for specific content.'],
  ['inv-read-on-directory',
   "EISDIR: illegal operation on a directory, read '<CHEMIN>'"],
  ['inv-edit-anchor-missing',
   '<tool_use_error>String to replace not found in file. String: export const FRESHNESS_MS</tool_use_error>'],
  ['inv-edit-noop',
   '<tool_use_error>No changes to make: old_string and new_string are exactly the same.</tool_use_error>'],
  ['inv-edit-replace-all-missing',
   '<tool_use_error>Found 2 matches of the string to replace, but replace_all is false. To replace all occurrences, set replace_all to true.</tool_use_error>'],
  ['inv-search-bad-pattern',
   'Search failed \u2014 ripgrep rejected the pattern, glob, or file type without searching: rg: regex parse error'],
  ['inv-wrapper-unsupported',
   'Exit code 1 rtk: rtk find does not support compound predicates or actions (e.g. -not, -exec). Use `find` directly.'],
  ['inv-unknown-agent-or-skill',
   "Agent type 'fork' not found. Available agents: claude, general-purpose, Plan, statusline-setup"],
  ['inv-git-bad-ref',
   "Exit code 128 fatal: ambiguous argument 'origin/HEAD...': unknown revision or path not in the working tree."],

  // couche 6 — le generique d invocation
  ['inv-path-not-found',
   '<tool_use_error>Path does not exist: app/common/DocApiTypes-ti.ts. Note: your current working directory is <CHEMIN></tool_use_error>'],

  // couche 7 — le dernier filet
  ['vrd-exit-code-bare',
   'Exit code 1'],
];

// Le sous-ensemble « réglage du poste » : le seul qui donnera lieu à une
// alerte. Exactement ces onze motifs.
// `inv-cross-shell-cmdlet-in-posix` n en fait pas partie : 1 occurrence en 90
// jours, et il ne distinguait un cmdlet PowerShell d un binaire absent que par
// la CASSE du nom.
// `inv-bash-unbalanced-quote` en fait de nouveau partie, et c est la
// correction du 2026-08-08 : une version anterieure de la scission l avait
// sorti en affirmant qu il « comptait encore sans etre dit ». Il ne comptait
// rien. Le filtre du detecteur (viz-watchdog.mjs:495) rend null AVANT le
// compteur des lignes 502-503 : un motif qui n alerte pas ne compte pas non
// plus, il est classe puis jete.
const WORKSTATION_IDS = [
  'inv-bash-windows-path-unquoted',
  'inv-bash-cd-too-many-args',
  'inv-bash-trailing-backslash-in-path',
  'inv-bash-heredoc-too-large',
  'inv-bash-unbalanced-quote',
  'inv-bash-syntax-error',
  'inv-ps-command-not-found',
  'inv-ps-parameter-not-found',
  'inv-ps-argument-type',
  'inv-ps-syntax',
  'inv-ps-argument-exception',
];

const CLASSES = ['invocation', 'verdict', 'environment', 'harness'];

// ─── Le contrat ────────────────────────────────────────────────────────────

test('classify rend { id, class } et rien d autre', () => {
  const got = classify('Exit code 1 /usr/bin/bash: line 1: cd: too many arguments');
  assert.deepEqual(got, { id: 'inv-bash-cd-too-many-args', class: 'invocation' });
  assert.deepEqual(Object.keys(got), ['id', 'class']);
});

test('un texte qui ne ressemble a aucun motif rend null', () => {
  assert.equal(classify('tout va bien, la commande a fait ce qu on lui demandait'), null);
});

test('la classe appartient a un ensemble ferme de quatre valeurs', () => {
  for (const p of PATTERNS) {
    assert.ok(CLASSES.includes(p.class), `${p.id} porte une classe hors ensemble : ${p.class}`);
  }
});

test('la table a la forme attendue : id unique, expression reguliere, drapeau de reglage', () => {
  const seen = new Set();
  for (const p of PATTERNS) {
    assert.equal(typeof p.id, 'string');
    assert.ok(p.id.length > 0);
    assert.ok(!seen.has(p.id), `identifiant en double : ${p.id}`);
    seen.add(p.id);
    assert.ok(p.re instanceof RegExp, `${p.id} n a pas d expression reguliere`);
    assert.equal(typeof p.workstationSetting, 'boolean',
      `${p.id} ne dit pas s il releve du reglage du poste`);
  }
});

test('aucune expression reguliere n est globale — classify serait a etat', () => {
  for (const p of PATTERNS) {
    assert.ok(!p.re.flags.includes('g'), `${p.id} porte le drapeau g`);
    assert.ok(!p.re.flags.includes('y'), `${p.id} porte le drapeau y`);
  }
});

test('classify est idempotent : deux appels sur le meme texte donnent le meme verdict', () => {
  for (const [, text] of SAMPLES) {
    assert.deepEqual(classify(text), classify(text));
  }
});

test('la table compte 39 motifs, dont 24 d invocation', () => {
  const byClass = {};
  for (const p of PATTERNS) byClass[p.class] = (byClass[p.class] || 0) + 1;
  assert.deepEqual(byClass, { harness: 4, invocation: 24, environment: 5, verdict: 6 });
  assert.equal(PATTERNS.length, 39);
});

// ─── Couverture : un echantillon reel par motif ────────────────────────────

test('chaque motif du releve reconnait son echantillon, et aucun ne le lui prend', () => {
  for (const [expected, text] of SAMPLES) {
    const got = classify(text);
    assert.notEqual(got, null, `${expected} : aucun motif ne matche son propre echantillon`);
    assert.equal(got.id, expected, `echantillon de ${expected} classe ${got.id}`);
  }
});

test('les 37 motifs de la table ont tous un echantillon dans ce fichier', () => {
  assert.deepEqual(SAMPLES.map(([id]) => id), PATTERNS.map(p => p.id));
});

// ─── 1. La langue : le piege central, mesure et non suppose ────────────────

test('un message PowerShell FRANCAIS aux accents corrompus est classe', () => {
  // 100 % des messages PowerShell de cette machine sont en francais et onze
  // ont leurs accents remplaces par U+FFFD. C'est le cas nominal, pas un cas
  // limite : un motif qui le rate rate tout.
  assert.ok(PS_COMMAND_NOT_FOUND_FR.includes('\uFFFD'),
    'l echantillon doit vraiment porter des accents corrompus');
  assert.deepEqual(classify(PS_COMMAND_NOT_FOUND_FR),
    { id: 'inv-ps-command-not-found', class: 'invocation' });
});

test('le motif PowerShell ne depend pas de la langue : meme verdict en anglais', () => {
  // Meme incident, machine en anglais. L'identifiant .NET est le seul element
  // commun aux deux textes — s'ils donnent le meme id, c'est lui qui classe.
  const en = [
    "head : The term 'head' is not recognized as the name of a cmdlet, function,",
    'script file, or operable program. Check the spelling of the name.',
    'At line:1 char:33',
    '    + CategoryInfo          : ObjectNotFound: (head:String) [], CommandNotFoundException',
    '    + FullyQualifiedErrorId : CommandNotFoundException',
  ].join('\n');
  assert.deepEqual(classify(en), { id: 'inv-ps-command-not-found', class: 'invocation' });
});

test('la prose francaise seule ne classe pas : c est l identifiant .NET qui ancre', () => {
  // Controle negatif de l ancrage. On retire la ligne FullyQualifiedErrorId et
  // on garde tout le francais : si le motif matchait encore, il serait ancre
  // sur la phrase — donc cassable par une traduction ou un accent corrompu.
  const sansAncre = PS_COMMAND_NOT_FOUND_FR
    .split('\n')
    .filter(l => !l.includes('FullyQualifiedErrorId'))
    .join('\n');
  assert.ok(sansAncre.includes("n'est pas reconnu"), 'la prose francaise est bien restee');
  assert.equal(classify(sansAncre), null);
});

test('les cinq motifs PowerShell sont classes sur leurs echantillons francais', () => {
  const attendus = [
    [PS_COMMAND_NOT_FOUND_FR, 'inv-ps-command-not-found'],
    [PS_PARAMETER_NOT_FOUND_FR, 'inv-ps-parameter-not-found'],
    [PS_ARGUMENT_TYPE_FR, 'inv-ps-argument-type'],
    [PS_SYNTAX_FR, 'inv-ps-syntax'],
    [PS_ARGUMENT_EXCEPTION_FR, 'inv-ps-argument-exception'],
  ];
  for (const [text, id] of attendus) {
    assert.ok(text.includes('\uFFFD'), `${id} : echantillon sans accent corrompu`);
    const got = classify(text);
    assert.notEqual(got, null, `${id} : message francais non classe`);
    assert.equal(got.id, id);
  }
});

// Le garde d ancrage .NET est plus bas, section 7. Celui qui se trouvait ici
// — `/FullyQualifiedErrorId|CategoryInfo/.test(p.re.source)` — a ete retire
// plutot que garde : il cherchait son ancre N IMPORTE OU dans la source, donc
// une simple alternation le defaisait, et il ADMETTAIT `CategoryInfo` que la
// decision du 2026-08-08 exclut nommement. Un mutant qui ancrait
// `inv-ps-argument-type` sur `CategoryInfo : InvalidArgument:` y survivait :
// le test admettait exactement ce que la decision interdit.

// ─── 2. Le zero faux positif : la moitie de la valeur du module ────────────

const NON_INVOCATION = [
  ['test rouge vitest', VITEST_RED],
  ['test rouge node:test', 'ℹ tests 625\nℹ pass 624\nℹ fail 1'],
  ['assertion rouge', [
    'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:',
    '+ actual - expected',
    '+ 3',
    '- 4',
  ].join('\n')],
  ['build casse (tsc)', "src/x.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'."],
  ['build casse (npm)', 'npm ERR! code ELIFECYCLE\nnpm ERR! Exit status 1'],
  ['pile node avec un chemin absent', NODE_STACK_WITH_PATH],
  ['traceback python avec un chemin absent', PYTHON_TRACEBACK_WITH_PATH],
  ['refus de permission systeme', "EACCES: permission denied, open '<CHEMIN>'"],
  ['refus de permission humain', "The user doesn't want to proceed with this tool use."],
  ['refus du classifieur', 'This command was denied by the Claude Code auto mode classifier.'],
  ['outil coupe par la configuration', 'No such tool available: mcp__x__y. This tool is not enabled in this context.'],
  ['reseau', 'Error: connect ECONNREFUSED 127.0.0.1:3000'],
];

test('une sortie de verdict, d environnement ou de harnais n est JAMAIS une invocation', () => {
  for (const [quoi, text] of NON_INVOCATION) {
    const got = classify(text);
    assert.notEqual(got, null, `${quoi} : non classe, donc non exclu explicitement`);
    assert.notEqual(got.class, 'invocation', `${quoi} : classe a tort en invocation (${got.id})`);
  }
});

test('le motif generique de chemin absent reste derriere les verdicts', () => {
  // Le releve a mesure exactement quatre fuites de inv-path-not-found : deux
  // dans une pile node, deux dans un traceback python. Sa place en fin de
  // table est ce qui les neutralise — et ce test est ce qui le prouve.
  assert.ok(NODE_STACK_WITH_PATH.includes('No such file or directory'));
  assert.ok(PYTHON_TRACEBACK_WITH_PATH.includes('No such file or directory'));
  assert.equal(classify(NODE_STACK_WITH_PATH).id, 'vrd-node-stacktrace');
  assert.equal(classify(PYTHON_TRACEBACK_WITH_PATH).id, 'vrd-python-traceback');
});

test('inv-path-not-found est le dernier motif d invocation de la table', () => {
  const invocations = PATTERNS.filter(p => p.class === 'invocation');
  assert.equal(invocations.at(-1).id, 'inv-path-not-found');
});

test('un verdict colorise ne peut pas atteindre le sous-ensemble qui alerte', () => {
  // Constat mesure, a ne pas cacher : le releve a classe des textes DEBARRASSES
  // de leurs codes ANSI, alors que le champ `error` du hook les porte encore.
  // Sur ce texte-la, `vrd-test-runner` ne matche plus — ses glyphes sont suivis
  // d une sequence ANSI et non d une espace — et le generique de chemin absent
  // ramasse la sortie. Rejoue sur les 587 echecs reels, l ecart ne touche AUCUN
  // motif d invocation (206 des deux cotes, les 22 comptes identiques) : il ne
  // redistribue que des motifs de verdict entre eux.
  //
  // Ce qui doit tenir quoi qu il arrive, et que ce test verrouille : la
  // colorisation ne peut jamais faire remonter un verdict dans le sous-ensemble
  // « reglage du poste », le seul qui alertera. Ces motifs-la sont ancres sur
  // un identifiant .NET ou sur un message de `bash` qu une sortie de test ne
  // contient pas.
  const E = '\u001b'; // ESC, ecrit en echappement : un caractere de controle nu est illisible en revue
  const testRougeColorise = [
    'Exit code 1',
    `${E}[7m${E}[1m${E}[35m RUN ${E}[39m${E}[22m${E}[27m v3.2.0`,
    ` ${E}[32m✓${E}[39m src/a.test.ts`,
    ` ${E}[31m×${E}[39m src/b.test.ts`,
    'Error: ENOENT: No such file or directory',
  ].join('\n');
  const got = classify(testRougeColorise);
  assert.notEqual(got, null);
  // La question est posee A LA TABLE, via le drapeau dont le detecteur se
  // servira comme unique filtre — pas a une liste d identifiants recopiee ici.
  // Une liste recopiee survivrait a un motif marque « reglage du poste » par
  // erreur, ce qui est exactement le faux positif que ce test doit attraper.
  const motif = PATTERNS.find(p => p.id === got.id);
  assert.equal(motif.workstationSetting, false,
    `un test rouge colorise a atteint le sous-ensemble qui alerte : ${got.id}`);
});

test('le chemin Windows non echappe passe avant le chemin absent generique', () => {
  // Les deux motifs matchent ce texte. Le specifique doit gagner : c est lui
  // qui nomme le reglage manquant, l autre ne nomme rien.
  const text = 'Exit code 1 /usr/bin/bash: line 1: cd: F:DEVagent-viz: No such file or directory';
  assert.equal(classify(text).id, 'inv-bash-windows-path-unquoted');
});

// ─── 3. La vie privee : un identifiant, jamais un extrait ──────────────────

test('la sortie ne contient aucun morceau du texte recu', () => {
  // Cet oracle-ci ne vaut QUE sur les echantillons choisis, et c est mesure :
  // rejoue sur les 587 echecs reels il crie 10 fois, toutes sur
  // `class = 'verdict'`, parce que « verdict » est un mot que les scripts de ce
  // depot impriment. Il attrape bien une sortie qui recopierait le texte, mais
  // la garantie de vie privee est ailleurs — dans le vocabulaire ferme,
  // section 11.
  for (const [id, text] of SAMPLES) {
    const got = classify(text);
    for (const [champ, valeur] of Object.entries(got)) {
      assert.ok(!text.includes(valeur),
        `${id} : la valeur de ${champ} est un extrait du texte recu`);
    }
  }
});

test('rien de la machine ne ressort : ni chemin, ni identite, ni secret', () => {
  const text = [
    '<tool_use_error>String to replace not found in file. String: ',
    'ANTHROPIC_API_KEY=sk-ant-000 dans C:\\Users\\alice\\projet-confidentiel\\.env',
    '</tool_use_error>',
  ].join('');
  const got = classify(text);
  assert.deepEqual(got, { id: 'inv-edit-anchor-missing', class: 'invocation' });
  const serialise = JSON.stringify(got);
  for (const secret of ['alice', 'sk-ant-000', 'projet-confidentiel', '.env', 'C:\\Users']) {
    assert.ok(!serialise.includes(secret), `${secret} a fuite dans la sortie`);
  }
});

test('muter le resultat ne corrompt pas la table', () => {
  const text = 'Exit code 1 /usr/bin/bash: line 1: cd: too many arguments';
  const premier = classify(text);
  premier.id = 'MUTE';
  premier.class = 'harness';
  assert.deepEqual(classify(text), { id: 'inv-bash-cd-too-many-args', class: 'invocation' });
});

// ─── 4. L entree hostile : le champ error du hook n est pas garanti ────────

test('classify rend null sans jamais lever sur une entree qui n est pas un texte', () => {
  for (const hostile of [undefined, null, '', 0, 1, NaN, true, false, {}, [], { error: 'x' },
    () => {}, Symbol('x'), 12n, new Date(0)]) {
    assert.equal(classify(hostile), null, `entree hostile non neutralisee : ${String(hostile)}`);
  }
});

test('classify ne bloque pas sur un tres gros texte', () => {
  // Ce test ne couvre PAS le retour arriere quadratique, et il ne faut pas le
  // croire : 1 Mo de lorem ipsum se classe en 7,9 ms meme quand le defaut est
  // present, parce que ce texte n a aucun debut de ligne. La forme qui le
  // revele est un long train de blancs — voir la section 6.
  const enorme = 'lorem ipsum dolor sit amet '.repeat(40_000); // ~1 Mo
  assert.ok(enorme.length > 1_000_000);
  assert.equal(classify(enorme), null);
});

test('un tres gros texte qui contient un motif est quand meme classe', () => {
  const enorme = 'lorem ipsum dolor sit amet '.repeat(40_000)
    + '\n<tool_use_error>No changes to make: old_string and new_string are exactly the same.</tool_use_error>';
  assert.equal(classify(enorme).id, 'inv-edit-noop');
});

// ─── Le reglage du poste : le seul sous-ensemble qui alertera ──────────────

test('exactement onze motifs relevent du reglage du poste', () => {
  const flagges = PATTERNS.filter(p => p.workstationSetting).map(p => p.id);
  assert.deepEqual([...flagges].sort(), [...WORKSTATION_IDS].sort());
});

test('un motif de reglage du poste est toujours de classe invocation', () => {
  for (const p of PATTERNS.filter(x => x.workstationSetting)) {
    assert.equal(p.class, 'invocation', `${p.id} est marque reglage du poste hors invocation`);
  }
});

test('les motifs de protocole d outil sont reconnus mais exclus du conseil', () => {
  // Leur consigne existe deja dans la description des outils, relue a chaque
  // tour : les conseiller serait repeter ce que l agent lit deja. Ils sont
  // donc classes — pour etre exclus — et jamais marques reglage du poste.
  for (const id of ['inv-write-before-read', 'inv-read-without-pagination', 'inv-search-bad-pattern']) {
    const p = PATTERNS.find(x => x.id === id);
    assert.equal(p.class, 'invocation', `${id} doit rester classe invocation`);
    assert.equal(p.workstationSetting, false, `${id} ne doit pas declencher de conseil`);
  }
});

test('aucun motif hors invocation n est marque reglage du poste', () => {
  for (const p of PATTERNS.filter(x => x.class !== 'invocation')) {
    assert.equal(p.workstationSetting, false, `${p.id} : classe ${p.class} et marque reglage du poste`);
  }
});

test('CHAQUE motif de shell POSIX exige l estampille line N: du shell', () => {
  // L estampille est ce qui distingue un message EMIS par le shell d un
  // message CITE par un document ou un rapport de test. Enonce comme un
  // compte en prose — « les cinq motifs POSIX » — l invariant se perime des
  // qu on ajoute une ligne.
  //
  // La famille POSIX porte DEUX prefixes, et l oublier est ce qui vient
  // d arriver : `inv-cross-shell-cmdlet-in-posix` ne commence pas par
  // `inv-bash-`. Le compte est verrouille comme celui des motifs PowerShell
  // plus bas — un huitieme motif de shell fera echouer ce test, ce qui est le
  // seul moyen de forcer quelqu un a verifier qu il porte bien l estampille.
  const posix = PATTERNS.filter(p => /^inv-(?:bash|cross-shell)-/.test(p.id));
  assert.equal(posix.length, 7, 'la table doit porter sept motifs de shell POSIX');
  for (const p of posix) {
    assert.match(p.re.source, /line \\d\+:/,
      `${p.id} : motif de shell POSIX sans l estampille line N:`);
  }
});

test('LIMITE ECRITE : un journal de conteneur atteint le sous-ensemble qui alerte', () => {
  // `CMD`/`RUN` en forme shell lancent `sh -c`, donc un conteneur estampille
  // `-c: line N:` exactement comme le harnais le fait. La regle « l estampille
  // distingue l emis du cite » ne couvre pas ce cas, et la scission a double le
  // nombre de motifs alertants qui y sont exposes.
  //
  // Ce test ne decrit PAS un comportement voulu. Il rend la limite visible
  // dans la suite plutot qu en production. S il casse, c est qu on l a
  // corrigee : le remplacer alors, jamais le supprimer.
  const journalDeConteneur =
    "svc_1  | bash: -c: line 1: unexpected EOF while looking for matching `''";
  assert.equal(classify(journalDeConteneur).id, 'inv-bash-heredoc-too-large');
});

test('le filet generique ALERTE, parce qu un motif muet ne compte pas non plus', () => {
  // Une version anterieure de la scission l avait mis a false en le disant
  // « compte sans etre dit ». Le filtre du detecteur (viz-watchdog.mjs:495)
  // rend null AVANT le compteur : un motif non alertant est classe puis jete.
  // Et avant la scission, toute forme estampillee unexpected EOF sonnait —
  // n alerter que sur eval: et -c: rendait muette une troisieme forme.
  const p = PATTERNS.find(x => x.id === 'inv-bash-unbalanced-quote');
  assert.equal(p.class, 'invocation');
  assert.equal(p.workstationSetting, true, 'le filet doit alerter, sinon il se tait');
});

test('chaque ancre refuse l echantillon de l autre cause', () => {
  const antislash = 'Exit code 2 /usr/bin/bash: eval: line 1: unexpected EOF while looking for matching `"\'';
  const heredoc = "Exit code 2 /usr/bin/bash: -c: line 149: unexpected EOF while looking for matching `''";
  assert.equal(classify(antislash).id, 'inv-bash-trailing-backslash-in-path');
  assert.equal(classify(heredoc).id, 'inv-bash-heredoc-too-large');
});

// ═══ 5. CITER n est pas EMETTRE ════════════════════════════════════════════
//
// Le defaut le plus grave qu une revue independante a trouve dans ce module :
// le sous-ensemble qui alerte se declenchait sur du travail normal. 18 de ses
// 20 textes hostiles l atteignaient, dont — le cas le plus parlant — un `cat`
// du document de conception de ce detecteur, qui cite l erreur en clair.
//
// Le principe qui repare : si un texte porte la preuve qu un PROGRAMME a
// tourne et rendu un rapport — glyphe de runner de test, pile d execution,
// diagnostic de compilateur, sortie de script npm — alors le message systeme
// qu il contient y est CITE, pas EMIS. C est un verdict, et les motifs de
// verdict SPECIFIQUES doivent donc passer avant le sous-ensemble qui alerte.
//
// Le piege verifie a ne pas refaire : ne PAS remonter tous les verdicts.
// `vrd-exit-code-bare` matche `^\s*Exit code \d+`, or presque tout echec Bash
// commence ainsi ; devant les motifs d invocation il volerait tout et le
// detecteur deviendrait muet. Il doit rester le dernier filet.

const idx = id => {
  const i = PATTERNS.findIndex(p => p.id === id);
  assert.notEqual(i, -1, `motif absent de la table : ${id}`);
  return i;
};

// Les cinq motifs qui prouvent qu un programme a rendu un rapport. Ils sont
// nommes ici, et non deduits de la classe, parce que `vrd-exit-code-bare` est
// de la meme classe et ne prouve rien du tout.
const VERDICTS_SPECIFIQUES = [
  'vrd-test-runner', 'vrd-node-stacktrace', 'vrd-python-traceback',
  'vrd-npm-script', 'vrd-compiler-diagnostic',
];

// Le rapport d un `node --test` rouge dont l assertion CITE le message de
// bash. C est la premiere ligne du tableau de la revue.
const NODE_TEST_CITANT_BASH = [
  'Exit code 1',
  '\u2139 tests 12',
  '\u2139 fail 1',
  'not ok 3 - le shell refuse une quote non fermee',
  '  ---',
  '  error: |-',
  '    AssertionError: attendu /unexpected EOF while looking for matching/ dans le message',
  '  code: ERR_ASSERTION',
  '  stack: |-',
  '    TestContext.<anonymous> (file:///F:/DEV/x/tests/a.test.mjs:12:3)',
  '  ...',
].join('\n');

// Un `cat` du document de conception : de la prose francaise qui cite le
// message de bash au milieu d une phrase. Aucun marqueur de programme ici —
// c est le motif lui-meme qui doit refuser, parce que bash prefixe TOUJOURS
// ses messages de « line N: » et qu une citation ne le fait pas.
const DOC_CITANT_BASH = [
  'Trois sous-agents de la meme session ont bute a quelques minutes',
  "d intervalle sur `cd F:\\DEV\\agent-viz && ...` sous l outil Bash, qui",
  'repond `/usr/bin/bash: cd: F:DEVagent-viz: No such file or directory` ;',
  'le quatrieme sur `git diff | head` sous PowerShell.',
].join('\n');

// [ce que c est, texte, ce qui doit en sortir]. `null` = « aucun motif », une
// chaine = l identifiant attendu. Aucun de ces textes ne doit ALERTER.
const CITATIONS = [
  ['node --test rouge citant la quote non fermee', NODE_TEST_CITANT_BASH, 'vrd-test-runner'],
  ['shell d un conteneur docker (dash)', 'worker-1  | /bin/sh: 1: syntax error near unexpected token `(', null],
  ['binaire absent, nom capitalise', 'Exit code 127\n/usr/bin/bash: line 1: Docker-Compose: command not found', 'inv-cross-shell-cmdlet-in-posix'],
  ['binaire absent, nom minuscule', 'Exit code 127\n/usr/bin/bash: line 1: docker-compose: command not found', 'vrd-exit-code-bare'],
  // Classe par le generique de chemin absent — hors du chemin d alerte, ce
  // qui est tout ce qu on lui demande : une prose qui parle d un chemin
  // absent n est pas un reglage a poser.
  ['le document de conception, cite en clair', DOC_CITANT_BASH, 'inv-path-not-found'],
  ['prose citant la quote non fermee', 'le shell repond alors unexpected EOF while looking for matching, ce qui se corrige par un reglage', null],
  ['exploration ratee : un chemin POSIX absent', 'Exit code 1\n/usr/bin/bash: line 1: cd: /nonexistent/ailleurs: No such file or directory', 'inv-path-not-found'],
  ['vitest rouge dont le diff cite le chemin Windows', [
    'Exit code 1',
    ' \u00d7 tests/shell.test.ts > refuse un chemin non protege',
    '   AssertionError: expected message to match',
    "   - Expected: /usr/bin/bash: line 1: cd: F:DEVagent-viz: No such file or directory",
    ' Test Files  1 failed (1)',
  ].join('\n'), 'vrd-test-runner'],
  ['traceback python citant la syntaxe du shell', [
    'Traceback (most recent call last):',
    '  File "run.py", line 8, in <module>',
    '    raise RuntimeError(out)',
    'RuntimeError: /usr/bin/bash: line 1: syntax error near unexpected token `newline\'',
  ].join('\n'), 'vrd-python-traceback'],
  ['script npm citant un identifiant .NET', [
    '> agent-viz@0.9.0 verifie',
    '> node scripts/verifie.mjs',
    'attendu FullyQualifiedErrorId : CommandNotFoundException, recu rien',
    'npm ERR! code ELIFECYCLE',
  ].join('\n'), 'vrd-npm-script'],
];

test('un texte qui prouve qu un programme a tourne n atteint jamais le sous-ensemble qui alerte', () => {
  for (const [quoi, text, attendu] of CITATIONS) {
    const got = classify(text);
    if (got !== null) {
      const motif = PATTERNS.find(p => p.id === got.id);
      assert.equal(motif.workstationSetting, false,
        `${quoi} : a atteint le sous-ensemble qui alerte via ${got.id}`);
    }
    assert.equal(got === null ? null : got.id, attendu, `${quoi} : classe autrement qu attendu`);
  }
});

test('les motifs de verdict specifiques passent avant le sous-ensemble qui alerte', () => {
  const alertants = PATTERNS.filter(p => p.workstationSetting).map(p => idx(p.id));
  const premier = Math.min(...alertants);
  for (const id of VERDICTS_SPECIFIQUES) {
    assert.ok(idx(id) < premier,
      `${id} est en ${idx(id)} et le premier motif alertant en ${premier} : le verdict ne protege rien`);
  }
});

test('vrd-exit-code-bare reste le dernier filet, derriere tout ce qui alerte', () => {
  // Le piege que la revue a verifie : devant les motifs d invocation, ce motif
  // vole tout — « Exit code N » ouvre presque tout echec Bash — et le
  // detecteur devient muet. C est la pire panne possible pour cet outil.
  const dernierAlertant = Math.max(...PATTERNS.filter(p => p.workstationSetting).map(p => idx(p.id)));
  assert.ok(idx('vrd-exit-code-bare') > dernierAlertant);
  assert.equal(PATTERNS.at(-1).id, 'vrd-exit-code-bare');
});

test('les deux motifs neufs precedent le filet qui les avalerait', () => {
  // Le filet matche `line \d+: unexpected EOF ...`, donc les deux formes
  // specifiques aussi. Place devant elles, il prendrait tout et le detecteur
  // redeviendrait muet sur les deux causes a la fois.
  assert.ok(idx('inv-bash-trailing-backslash-in-path') < idx('inv-bash-unbalanced-quote'));
  assert.ok(idx('inv-bash-heredoc-too-large') < idx('inv-bash-unbalanced-quote'));
});

test('un binaire absent ne sonne pas, quelle que soit la casse de son nom', () => {
  // Le defaut D3 : `inv-cross-shell-cmdlet-in-posix` ne distinguait un cmdlet
  // PowerShell d un binaire absent que par la casse du nom, ce qui n est pas
  // un critere. Il pesait 1 occurrence, 1 projet, 1 acteur en 90 jours contre
  // 51 pour `env-binary-missing`. Il reste classe POUR ETRE EXCLU, et n est
  // pas compte non plus — le filtre du detecteur rend null avant son compteur.
  // A la difference du filet, rien ne se perd a le taire : `env-binary-missing`,
  // place au-dessus, classe deja le meme echec, et un binaire absent n a aucun
  // reglage de poste a offrir.
  const p = PATTERNS.find(x => x.id === 'inv-cross-shell-cmdlet-in-posix');
  assert.equal(p.workstationSetting, false);
  assert.ok(idx('env-binary-missing') < idx('inv-cross-shell-cmdlet-in-posix'),
    'un binaire absent doit etre reconnu comme tel avant d etre pris pour un melange de shells');
  for (const nom of ['Docker-Compose', 'docker-compose', 'Get-Item', 'ImageMagick-Convert']) {
    const got = classify(`Exit code 127\n/usr/bin/bash: line 1: ${nom}: command not found`);
    if (got === null) continue;
    const motif = PATTERNS.find(x => x.id === got.id);
    assert.equal(motif.workstationSetting, false, `${nom} sonne alors que l autre casse ne sonnerait pas`);
  }
});

// ═══ 6. Le retour arriere quadratique, mesure et non suppose ════════════════

test('classify ne retro-explore pas sur un long train de blancs', () => {
  // La forme qui declenche : `^\s*` sous le drapeau `m`, ou `\s` couvre `\n`.
  // A chaque debut de ligne le moteur avale tout le blanc qui suit puis
  // revient en arriere — exposant 2,00 mesure. `classify` tourne SYNCHRONE
  // dans `feedWatchdog` (lib/server/event-reader.js), donc ce retour arriere
  // bloque le serveur HTTP et le flux SSE.
  //
  // Le lorem ipsum de 1 Mo du test voisin ne le declenche PAS (7,9 ms) : il
  // n a aucun debut de ligne. C est la seule forme de 1 Mo incapable de
  // reveler le defaut, et c etait celle du test.
  const blancs = '\n'.repeat(60_000);
  const t0 = process.hrtime.bigint();
  assert.equal(classify(blancs), null);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  // 0,2 ms mesuree une fois les motifs rendus lineaires, ~3 500 ms avant.
  // Le seuil est a mi-chemin en echelle logarithmique : ni sensible a la
  // charge de la machine, ni indulgent envers le defaut.
  assert.ok(ms < 300, `classify a pris ${ms.toFixed(0)} ms sur 60 Ko de lignes vides`);
});

test('un long train de blancs suivi d un motif reste classe', () => {
  const text = '\n'.repeat(60_000) + '<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>';
  assert.equal(classify(text).id, 'inv-write-before-read');
});

// ═══ 7. L ancrage .NET : verrouille sur CHAQUE alternative ══════════════════

// Les alternatives de premier niveau d une expression : celles que `|` separe
// hors de toute parenthese et de toute classe de caracteres. Un garde qui
// cherche son ancre n importe ou dans la source se laisse defaire par une
// simple alternation — c est le defaut D5.
function alternativesDePremierNiveau(source) {
  const out = [];
  let courante = '', profondeur = 0, dansClasse = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') { courante += c + (source[i + 1] || ''); i++; continue; }
    if (dansClasse) { if (c === ']') dansClasse = false; courante += c; continue; }
    if (c === '[') { dansClasse = true; courante += c; continue; }
    if (c === '(') { profondeur++; courante += c; continue; }
    if (c === ')') { profondeur--; courante += c; continue; }
    if (c === '|' && profondeur === 0) { out.push(courante); courante = ''; continue; }
    courante += c;
  }
  out.push(courante);
  return out;
}

test('CHAQUE alternative de CHAQUE motif PowerShell exige FullyQualifiedErrorId', () => {
  // C est le coeur de la these du module : sur cette machine 100 % des
  // messages PowerShell sont en francais et onze ont leurs accents corrompus.
  // Seul l identifiant .NET traverse la langue. Un motif dont UNE alternative
  // s ancre ailleurs tombe des qu on traduit — en silence.
  const ps = PATTERNS.filter(p => p.id.startsWith('inv-ps-'));
  assert.equal(ps.length, 5, 'la table doit porter cinq motifs PowerShell');
  for (const p of ps) {
    for (const alt of alternativesDePremierNiveau(p.re.source)) {
      assert.match(alt, /FullyQualifiedErrorId/,
        `${p.id} : une alternative ne s ancre pas sur l identifiant .NET — ${alt}`);
    }
  }
});

test('aucun motif PowerShell n admet CategoryInfo', () => {
  // La decision du 2026-08-08 exclut `CategoryInfo` nommement : aucun des 37
  // motifs du releve ne l utilise, la mention venait de l auteur et non de la
  // mesure. Un garde qui l admet accepte exactement ce que la decision
  // interdit — un mutant ancre sur `CategoryInfo : InvalidArgument:` y
  // survivait.
  for (const p of PATTERNS) {
    assert.ok(!/CategoryInfo/.test(p.re.source),
      `${p.id} s ancre sur CategoryInfo, que la decision exclut`);
  }
});

test('un message PowerShell prive de FullyQualifiedErrorId n est pas classe, CategoryInfo present ou non', () => {
  for (const complet of [PS_COMMAND_NOT_FOUND_FR, PS_PARAMETER_NOT_FOUND_FR,
    PS_ARGUMENT_TYPE_FR, PS_SYNTAX_FR, PS_ARGUMENT_EXCEPTION_FR]) {
    const sansAncre = complet.split('\n').filter(l => !l.includes('FullyQualifiedErrorId')).join('\n');
    assert.ok(sansAncre.includes('CategoryInfo'), 'CategoryInfo doit etre reste dans l echantillon');
    assert.equal(classify(sansAncre), null,
      'un message PowerShell sans son identifiant .NET ne doit pas etre classe');
  }
});

// ═══ 8. Les 39 expressions, verrouillees contre les deux releves ═══════════
//
// Sans ce test, tout elargissement passe : la revue a fait survivre cinq
// mutants sur le chemin d alerte, dont `inv-bash-windows-path-unquoted`
// elargi a `/cd: [^\n]*: No such file or directory/`, ce qui ferait de toute
// exploration ratee une alerte.
//
// Le releve (doc/27, cf. docs/sources-externes.md) vit dans le depot PRIVE de
// la these et n est pas distribue avec agent-viz : ses 37 expressions sont donc
// recopiees ici une fois, extraites programmatiquement de son bloc
// `FAILURE_PATTERNS`, et ce fichier tient le role de temoin.

const RELEVE = new Map([
  ['harness-tool-disabled', String.raw`No such tool available: \S+\.[^]{0,40}not enabled in this context`, ''],
  ['harness-classifier-denied', String.raw`denied by the Claude Code auto mode classifier`, ''],
  ['harness-model-unavailable', String.raw`is temporarily unavailable, so auto mode cannot determine the safety`, ''],
  ['harness-user-rejected', String.raw`The user doesn't want to proceed with this tool use|Request interrupted`, ''],
  ['inv-bash-windows-path-unquoted', String.raw`cd: [A-Za-z]:[^\s/\\][^\s:]*: No such file or directory`, ''],
  ['inv-bash-cd-too-many-args', String.raw`cd: too many arguments`, ''],
  ['inv-bash-unbalanced-quote', String.raw`unexpected EOF while looking for matching`, ''],
  ['inv-bash-syntax-error', String.raw`syntax error near unexpected token`, ''],
  ['inv-cross-shell-cmdlet-in-posix', String.raw`\b[A-Z][a-z]+-[A-Z][A-Za-z]+: command not found`, ''],
  ['inv-ps-command-not-found', String.raw`FullyQualifiedErrorId\s*:\s*CommandNotFoundException`, ''],
  ['inv-ps-parameter-not-found', String.raw`FullyQualifiedErrorId\s*:\s*NamedParameterNotFound`, ''],
  ['inv-ps-argument-type', String.raw`FullyQualifiedErrorId\s*:\s*CannotConvertArgument`, ''],
  ['inv-ps-syntax', String.raw`FullyQualifiedErrorId\s*:\s*(?:ExpectedValueExpression|TerminatorExpectedAtEndOfString|MissingEndParenthesisInMethodCall|InvalidVariableReferenceWithDrive)`, ''],
  ['inv-tool-schema-rejected', String.raw`InputValidationError`, ''],
  ['inv-write-before-read', String.raw`File has not been read yet\. Read it first before writing to it`, ''],
  ['inv-read-without-pagination', String.raw`exceeds maximum allowed (?:tokens|size)[^]{0,120}offset and limit`, ''],
  ['inv-read-on-directory', String.raw`EISDIR: illegal operation on a directory`, ''],
  ['inv-edit-anchor-missing', String.raw`String to replace not found in file`, ''],
  ['inv-edit-noop', String.raw`No changes to make: old_string and new_string are exactly the same`, ''],
  ['inv-edit-replace-all-missing', String.raw`matches of the string to replace, but replace_all is false`, ''],
  ['inv-search-bad-pattern', String.raw`regex parse error|ripgrep rejected the pattern`, ''],
  ['inv-wrapper-unsupported', String.raw`\b\w+: \w+ \w+ does not support\b`, ''],
  ['inv-unknown-agent-or-skill', String.raw`Agent type '[^']*' not found|Unknown skill:|No such tool available`, ''],
  ['inv-git-bad-ref', String.raw`fatal: ambiguous argument|unknown revision or path not in the working tree`, ''],
  ['inv-ps-argument-exception', String.raw`FullyQualifiedErrorId\s*:\s*System\.ArgumentException`, ''],
  ['env-ssh-host-key-changed', String.raw`REMOTE HOST IDENTIFICATION HAS CHANGED`, ''],
  ['env-binary-missing', String.raw`is not installed\.|not found on PATH|Binary '[^']+' not found|est introuvable`, ''],
  ['env-browser-timeout', String.raw`Script injection timed out|Timeout \d+ms exceeded|page is busy or mid-navigation`, ''],
  ['env-network', String.raw`ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo|socket hang up`, ''],
  ['env-permission-denied', String.raw`Permission denied|EACCES|EPERM`, ''],
  ['vrd-test-runner', String.raw`^\s*(?:RUN|DEV)\s+v\d|Test Files\s+\d|ℹ tests \d|Tests:\s+\d|✔ |✓ |× |✗ `, 'm'],
  ['vrd-node-stacktrace', String.raw`node:internal\/|Cannot find module|^\s*at .+:\d+:\d+$`, 'm'],
  ['vrd-python-traceback', String.raw`Traceback \(most recent call last\)`, ''],
  ['vrd-npm-script', String.raw`npm (?:ERR!|error)|^> \S+@\d`, 'm'],
  ['vrd-compiler-diagnostic', String.raw`error TS\d+|SyntaxError|ReferenceError|TypeError|AssertionError`, ''],
  ['inv-path-not-found', String.raw`(?:Path|File) does not exist|No such file or directory|introuvable dans`, ''],
  ['vrd-exit-code-bare', String.raw`^\s*Exit code \d+`, ''],
].map(([id, source, flags]) => [id, { source, flags }]));

// Le SECOND releve (doc/30, 2026-08-08, meme depot prive) : deux
// motifs de plus, nes de la scission de `inv-bash-unbalanced-quote`, qui
// fusionnait deux causes. Ils ne vont PAS dans RELEVE — celui-ci est le temoin
// de doc/27, et les y glisser mentirait sur leur provenance, c est-a-dire sur
// la seule chose que cette section existe pour tenir. Meme role, meme
// discipline, autre source.
//
// `String.raw` ne convient pas ici et c est la seule raison du changement de
// style : un backtick ne peut pas figurer nu dans un litteral de gabarit, et
// l echapper ajouterait un antislash a la source comparee.
const RELEVE_30 = new Map([
  ['inv-bash-trailing-backslash-in-path',
   'eval: line \\d+: unexpected EOF while looking for matching `"', ''],
  ['inv-bash-heredoc-too-large',
   "-c: line \\d+: unexpected EOF while looking for matching `'", ''],
].map(([id, source, flags]) => [id, { source, flags }]));

// Ce que la table doit reproduire : l union des deux releves. Les ECARTS se
// declarent contre cette union, jamais contre l un des deux seulement.
const TEMOIN = new Map([...RELEVE, ...RELEVE_30]);

test('les deux temoins ne revendiquent jamais le meme motif', () => {
  // `new Map([...RELEVE, ...RELEVE_30])` laisse le second ECRASER le premier
  // en silence. C est la seule facon dont cette structure peut pourrir : un
  // troisieme releve re-declarant un motif existant effacerait la provenance
  // que la scission existe pour proteger, suite au vert.
  assert.equal(RELEVE.size + RELEVE_30.size, TEMOIN.size,
    'deux releves revendiquent le meme identifiant de motif');
});

// Les seuls ecarts admis au releve, chacun avec sa raison et sa nature.
//   `equivalent: true`  — le motif reconnait EXACTEMENT le meme ensemble de
//                         textes ; l ecart ne sert qu a rendre le motif
//                         lineaire.
//   `equivalent: false` — le motif reconnait STRICTEMENT MOINS ; l ecart
//                         retire un faux positif demontre.
// Rien d autre n est admis : un ecart qui elargirait est refuse par le test
// suivant, ecart declare ou non.
const ECARTS = new Map([
  ['vrd-test-runner', {
    source: String.raw`^[ \t]*(?:RUN|DEV)\s+v\d|Test Files\s+\d|ℹ tests \d|Tests:\s+\d|✔ |✓ |× |✗ `,
    flags: 'm', equivalent: true,
    pourquoi: 'linearisation : sous le drapeau m, `\\s` couvre `\\n` et fait retro-explorer chaque debut de ligne (exposant 2,00 mesure). `[ \\t]` ne traverse pas les lignes. Booleennement equivalent : si `\\s*` a franchi des lignes vides avant de matcher, le debut de la ligne atteinte est lui aussi une ancre `^`.',
  }],
  ['vrd-node-stacktrace', {
    source: String.raw`node:internal\/|Cannot find module|^[ \t]*at .+:\d+:\d+$`,
    flags: 'm', equivalent: true,
    pourquoi: 'meme linearisation, meme argument d equivalence.',
  }],
  ['inv-bash-windows-path-unquoted', {
    source: String.raw`line \d+: cd: [A-Za-z]:[^\s/\\][^\s:]*: No such file or directory`,
    flags: '', equivalent: false,
    pourquoi: 'bash estampille ses messages de « line N: » ; une CITATION du message ne le fait pas. Sans cette ancre, un `cat` du document de conception alertait.',
  }],
  ['inv-bash-cd-too-many-args', {
    source: String.raw`line \d+: cd: too many arguments`,
    flags: '', equivalent: false,
    pourquoi: 'meme ancre, meme famille de messages : les deux `cd:` viennent du meme shell et portent la meme estampille.',
  }],
  ['inv-bash-unbalanced-quote', {
    source: String.raw`line \d+: unexpected EOF while looking for matching`,
    flags: '', equivalent: false,
    pourquoi: 'meme ancre. Il fut le motif alertant le plus volumineux du releve (16 occurrences) ; doc/30 a montre qu il fusionnait deux causes et l a scinde en deux motifs plus specifiques. Il reste alertant, en dernier des trois : il ne se declenche que sur les formes qu aucune ancre ne reconnait, et l estampille reste ce qui distingue l emis du cite.',
  }],
  ['inv-bash-syntax-error', {
    source: String.raw`line \d+: syntax error near unexpected token`,
    flags: '', equivalent: false,
    pourquoi: 'meme ancre. Elle rejette au passage le shell d un conteneur, qui dit « sh: 1: syntax error » sans le mot « line ».',
  }],
  ['inv-cross-shell-cmdlet-in-posix', {
    source: String.raw`line \d+: [A-Z][a-z]+-[A-Z][A-Za-z]+: command not found`,
    flags: '', equivalent: false,
    pourquoi: 'meme ancre, pour que la ligne d un journal multiplexe de conteneur ne soit pas prise pour un message du shell local.',
  }],
]);

test('les 39 expressions sont celles des deux releves, ecart par ecart declare', () => {
  assert.deepEqual([...PATTERNS.map(p => p.id)].sort(), [...TEMOIN.keys()].sort(),
    'la table et les releves ne portent pas les memes identifiants');
  for (const p of PATTERNS) {
    const attendu = ECARTS.get(p.id) || TEMOIN.get(p.id);
    assert.equal(p.re.source, attendu.source, `${p.id} : expression non conforme`);
    assert.equal(p.re.flags, attendu.flags, `${p.id} : drapeaux non conformes`);
    if (ECARTS.has(p.id)) {
      assert.notEqual(p.re.source, TEMOIN.get(p.id).source,
        `${p.id} est declare en ecart alors qu il est conforme au releve`);
      assert.ok(ECARTS.get(p.id).pourquoi.length > 40, `${p.id} : ecart sans raison ecrite`);
    }
  }
});

// Le corpus contre lequel la relation « restreint » est verifiee : tous les
// echantillons du fichier, tous les textes hostiles, et les formes adverses
// que la citation fabrique.
const CORPUS = [
  ...SAMPLES.map(([, t]) => t),
  ...NON_INVOCATION.map(([, t]) => t),
  ...CITATIONS.map(([, t]) => t),
  'Exit code 1\n/usr/bin/bash: line 1: cd: /nonexistent: No such file or directory',
  'Exit code 1\n/usr/bin/bash: line 1: cd: ../ailleurs: No such file or directory',
  'cd: too many arguments',
  'unexpected EOF while looking for matching quote',
  'syntax error near unexpected token',
  'Select-String: command not found',
  'x\n\n\n RUN  v3.2.0\n',
  'boum\r\n    at f (x.mjs:1:2)\r\nfin',
  '\n\n\n   at f (x.mjs:10:5)\n',
  '\t\tat f (x.mjs:10:5)',
  'a\u2028    at f (x.mjs:1:2)\u2028b',
  'a\r    at f (x.mjs:1:2)\rb',
  'RUN\n\n  v3',
  'x\n   \n  \t at f (a.js:1:1)\n',
];

test('un ecart declare ne fait que RESTREINDRE le motif du releve, jamais l elargir', () => {
  for (const [id, ecart] of ECARTS) {
    const p = PATTERNS.find(x => x.id === id);
    const duReleve = new RegExp(TEMOIN.get(id).source, TEMOIN.get(id).flags);
    for (const text of CORPUS) {
      if (p.re.test(text)) {
        assert.ok(duReleve.test(text),
          `${id} matche un texte que le releve ne matchait pas : ${JSON.stringify(text.slice(0, 80))}`);
      }
      if (ecart.equivalent) {
        assert.equal(p.re.test(text), duReleve.test(text),
          `${id} est declare equivalent mais diverge sur ${JSON.stringify(text.slice(0, 80))}`);
      }
    }
  }
});

// ═══ 9. Les branches d alternative du chemin d alerte ═══════════════════════

// Les quatre identifiants .NET de `inv-ps-syntax`, chacun avec la prose
// francaise que PowerShell met devant. Trois des quatre n etaient exerces par
// aucun test, sur le chemin d alerte.
const PS_SYNTAX_VARIANTES = [
  ['ExpectedValueExpression', [
    'Vous devez indiquer une expression de valeur apr\uFFFDs l\u2019op\uFFFDrateur \u00ab -match \u00bb.',
    '    + FullyQualifiedErrorId : ExpectedValueExpression',
  ].join('\n')],
  ['TerminatorExpectedAtEndOfString', [
    'Le terminateur " est manquant dans la cha\u00eene.',
    '    + FullyQualifiedErrorId : TerminatorExpectedAtEndOfString',
  ].join('\n')],
  ['MissingEndParenthesisInMethodCall', [
    'Parenth\u00e8se fermante \u00ab ) \u00bb manquante dans l\u2019appel de m\u00e9thode.',
    '    + FullyQualifiedErrorId : MissingEndParenthesisInMethodCall',
  ].join('\n')],
  ['InvalidVariableReferenceWithDrive', [
    'La r\u00e9f\u00e9rence de variable n\u2019est pas valide. \u00ab:\u00bb n\u2019est pas suivi d\u2019un',
    'caract\u00e8re de nom de variable valide.',
    '    + FullyQualifiedErrorId : InvalidVariableReferenceWithDrive',
  ].join('\n')],
];

test('les quatre identifiants .NET de inv-ps-syntax sont exerces, un par un', () => {
  for (const [nom, text] of PS_SYNTAX_VARIANTES) {
    assert.deepEqual(classify(text), { id: 'inv-ps-syntax', class: 'invocation' },
      `${nom} : identifiant .NET non reconnu`);
  }
});

// Les branches que le releve a observees mais dont ce fichier ne portait aucun
// echantillon : 23 sur les 37 motifs, comptees et non estimees. Ce ne sont pas
// des extraits du releve — ce sont des temoins minimaux, juste assez pour que
// personne n ajoute une branche sans qu on sache si elle matche la forme
// qu elle annonce. Les extraits reels, eux, sont dans SAMPLES.
const TEMOINS_DE_BRANCHE = [
  'Request interrupted by user',
  'Exit code 1\nrtk: not found on PATH',
  "Exit code 1\nBinary 'rtk' not found",
  'Exit code 1\nLe programme \u00ab rtk \u00bb est introuvable sur ce poste.',
  'Script injection timed out after 5000ms',
  'the page is busy or mid-navigation',
  'Error: connect ETIMEDOUT 10.0.0.1:443',
  'Error: getaddrinfo ENOTFOUND registry.example',
  'Error: socket hang up',
  "EPERM: operation not permitted, rename '<CHEMIN>'",
  'sh: 1: Permission denied',
  'Tests:       3 failed, 10 passed, 13 total',
  '\u2714 tout va bien',
  '\u2717 ca casse',
  "Error: Cannot find module '<CHEMIN>/absent.mjs'",
  '    at async Promise.all (index 0)\n    at file:///F:/x/a.test.mjs:12:3',
  'npm error code ELIFECYCLE',
  'SyntaxError: Unexpected end of JSON input',
  'ReferenceError: foo is not defined',
  "TypeError: Cannot read properties of undefined (reading 'x')",
  'Unknown skill: caveman',
  '<tool_use_error>Cha\u00eene introuvable dans le fichier</tool_use_error>',
];

test('chaque branche d alternative de CHAQUE motif a un echantillon', () => {
  // Une branche jamais exercee est une branche dont personne ne sait si elle
  // marche — et sur le chemin d alerte, personne ne sait si elle sonne a tort.
  const corpus = [...CORPUS, ...PS_SYNTAX_VARIANTES.map(([, t]) => t), ...TEMOINS_DE_BRANCHE];
  for (const p of PATTERNS) {
    const branches = [];
    for (const alt of alternativesDePremierNiveau(p.re.source)) {
      const groupe = alt.match(/^(.*)\(\?:([^()]*)\)$/);
      if (groupe && groupe[2].includes('|')) {
        for (const b of groupe[2].split('|')) branches.push(groupe[1] + b);
      } else branches.push(alt);
    }
    for (const branche of branches) {
      const re = new RegExp(branche, p.re.flags);
      assert.ok(corpus.some(t => re.test(t)),
        `${p.id} : branche jamais exercee — ${branche}`);
    }
  }
});

test('les deux ancrages francais de la table sont exerces', () => {
  // « est introuvable » et « introuvable dans » sont les seuls ancrages
  // francais de la table, dans un module dont la these est le piege de la
  // langue — et aucun test ne les touchait.
  assert.deepEqual(classify("Exit code 1\nLe programme \u00ab rtk \u00bb est introuvable sur ce poste."),
    { id: 'env-binary-missing', class: 'environment' });
  assert.deepEqual(classify('<tool_use_error>Cha\u00eene introuvable dans le fichier</tool_use_error>'),
    { id: 'inv-path-not-found', class: 'invocation' });
});

// ═══ 10. La table est un temoin, pas une variable globale ═══════════════════

test('PATTERNS est gele : un importateur ne peut pas detourner classify pour tout le monde', () => {
  // `PATTERNS` est exporte pour que le detecteur y lise `workstationSetting`
  // au lieu de recopier la liste. Exporte non gele, il offrait aussi
  // `PATTERNS.unshift(...)` a n importe quel importateur — et l ordre de cette
  // table est la moitie de ce que le module garantit.
  assert.ok(Object.isFrozen(PATTERNS), 'la table n est pas gelee');
  assert.throws(() => PATTERNS.unshift({ id: 'MUTANT', class: 'invocation', workstationSetting: true, re: /./ }), TypeError);
  assert.throws(() => { PATTERNS[0] = null; }, TypeError);
  assert.throws(() => { PATTERNS.length = 0; }, TypeError);
  for (const p of PATTERNS) {
    assert.ok(Object.isFrozen(p), `${p.id} : entree non gelee`);
    assert.throws(() => { p.workstationSetting = !p.workstationSetting; }, TypeError);
  }
  assert.equal(classify('Exit code 1\n/usr/bin/bash: line 1: cd: too many arguments').id,
    'inv-bash-cd-too-many-args', 'la table a bouge malgre tout');
});

// ═══ 11. La vie privee : un vocabulaire ferme, pas un test de sous-chaine ═══

test('la sortie de classify est tiree d un vocabulaire ferme', () => {
  // C est CA la garantie, et non « la valeur n est pas un morceau du texte
  // recu » : rejoue sur les 587 echecs reels, cet oracle-la crie 10 fois,
  // parce que « verdict » est un mot que les scripts de ce depot impriment. Il
  // marchait par chance sur les echantillons choisis.
  //
  // Le vocabulaire est fixe au chargement du module et ne depend d aucune
  // entree : aucune chaine venue du texte ne peut donc en sortir.
  const vocabulaire = new Set([...PATTERNS.map(p => p.id), ...CLASSES]);
  const textes = [...CORPUS, ...PS_SYNTAX_VARIANTES.map(([, t]) => t),
    'ANTHROPIC_API_KEY=sk-ant-000 verdict invocation harness environment inv-edit-noop',
  ];
  for (const text of textes) {
    const got = classify(text);
    if (got === null) continue;
    assert.deepEqual(Object.keys(got), ['id', 'class'], 'la sortie porte un champ de plus');
    for (const [champ, valeur] of Object.entries(got)) {
      assert.ok(vocabulaire.has(valeur),
        `la valeur de ${champ} sort du vocabulaire de la table : ${valeur}`);
    }
  }
});
