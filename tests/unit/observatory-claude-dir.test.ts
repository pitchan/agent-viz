// Le serveur et le moteur lisent le dossier de configuration par une seule primitive,
// `resolveClaudeDir` (src/engine/core/claude-dir.ts) : côté serveur, `getObservatoryService`
// (src/server/observatory/index.ts) l'appelle. `CLAUDE_CONFIG_DIR` vit, `NETGAIN_CLAUDE_DIR` est ignorée.
//
// Ce fichier est le filet de la moitié SERVEUR : il ne teste pas la primitive
// (`tests/core/claude-dir.test.ts` s'en charge) mais le BRANCHEMENT, sans lequel un
// `getObservatoryService` resté sur sa propre expression divergerait en silence.
//
// Les cinq voisins du module de composition sont BOUCHONNÉS avant son chargement : seule la
// résolution s'exécute, sans base ni socket. Le bouchon de `./store` n'est pas un confort : sans
// lui, charger ce module ouvre `~/.agent-viz/observatory.db`, la base de mesure de la machine.
//
// Ce fichier tourne sous vitest seul : sur un module ES, `require.cache` est inerte (la substitution
// rend le vrai voisin, la purge la même instance). `vi.resetModules()` + `vi.doMock()` + `await import()`
// donnent une instance neuve par appel, les cinq voisins remplacés AVANT le chargement.
import { test, vi } from 'vitest';
import assert from 'node:assert';
import path from 'node:path';
import os from 'node:os';

const CIBLE = '../../src/server/observatory/index.ts';

async function resoudreAvec(env: Record<string, string | undefined>) {
  vi.resetModules();

  let vu: any = null;
  let vuConfig: any = null;

  // Les CINQ voisins d'`observatory/index.ts`, bouchonnés par leur spécificateur
  // résolu depuis CE fichier — c'est ainsi que `vi.doMock` les apparie.
  vi.doMock('../../src/server/observatory/store.ts', () => ({ openStore: () => ({}) }));
  vi.doMock('../../src/server/observatory/engine.ts', () => ({ engine: {} }));
  vi.doMock('../../src/server/observatory/config-audit.ts', () => ({
    collectConfigItems: (_io: any, chemins: any) => { vuConfig = chemins; return []; },
  }));
  vi.doMock('../../src/server/observatory/service.ts', () => ({
    createObservatoryService: (deps: any) => { vu = deps; deps.collectConfig(); return {}; },
  }));
  vi.doMock('../../src/server/sse.ts', () => ({ broadcastSSE: () => {} }));

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
    vi.doUnmock('../../src/server/observatory/store.ts');
    vi.doUnmock('../../src/server/observatory/engine.ts');
    vi.doUnmock('../../src/server/observatory/config-audit.ts');
    vi.doUnmock('../../src/server/observatory/service.ts');
    vi.doUnmock('../../src/server/sse.ts');
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

// `.claude.json` porte l'inventaire MCP que lit la carte R2, et `CLAUDE_CONFIG_DIR` le déplace
// (établi PAR EXÉCUTION sur Claude Code 2.1.226) : posée, dans le dossier ; non posée, à côté du
// home. Le chercher au home faisait disparaître R2 sous un home jetable et un dossier réel.
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

// Une variable VIDE est une variable non posée. Lue par `??`, la chaîne vide faisait scanner
// « sous  » et annoncer « 0 session(s) découverte(s) », une cécité silencieuse : ce test
// verrouille le repli sur le home côté serveur.
test('une variable VIDE retombe sur le home', async () => {
  assert.strictEqual(
    (await resoudreAvec({ CLAUDE_CONFIG_DIR: '', NETGAIN_CLAUDE_DIR: undefined })).claudeDir,
    path.join(os.homedir(), '.claude'),
  );
});

// Les deux moitiés lisent au MÊME ENDROIT : les tests ci-dessus le verrouillent par le
// comportement réel d'`observatory/index.ts`. Une définition locale de `resolveClaudeDir`
// ou de `resolveClaudeJsonPath` dans `src/server/` fait rougir `no-local-engine-primitives.test.mjs`.
