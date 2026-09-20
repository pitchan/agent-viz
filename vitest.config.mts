import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    // Le greffon `vite:dynamic-import-vars` lit cette option même sans build et
    // refuse un `import()` dont la query varie (`?t=…`, `?neuf=…`) : « Unknown
    // variable dynamic import ». Ces trois fichiers en portent un pour recharger un module.
    dynamicImportVarsOptions: {
      exclude: [
        /watchdog-client-reader\.test\.ts$/,
        /watchdog-service\.test\.ts$/,
        /watchdog-wiring\.test\.ts$/,
      ],
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./test-support/env-guard.mjs'],
    restoreMocks: true,
  },
});
