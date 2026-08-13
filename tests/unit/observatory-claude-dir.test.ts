// C5 (docs/audit-qualite-code.md) : DEUX variables d'environnement désignaient le
// même dossier de configuration dans un SEUL paquet npm — `CLAUDE_CONFIG_DIR`
// ici (src/server/observatory/index.js:24), `NETGAIN_CLAUDE_DIR` côté moteur
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
// `tests/core/claude-dir.test.ts` s'en charge — mais le BRANCHEMENT :
// sans lui, une primitive parfaite pourrait coexister avec une ligne 24 restée
// sur sa propre expression, et les deux moitiés redivergeraient en silence.
//
// Comment on observe la valeur sans ouvrir de base ni de socket : les cinq
// voisins du module de composition sont BOUCHONNÉS avant qu'il soit chargé, ce
// qui laisse la seule résolution s'exécuter pour de vrai. Le bouchon de
// `./store` n'est pas un confort : sans lui, charger ce module ouvre
// `~/.agent-viz/observatory.db`, c'est-à-dire la base de mesure de la machine.
//
// POURQUOI CE FICHIER EST LE SEUL À AVOIR MIGRÉ VERS VITEST (D13). Il tenait
// ses bouchons par `require.cache`, mécanisme que la bascule en ES modules rend
// INERTE — mesuré : la substitution rend le VRAI voisin, la purge rend la MÊME
// instance, et les deux moitiés meurent en silence, `exit=0`. L'amorçage de
// bouchons n'a pas d'équivalent ES natif : `vi.resetModules()` + `vi.doMock()`
// + `await import()` est le seul remède à propriété prouvée identique — une
// instance neuve par appel, et les cinq voisins remplacés AVANT le chargement.
// Le prix, assumé et écrit : ses 7 tests quittent la sémantique de référence de
// `node --test`.
import { test, vi } from 'vitest';
import assert from 'node:assert';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const CIBLE = '../../src/server/observatory/index.js';

async function resoudreAvec(env: Record<string, string | undefined>) {
  vi.resetModules();

  let vu: any = null;
  let vuConfig: any = null;

  // Les CINQ voisins d'`observatory/index.js`, bouchonnés par leur spécificateur
  // résolu depuis CE fichier — c'est ainsi que `vi.doMock` les apparie.
  vi.doMock('../../src/server/observatory/store.js', () => ({ openStore: () => ({}) }));
  vi.doMock('../../src/server/observatory/engine.js', () => ({ loadEngine: () => {} }));
  vi.doMock('../../src/server/observatory/config-audit.js', () => ({
    collectConfigItems: (_io: any, chemins: any) => { vuConfig = chemins; return []; },
  }));
  vi.doMock('../../src/server/observatory/service.js', () => ({
    createObservatoryService: (deps: any) => { vu = deps; deps.collectConfig(); return {}; },
  }));
  vi.doMock('../../src/server/sse.js', () => ({ broadcastSSE: () => {} }));

  const anciennes: Record<string, string | undefined> = {};
  for (const [cle, valeur] of Object.entries(env)) {
    anciennes[cle] = process.env[cle];
    if (valeur === undefined) delete process.env[cle];
    else process.env[cle] = valeur;
  }
  try {
    const mod: any = await import(CIBLE);
    mod.getObservatoryService();
    return { claudeDir: vu.claudeDir, claudeJsonPath: vuConfig.claudeJsonPath };
  } finally {
    for (const [cle, valeur] of Object.entries(anciennes)) {
      if (valeur === undefined) delete process.env[cle];
      else process.env[cle] = valeur;
    }
    vi.doUnmock('../../src/server/observatory/store.js');
    vi.doUnmock('../../src/server/observatory/engine.js');
    vi.doUnmock('../../src/server/observatory/config-audit.js');
    vi.doUnmock('../../src/server/observatory/service.js');
    vi.doUnmock('../../src/server/sse.js');
    vi.resetModules();
  }
}

const AILLEURS = path.join(os.tmpdir(), 'agent-viz-c5-ailleurs');

