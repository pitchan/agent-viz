'use strict';
// Le chargeur de modules du moteur — constat C5 de docs/audit-qualite-code.md.
//
// C2 avait posé `src/server/jsonl.js`, seul module de `src/server/` à savoir où vit la
// primitive de décodage. C5 demande le même geste pour la résolution du dossier
// de configuration, et C3 le demandera pour l'accumulation d'usage. Ce qui est
// commun aux trois n'est ni le décodage, ni la résolution, ni l'accumulation :
// c'est **charger un module du `dist` du moteur, et échouer EN LE DISANT si le
// build manque**. Une seule raison de changer, donc un seul fichier.
//
// Chaque domaine garde son propre pont (`jsonl.js`, `claude-dir.js`, …) : ce
// sont des voisinages différents, et les mettre ensemble sous prétexte qu'ils
// traversent la même frontière recréerait un fourre-tout.
//
// Pourquoi un `require` direct et non un `import()` asynchrone, contrairement à
// `observatory/engine.js` : ce fichier est lui-même un module ES (import/export),
// mais depuis Node 22.12 le `require` qu'il obtient via `createRequire` peut
// charger un module ES de façon SYNCHRONE tant qu'il n'a pas d'attente de haut
// niveau, et `package.json` promet déjà `engines.node >= 24`. Vérifié en exécutant.
//
// La racine du dépôt porte `{"type":"module"}` : `dist/engine/*.js` se lit déjà
// comme de l'ES, sans marqueur de sous-arbre à écrire ni à maintenir.

import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const DIST = path.join(import.meta.dirname, '..', '..', 'dist', 'engine');

/**
 * @param rel   chemin DANS le `dist` du moteur, ex. `core/jsonl.js`.
 *   Relatif au `dist` et non au module appelant : un pont placé ailleurs dans
 *   `src/server/` ne peut pas se tromper d'un niveau sans que rien ne le dise.
 * @param noms les exports attendus. Un manque signale un build
 *   périmé, pas un build absent — deux causes qui envoient chercher à des
 *   endroits opposés.
 * @param etiquette le préfixe des messages, ex. `jsonl`.
 *
 * Retour : `Record<string, unknown>`, jamais `any` — `require()` d'un chemin
 * calculé rend `any` implicite (aucune déclaration de module ne couvre un
 * chemin dynamique), canalisé ici plutôt que laissé fuir. Chaque appelant
 * (les 4 ponts) sait, lui, quels types réels se cachent derrière chaque nom et
 * les recouvre par `import type … from '../engine/<module>.ts'` + `as typeof`
 * (Ruling R8) — ce fichier-ci n'a pas cette connaissance, et n'en a pas besoin :
 * son seul travail est de charger et de vérifier la présence des noms.
 */
function requireEngineModule(rel: string, noms: string[], etiquette: string): Record<string, unknown> {
  const chemin = path.join(DIST, rel);
  let module: Record<string, unknown>;
  try {
    module = require(chemin);
  } catch (err: unknown) {
    // Casser bruyamment, jamais silencieusement — c'est la règle que C1 a
    // rappelée au prix d'une perte de capture. Un message cryptique de module
    // introuvable enverrait chercher un paquet npm manquant ; la cause réelle
    // est un build absent.
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[${etiquette}] le module « ${rel} » du moteur est introuvable. Ce dossier ` +
      'est produit par `npm run build`, que le script `prepare` lance ' +
      'automatiquement à l’installation — un dépôt cloné puis jamais installé ' +
      `n’en a pas. Lancez \`npm run build\`. Cause d’origine : ${cause}`,
    );
  }

  const manquants = noms.filter(nom => typeof module[nom] !== 'function');
  if (manquants.length > 0) {
    throw new Error(
      `[${etiquette}] ${manquants.map(n => `\`${n}\``).join(', ')} absente(s) du ` +
      `module construit « ${rel} » : le build est périmé par rapport à la source ` +
      'TypeScript. Relancez `npm run build`.',
    );
  }
  return module;
}

export { requireEngineModule };
