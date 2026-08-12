'use strict';
// C5 (docs/audit-qualite-code.md) : DEUX variables d'environnement désignaient le
// même dossier de configuration dans un SEUL paquet npm — `CLAUDE_CONFIG_DIR`
// ici (lib/server/observatory/index.js:24), `NETGAIN_CLAUDE_DIR` côté moteur
// (src/engine/doctor/index.ts:112). Poser l'une ne déplaçait que la moitié
// correspondante : deux vues du même produit sur deux jeux de sessions, sans
// qu'aucun message n'avertisse de l'écart.
//
// Les quatre croisements ont été prouvés PAR EXÉCUTION avant qu'une ligne soit
// écrite, sur le code d'avant :
//   NETGAIN_CLAUDE_DIR posée → moteur 1 session · serveur `~/.claude`
//   CLAUDE_CONFIG_DIR  posée → moteur 0 session · serveur dossier posé
//
// Ce fichier est le filet de la moitié SERVEUR. Il ne teste pas la primitive —
// `netgain/tests/core/claude-dir.test.ts` s'en charge — mais le BRANCHEMENT :
// sans lui, une primitive parfaite pourrait coexister avec une ligne 24 restée
// sur sa propre expression, et les deux moitiés redivergeraient en silence.
//
// Comment on observe la valeur sans ouvrir de base ni de socket : les quatre
// voisins du module de composition sont remplacés dans le cache de `require`
// AVANT de le charger, ce qui laisse la seule résolution s'exécuter pour de vrai.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const Module = require('module');

const CIBLE = require.resolve('../../lib/server/observatory/index.js');
const dossier = path.dirname(CIBLE);

function resoudreAvec(env) {
  for (const cle of Object.keys(require.cache)) delete require.cache[cle];

  let vu = null;
  let vuConfig = null;
  const poser = (rel, exports) => {
    const abs = Module._resolveFilename(rel, {
      id: CIBLE, filename: CIBLE, paths: Module._nodeModulePaths(dossier),
    });
    const m = new Module(abs, null);
    m.filename = abs;
    m.loaded = true;
    m.exports = exports;
    require.cache[abs] = m;
  };
  poser('./store', { openStore: () => ({}) });
  poser('./engine', { loadEngine: () => {} });
  poser('./config-audit', { collectConfigItems: (_io, chemins) => { vuConfig = chemins; return []; } });
  poser('./service', { createObservatoryService: (deps) => { vu = deps; deps.collectConfig(); return {}; } });
  poser('../sse', { broadcastSSE: () => {} });

  const anciennes = {};
  for (const [cle, valeur] of Object.entries(env)) {
    anciennes[cle] = process.env[cle];
    if (valeur === undefined) delete process.env[cle];
    else process.env[cle] = valeur;
  }
  try {
    require(CIBLE).getObservatoryService();
    return { claudeDir: vu.claudeDir, claudeJsonPath: vuConfig.claudeJsonPath };
  } finally {
    for (const [cle, valeur] of Object.entries(anciennes)) {
      if (valeur === undefined) delete process.env[cle];
      else process.env[cle] = valeur;
    }
    for (const cle of Object.keys(require.cache)) delete require.cache[cle];
  }
}

const AILLEURS = path.join(os.tmpdir(), 'agent-viz-c5-ailleurs');

test('CLAUDE_CONFIG_DIR déplace la racine du serveur', () => {
  assert.strictEqual(
    resoudreAvec({ CLAUDE_CONFIG_DIR: AILLEURS, NETGAIN_CLAUDE_DIR: undefined }).claudeDir,
    AILLEURS,
  );
});

// Témoin négatif : sans lui, un serveur qui lirait EN PLUS l'ancienne variable
// passerait le test ci-dessus sans rien prouver.
test('NETGAIN_CLAUDE_DIR ne déplace rien côté serveur — un seul nom vit', () => {
  assert.strictEqual(
    resoudreAvec({ CLAUDE_CONFIG_DIR: undefined, NETGAIN_CLAUDE_DIR: AILLEURS }).claudeDir,
    path.join(os.homedir(), '.claude'),
  );
});

test('sans rien de posé, c’est <home>/.claude', () => {
  assert.strictEqual(
    resoudreAvec({ CLAUDE_CONFIG_DIR: undefined, NETGAIN_CLAUDE_DIR: undefined }).claudeDir,
    path.join(os.homedir(), '.claude'),
  );
});

// `.claude.json` porte l'inventaire MCP que lit la carte R2. La même variable le
// déplace — établi PAR EXÉCUTION sur Claude Code 2.1.226, dans un home jetable :
// posée, le fichier est écrit DANS le dossier de configuration ; non posée, à
// côté du home. Le produit le cherchait au home dans les deux cas : c'est ce qui
// fait disparaître R2 du protocole de contrôle (USERPROFILE jetable +
// CLAUDE_CONFIG_DIR réel), un coût noté comme « assumé » alors qu'il était ce
// défaut-ci.
test('CLAUDE_CONFIG_DIR déplace AUSSI .claude.json — dans le dossier, pas au home', () => {
  assert.strictEqual(
    resoudreAvec({ CLAUDE_CONFIG_DIR: AILLEURS, NETGAIN_CLAUDE_DIR: undefined }).claudeJsonPath,
    path.join(AILLEURS, '.claude.json'),
  );
});

test('sans variable, .claude.json reste à CÔTÉ du dossier, pas dedans', () => {
  const vu = resoudreAvec({ CLAUDE_CONFIG_DIR: undefined, NETGAIN_CLAUDE_DIR: undefined });
  assert.strictEqual(vu.claudeJsonPath, path.join(os.homedir(), '.claude.json'));
  assert.notStrictEqual(vu.claudeJsonPath, path.join(vu.claudeDir, '.claude.json'));
});

// Une variable VIDE est une variable non posée. Le serveur le faisait déjà par
// `||` ; le moteur, lui, employait `??` et scannait la chaîne vide en annonçant
// « 0 session(s) découverte(s) sous  » — une cécité totale et silencieuse. C'est
// le sens du serveur qui a été retenu des deux côtés : ce test le VERROUILLE ici
// pour qu'une future unification ne l'emporte pas dans l'autre sens.
test('une variable VIDE retombe sur le home', () => {
  assert.strictEqual(
    resoudreAvec({ CLAUDE_CONFIG_DIR: '', NETGAIN_CLAUDE_DIR: undefined }).claudeDir,
    path.join(os.homedir(), '.claude'),
  );
});

// Le point de C5 : ce n'est pas « le serveur lit la bonne variable », c'est que
// les deux moitiés lisent au MÊME ENDROIT. Deux expressions identiques mais
// séparées avaient déjà divergé une fois (sur la chaîne vide) sans que personne
// ne le voie.
test('le serveur passe par la primitive du moteur, pas par sa propre expression', () => {
  const { resolveClaudeDir, CLAUDE_DIR_ENV } = require('../../lib/server/claude-dir');
  assert.strictEqual(typeof resolveClaudeDir, 'function');
  assert.strictEqual(CLAUDE_DIR_ENV, 'CLAUDE_CONFIG_DIR');
  const { resolveClaudeDir: duMoteur } = require('../../dist/engine/core/claude-dir.js');
  assert.strictEqual(resolveClaudeDir, duMoteur);
});
