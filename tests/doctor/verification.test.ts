// La queue non vérifiée par session (doc/41) : fusion inter-agents par
// horodatage, dédup d'usage par message.id, une édition en erreur n'a rien
// modifié, un événement sans horodatage est compté — jamais classé au hasard.
//
// POURQUOI CE FICHIER EST UN `.test.ts` À L'API VITEST, ET NON UN `.test.mjs`.
// Son voisin `verification-commands.test.mjs` a pu passer sous les DEUX
// exécuteurs ; celui-ci ne le peut pas, et la raison n'est pas dans le test.
// `src/engine/**` désigne ses voisins par des spécificateurs en `.js`
// (111 occurrences, aucune en `.ts` — l'inverse exact de `src/server/**`) :
// `aggregators/verification.ts` importe `../../core/usage.js`, qui n'existe
// pas sur le disque. Seul le résolveur de vitest recolle `.js` sur `.ts` ;
// `node --test` rend ERR_MODULE_NOT_FOUND (mesuré le 2026-08-17 sur node
// v24.15.0, et reproduit hors dépôt sur deux fichiers nus). Le tronc du
// moteur n'est donc chargeable depuis ses SOURCES que par vitest — le serveur,
// lui, passe par `requireEngineModule` et lit le `dist/`.
// Conséquence assumée : l'extension dit le régime (ARCHITECTURE.md § 9), et
// le régime possible ici est vitest. Ce fichier n'est plus un hybride.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { VerificationAggregator } from '../../src/engine/doctor/aggregators/verification.ts';

const T = (m: number) => `2026-08-17T10:${String(m).padStart(2, '0')}:00.000Z`;

function assistant(over: Record<string, unknown> = {}) {
  return { kind: 'assistant' as const, msgId: null, model: null, usage: null,
    toolUses: [], textChars: 0, isSidechain: false, ...over };
}
function toolResult(over: Record<string, unknown> = {}) {
  return { kind: 'tool_result' as const, toolUseId: 'x', bytes: 0,
    isError: false, contentHash: null, ...over };
}
const edit = (id: string, path: string, at: string) =>
  assistant({ timestamp: at, toolUses: [{ id, name: 'Edit', input: { file_path: path } }] });
const bash = (id: string, command: string, at: string) =>
  assistant({ timestamp: at, toolUses: [{ id, name: 'Bash', input: { command } }] });

test('une edition suivie d un test vert ne laisse aucune queue', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(edit('e1', 'F:/proj/a.ts', T(1)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'e1', timestamp: T(1) }) as never);
  agg.addAssistant(bash('v1', 'npm test', T(5)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'v1', timestamp: T(6) }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.editsTotal, 1);
  assert.equal(stats.verifications, 1);
  assert.equal(stats.editsAfterLastVerification, 0);
  assert.equal(stats.lastVerification?.ok, true);
  assert.equal(stats.lastVerification?.kind, 'test');
});

test('une edition posterieure a la derniere verification est la queue', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(bash('v1', 'npx vitest run', T(1)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'v1', timestamp: T(2) }) as never);
  agg.addAssistant(edit('e1', 'F:/proj/a.ts', T(5)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'e1', timestamp: T(5) }) as never);
  agg.addAssistant(edit('e2', 'F:/proj/a.ts', T(7)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'e2', timestamp: T(7) }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.editsAfterLastVerification, 2);
  assert.deepEqual(stats.filesAfterLastVerification, ['F:/proj/a.ts']);
  assert.equal(stats.filesAfterLastVerificationTotal, 1);
});

test('sans aucune verification, tout est la queue - jetons compris', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(edit('e1', 'F:/proj/a.ts', T(1)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'e1', timestamp: T(1) }) as never);
  agg.addAssistant(assistant({ msgId: 'm1', timestamp: T(2),
    usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 999 } }) as never, 'main');
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.verifications, 0);
  assert.equal(stats.editsAfterLastVerification, 1);
  assert.equal(stats.tokensAfterLastVerification, 160, 'net = in + cacheCreate + out, cacheRead exclu');
});

