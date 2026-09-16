import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Un seul exécuteur pour les trois extensions de test du dépôt ; `node --test`
// (script `test:node`) ne lit que `.test.cjs` et `.test.mjs`.
export default defineConfig({
  build: {
    // Le greffon `vite:dynamic-import-vars` lit cette option même sans build et
    // refuse un `import()` dont la query varie (`?t=…`, `?neuf=…`) : « Unknown
    // variable dynamic import ». Ces trois fichiers en portent un pour recharger un module.
    dynamicImportVarsOptions: {
      exclude: [
        /watchdog-client-reader\.test\.mjs$/,
        /watchdog-service\.test\.mjs$/,
        /watchdog-wiring\.test\.mjs$/,
      ],
    },
  },
  resolve: {
    // `import … from 'node:test'` (fichiers `.test.mjs`) passe par la résolution ESM,
    // que l'interception `Module._load` d'install.mjs ne voit pas ; l'alias la complète.
    // Les `require('node:test')` des `.test.cjs` restent à install.mjs.
    alias: {
      'node:test': fileURLToPath(new URL('./test-support/bridge/node-test-alias.mjs', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{cjs,mjs,ts}'],
    setupFiles: ['./test-support/env-guard.mjs', './test-support/bridge/install.mjs'],
    restoreMocks: true,
  },
});
