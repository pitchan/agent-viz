import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Un seul executeur pour les deux arbres de tests tant qu'ils sont separes.
// `cjs` figure dans le motif : l'etape 3 a renomme 39 fichiers `.test.js` en
// `.test.cjs` — 39 et non 42, les TROIS fichiers a `require.cache` etant
// l'exception nommee de D13 (deux passes en `.test.mjs`, un en `.test.ts`).
// Et ce renommage a bien demande un changement ICI, contrairement a ce que
// cette note affirmait : les deux exclusions `dynamicImportVarsOptions`
// ci-dessous, et la reduction de l'`include` (doc/36, section 3, etape 3).
export default defineConfig({
  build: {
    // Mesure 2026-08-11 (piste 1, demandee par le coordinateur) : le plugin
    // core de Vite `vite:dynamic-import-vars` lit
    // `environment.config.build.dynamicImportVarsOptions` meme hors d'un
    // vrai build (verifie a la lecture de node_modules/vite/dist/node/chunks/config.js).
    // Trois fichiers sont exclus de sa transformation : celui dont le
    // cache-buster dans la query string (`?t=${T}-${Math.random()}`) n est
    // pas un motif que ce plugin sait resoudre, et les DEUX du sauvetage D13,
    // dont le `?neuf=${++serie}` est un specificateur variable que ce plugin
    // ne sait pas davantage resoudre (« Unknown variable dynamic import »,
    // mesure). `observatory-claude-dir.test.ts` n y figure PAS : son remede
    // est `vi.doMock`, il n a aucun import a specificateur variable.
    dynamicImportVarsOptions: {
      exclude: [
        /watchdog-client-reader\.test\.mjs$/,
        /watchdog-service\.test\.mjs$/,
        /watchdog-wiring\.test\.mjs$/,
      ],
    },
  },
  resolve: {
    // Mesure du 2026-08-11 (tache 7) : l'interception `Module._load` de
    // install.mjs suffit pour `require('node:test')` mais pas pour
    // `import ... from 'node:test'` des 30 fichiers `.test.mjs`, dont la
    // resolution ESM ne passe pas par ce crochet. Complement, pas remplacement
    // — install.mjs continue d'intercepter les 39 fichiers en `require`.
    alias: {
      'node:test': fileURLToPath(new URL('./test-support/bridge/node-test-alias.mjs', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{cjs,mjs,ts}'],
    setupFiles: ['./test-support/env-guard.mjs', './test-support/bridge/install.mjs'],
  },
});