test('la chronologie inter-agents suit l horodatage, pas l ordre de lecture', () => {
  // Arrange — le scan lit main PUIS le sous-agent ; ici le sous-agent a vérifié APRÈS les éditions de main.
  const agg = new VerificationAggregator();
  agg.addAssistant(edit('e1', 'F:/proj/a.ts', T(10)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'e1', timestamp: T(10) }) as never);
  agg.addAssistant(bash('v1', 'npm test', T(20)) as never, 'agent-01');
  agg.addToolResult(toolResult({ toolUseId: 'v1', timestamp: T(21) }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.editsAfterLastVerification, 0, 'le test du sous-agent couvre l edition de main');
});

test('une verification rouge reste une verification, comptee en echec', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(bash('v1', 'npm test', T(1)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'v1', timestamp: T(2), isError: true }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.verifications, 1);
  assert.equal(stats.verificationsFailed, 1);
  assert.equal(stats.lastVerification?.ok, false);
});

test('une edition en erreur n a rien modifie, une commande non classee n est rien', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(edit('e1', 'F:/proj/a.ts', T(1)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'e1', timestamp: T(1), isError: true }) as never);
  agg.addAssistant(bash('b1', 'git status', T(2)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'b1', timestamp: T(2) }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.editsTotal, 0);
  assert.equal(stats.verifications, 0);
});

test('l usage d un meme message.id repete par bloc de contenu compte une fois', () => {
  // Arrange
  const agg = new VerificationAggregator();
  const usage = { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  agg.addAssistant(assistant({ msgId: 'm1', timestamp: T(1), usage }) as never, 'main');
  agg.addAssistant(assistant({ msgId: 'm1', timestamp: T(1), usage }) as never, 'main');
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.tokensAfterLastVerification, 150);
});

test('un evenement sans horodatage est compte unordered, jamais classe', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(edit('e1', 'F:/proj/a.ts', undefined as never) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'e1' }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.editsTotal, 0);
  assert.equal(stats.unordered, 1);
});

test('PowerShell est un porteur de commande au meme titre que Bash', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(assistant({ timestamp: T(1),
    toolUses: [{ id: 'v1', name: 'PowerShell', input: { command: 'npm test' } }] }) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'v1', timestamp: T(2) }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.verifications, 1);
});

test('un lancement en arriere-plan accuse le depart, il ne rend aucun verdict', () => {
  // Arrange — le tool_result est vert, mais c'est l'accusé de lancement : le
  // compter fabriquerait un `ok: true` sans preuve (doc/41, D4).
  const agg = new VerificationAggregator();
  agg.addAssistant(assistant({ timestamp: T(1),
    toolUses: [{ id: 'v1', name: 'Bash', input: { command: 'npm test', run_in_background: true } }] }) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'v1', timestamp: T(2) }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.verifications, 0);
  assert.equal(stats.lastVerification, null);
});

test('les affectations d environnement ne sont pas stockees avec la commande', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(bash('v1', 'NPM_TOKEN=abc npm test', T(1)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'v1', timestamp: T(2) }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.verifications, 1, 'le classifieur voit toujours la commande entiere');
  assert.equal(stats.lastVerification?.command, 'npm test');
  assert.equal(JSON.stringify(stats).includes('abc'), false, 'le secret n apparait nulle part');
});

// Non-regression de l elargissement : la forme ancree retirait deja une
// affectation a valeur VIDE. L expression elargie doit continuer de le faire.
test('une affectation a valeur vide est retiree comme les autres', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(bash('v1', 'FOO= npm test', T(1)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'v1', timestamp: T(2) }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.lastVerification?.command, 'npm test');
});

// Revue finale de branche (ruling 20) : le nettoyage etait ancre en TETE de
// chaine. Les deux formes ci-dessous echappaient donc a la redaction et
// entraient verbatim dans le rapport PERSISTE.
test('une affectation au MILIEU d un compose est retiree elle aussi', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(bash('v1', 'cd repo && NPM_TOKEN=xxx npm test', T(1)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'v1', timestamp: T(2) }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.verifications, 1, 'le classifieur voit toujours la commande entiere');
  assert.equal(stats.lastVerification?.command, 'cd repo && npm test');
  assert.equal(JSON.stringify(stats).includes('xxx'), false, 'le secret n apparait nulle part');
});