test('CLAUDE_CONFIG_DIR déplace la racine du serveur', async () => {
  assert.strictEqual(
    (await resoudreAvec({ CLAUDE_CONFIG_DIR: AILLEURS, NETGAIN_CLAUDE_DIR: undefined })).claudeDir,
    AILLEURS,
  );
});

// Témoin négatif : sans lui, un serveur qui lirait EN PLUS l'ancienne variable
// passerait le test ci-dessus sans rien prouver.
test('NETGAIN_CLAUDE_DIR ne déplace rien côté serveur — un seul nom vit', async () => {
  assert.strictEqual(
    (await resoudreAvec({ CLAUDE_CONFIG_DIR: undefined, NETGAIN_CLAUDE_DIR: AILLEURS })).claudeDir,
    path.join(os.homedir(), '.claude'),
  );
});

test('sans rien de posé, c’est <home>/.claude', async () => {
  assert.strictEqual(
    (await resoudreAvec({ CLAUDE_CONFIG_DIR: undefined, NETGAIN_CLAUDE_DIR: undefined })).claudeDir,
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
test('CLAUDE_CONFIG_DIR déplace AUSSI .claude.json — dans le dossier, pas au home', async () => {
  assert.strictEqual(
    (await resoudreAvec({ CLAUDE_CONFIG_DIR: AILLEURS, NETGAIN_CLAUDE_DIR: undefined })).claudeJsonPath,
    path.join(AILLEURS, '.claude.json'),
  );
});

test('sans variable, .claude.json reste à CÔTÉ du dossier, pas dedans', async () => {
  const vu = await resoudreAvec({ CLAUDE_CONFIG_DIR: undefined, NETGAIN_CLAUDE_DIR: undefined });
  assert.strictEqual(vu.claudeJsonPath, path.join(os.homedir(), '.claude.json'));
  assert.notStrictEqual(vu.claudeJsonPath, path.join(vu.claudeDir, '.claude.json'));
});

// Une variable VIDE est une variable non posée. Le serveur le faisait déjà par
// `||` ; le moteur, lui, employait `??` et scannait la chaîne vide en annonçant
// « 0 session(s) découverte(s) sous  » — une cécité totale et silencieuse. C'est
// le sens du serveur qui a été retenu des deux côtés : ce test le VERROUILLE ici
// pour qu'une future unification ne l'emporte pas dans l'autre sens.
test('une variable VIDE retombe sur le home', async () => {
  assert.strictEqual(
    (await resoudreAvec({ CLAUDE_CONFIG_DIR: '', NETGAIN_CLAUDE_DIR: undefined })).claudeDir,
    path.join(os.homedir(), '.claude'),
  );
});

// Le point de C5 : ce n'est pas « le serveur lit la bonne variable », c'est que
// les deux moitiés lisent au MÊME ENDROIT. Deux expressions identiques mais
// séparées avaient déjà divergé une fois (sur la chaîne vide) sans que personne
// ne le voie.
//
// Ce 7e test est le seul du fichier à n'avoir besoin d'AUCUN mécanisme
// d'isolation, et il charge ses deux moitiés par `createRequire(import.meta.url)`
// — jamais par `await import`. Mesuré (D13) : sous vite-node, l'import du même
// fichier de `dist/` fabrique une SECONDE instance et l'identité
// `resolveClaudeDir === duMoteur` casse, alors que la propriété prouvée — les
// deux moitiés partagent LA MÊME primitive — n'a pas bougé. Seul le mécanisme
// d'accès change (doc/36 § 1.3), et il change parce que c'est le seul qui
// interroge le vrai chargeur, celui que le produit emploie en production.
test('le serveur passe par la primitive du moteur, pas par sa propre expression', () => {
  const requireReel = createRequire(import.meta.url);
  const { resolveClaudeDir, CLAUDE_DIR_ENV } = requireReel('../../src/server/claude-dir.js');
  assert.strictEqual(typeof resolveClaudeDir, 'function');
  assert.strictEqual(CLAUDE_DIR_ENV, 'CLAUDE_CONFIG_DIR');
  const { resolveClaudeDir: duMoteur } = requireReel('../../dist/engine/core/claude-dir.js');
  assert.strictEqual(resolveClaudeDir, duMoteur);
});
