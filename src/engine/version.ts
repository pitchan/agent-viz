import pkg from '../../package.json' with { type: 'json' };

/**
 * La version du produit, lue une seule fois au chargement : le package.json à la
 * racine du paquet, deux crans au-dessus de `src/engine/` comme de `dist/engine/`.
 * Le chargeur JSON de Node retire le BOM ; un fichier absent arrête le processus.
 */
export const PRODUCT_VERSION: string = pkg.version;
