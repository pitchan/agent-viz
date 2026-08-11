import { defineConfig } from 'vitest/config';

// Un seul executeur pour les deux arbres de tests tant qu'ils sont separes.
// `cjs` figure des maintenant dans le motif : l'etape 3 renommera les 42
// fichiers `.test.js` en `.test.cjs`, et ce renommage ne doit demander aucun
// changement ici (doc/36, section 3, etape 3).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,cjs,mjs}', 'netgain/tests/**/*.test.ts'],
  },
});
