import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Un seul executeur pour les deux arbres de tests tant qu'ils sont separes.
// `cjs` figure des maintenant dans le motif : l'etape 3 renommera les 42
// fichiers `.test.js` en `.test.cjs`, et ce renommage ne doit demander aucun
// changement ici (doc/36, section 3, etape 3).
export default defineConfig({
  build: {
    // Mesure 2026-08-11 (piste 1, demandee par le coordinateur) : le plugin
    // core de Vite `vite:dynamic-import-vars` lit
    // `environment.config.build.dynamicImportVarsOptions` meme hors d'un
    // vrai build (verifie a la lecture de node_modules/vite/dist/node/chunks/config.js).
    // Un seul fichier est exclu de sa transformation : celui dont le
    // cache-buster dans la query string (`?t=${T}-${Math.random()}`) n est
    // pas un motif que ce plugin sait resoudre.
    dynamicImportVarsOptions: {
      exclude: [/watchdog-client-reader\.test\.mjs$/],
    },
  },
  resolve: {
    // Mesure du 2026-08-11 (tache 7) : l'interception `Module._load` de
    // install.mjs suffit pour `require('node:test')` mais pas pour
    // `import ... from 'node:test'` des 30 fichiers `.test.mjs`, dont la
    // resolution ESM ne passe pas par ce crochet. Complement, pas remplacement
    // — install.mjs continue d'intercepter les 42 fichiers en `require`.
    alias: {
      'node:test': fileURLToPath(new URL('./test-support/bridge/node-test-alias.mjs', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,cjs,mjs,ts}'],
    setupFiles: ['./test-support/bridge/install.mjs'],
  },
});