test('une valeur entre guillemets est retiree entiere, espaces compris', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(bash('v1', 'TOKEN="a b" npm test', T(1)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'v1', timestamp: T(2) }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.verifications, 1, 'le classifieur voit toujours la commande entiere');
  assert.equal(stats.lastVerification?.command, 'npm test');
  assert.equal(JSON.stringify(stats).includes('a b'), false, 'le secret n apparait nulle part');
});

// FILES_CAP : la liste de noms est plafonnee a 20, et le TOTAL dit la coupe —
// sans quoi un lecteur croirait le projet a 20 fichiers laisses sans preuve.
test('la liste des fichiers est plafonnee a 20, triee, et le total dit la coupe', () => {
  // Arrange — 25 fichiers distincts, tous edites apres la derniere verification.
  const agg = new VerificationAggregator();
  agg.addAssistant(bash('v1', 'npm test', T(1)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'v1', timestamp: T(2) }) as never);
  const chemins: string[] = [];
  for (let i = 1; i <= 25; i += 1) {
    const chemin = `F:/proj/f${String(i).padStart(2, '0')}.ts`;
    chemins.push(chemin);
    agg.addAssistant(edit(`e${i}`, chemin, T(10)) as never, 'main');
    agg.addToolResult(toolResult({ toolUseId: `e${i}`, timestamp: T(10) }) as never);
  }
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.editsAfterLastVerification, 25);
  assert.equal(stats.filesAfterLastVerificationTotal, 25, 'le total compte les 25, jamais les 20 affiches');
  assert.equal(stats.filesAfterLastVerification.length, 20);
  assert.deepEqual(stats.filesAfterLastVerification, [...chemins].sort().slice(0, 20),
    'la liste plafonnee est celle des 20 PREMIERS d un tri stable, pas un echantillon d ordre de lecture');
});

test('la premiere verification, la premiere edition et les fichiers distincts sont rendus', () => {
  // Arrange — 2 verifications, 2 editions de fichiers distincts.
  const agg = new VerificationAggregator();
  agg.addAssistant(edit('e1', 'F:/proj/a.ts', T(1)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'e1', timestamp: T(1) }) as never);
  agg.addAssistant(bash('v1', 'npm run build', T(2)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'v1', timestamp: T(3) }) as never);
  agg.addAssistant(edit('e2', 'F:/proj/b.ts', T(4)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'e2', timestamp: T(4) }) as never);
  agg.addAssistant(bash('v2', 'npm test', T(5)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'v2', timestamp: T(6) }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.verifications, 2);
  assert.equal(stats.firstVerification?.kind, 'build', 'la PREMIERE, pas la derniere');
  assert.equal(stats.firstVerification?.at, T(3), 'datee du resultat, comme lastVerification');
  assert.equal(stats.firstVerification?.command, 'npm run build');
  assert.equal(stats.lastVerification?.kind, 'test');
  assert.equal(stats.firstEditAt, T(1));
  assert.equal(stats.editsTotal, 2);
  assert.equal(stats.editedFiles, 2, 'deux fichiers DISTINCTS, jamais le compte d editions');
});

// La frontiere est STRICTE (`e.t > last.t`) : a la milliseconde exacte du
// resultat, l edition est dite COUVERTE. Sens conservateur assume — le produit
// sous-declare la queue plutot que d accuser une session sur une egalite.
test('une edition a la milliseconde exacte du dernier resultat est couverte', () => {
  // Arrange
  const agg = new VerificationAggregator();
  agg.addAssistant(bash('v1', 'npm test', T(1)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'v1', timestamp: T(5) }) as never);
  agg.addAssistant(edit('e1', 'F:/proj/a.ts', T(5)) as never, 'main');
  agg.addToolResult(toolResult({ toolUseId: 'e1', timestamp: T(5) }) as never);
  // Act
  const stats = agg.result();
  // Assert
  assert.equal(stats.editsTotal, 1);
  assert.equal(stats.editsAfterLastVerification, 0, 'egalite stricte : couverte, jamais en queue');
  assert.deepEqual(stats.filesAfterLastVerification, []);
});
