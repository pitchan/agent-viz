import type { RawUsage } from './events.js';

/** Les six champs bruts d'usage. Rien d'autre : ni « dernier message », ni prix,
 *  ni modèle — ce sont des concernes d'appelants, pas de l'accumulation. */
export interface UsageBucket {
  in: number;
  out: number;
  cacheCreate: number;
  cacheRead: number;
  cacheCreate1h: number;
  cacheCreate5m: number;
}

export function emptyUsageBucket(): UsageBucket {
  return { in: 0, out: 0, cacheCreate: 0, cacheRead: 0, cacheCreate1h: 0, cacheCreate5m: 0 };
}

/**
 * LA garde, à un seul endroit : un champ qui n'est pas un nombre **fini** vaut
 * zéro.
 *
 * Elle tranche entre les deux gardes qui coexistaient, et qui n'étaient pas
 * équivalentes malgré ce qu'en disait la fiche C3 — écart trouvé en exécutant
 * les deux fonctions sur la même matrice, jamais visible à la lecture :
 *
 *   - serveur `|| 0` : ramenait `NaN` à zéro, laissait passer `Infinity` ;
 *   - moteur `?? 0` : laissait passer les deux, et **un seul `NaN` empoisonnait
 *     le seau pour toute la session** (tout `+=` suivant reste `NaN`).
 *
 * `Infinity` est le seul des deux poisons qu'un JSON **valide** puisse porter :
 * `JSON.parse('{"input_tokens":1e999}')` rend `Infinity`, là où le littéral
 * `NaN` est refusé par l'analyseur. Aucune des deux implémentations d'avant ne
 * l'arrêtait.
 *
 * Un nombre en chaîne vaut zéro lui aussi. Avant, les deux côtés faisaient
 * `0 + "100"` — donc **le seau entier partait en chaîne**, jusque dans
 * l'enveloppe SSE envoyée au navigateur. Une ligne malformée ne doit pas
 * pouvoir casser l'arithmétique de tout ce qui suit.
 */
export function finiteCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * L'accumulation des six champs bruts, à une seule définition — constat C3 de
 * `docs/audit-qualite-code.md`.
 *
 * Ce que les deux côtés partagent est **cette addition-là**, pas ce qu'ils en
 * font ensuite : le serveur y ajoute le « dernier message » (taille de fenêtre
 * de contexte courante) et un coût calculé à l'analyse, le moteur une
 * ventilation par modèle et un coût daté. Ces suites restent chez eux.
 *
 * `tokenSum` (serveur, `cacheRead` INCLUS) et `netTokens` (moteur, `cacheRead`
 * EXCLU) sont deux métriques distinctes par convention documentée : elles
 * s'appliquent au résultat de cette primitive et **ne sont pas des cibles de
 * fusion** (arbitrage de la fiche, respecté).
 */
export function addUsage(b: UsageBucket, u: RawUsage): void {
  b.in += finiteCount(u.input_tokens);
  b.out += finiteCount(u.output_tokens);
  b.cacheCreate += finiteCount(u.cache_creation_input_tokens);
  b.cacheRead += finiteCount(u.cache_read_input_tokens);
  // Les deux fenêtres de cache sont des champs BRUTS distincts : leur somme n'a
  // aucune raison de valoir `cache_creation_input_tokens`, et la primitive ne
  // réconcilie rien.
  b.cacheCreate1h += finiteCount(u.cache_creation?.ephemeral_1h_input_tokens);
  b.cacheCreate5m += finiteCount(u.cache_creation?.ephemeral_5m_input_tokens);
}

/** Fusionne `src` dans `target`, champ pour champ. `src` n'est pas touché. */
export function sumUsageInto(target: UsageBucket, src: UsageBucket): void {
  target.in += src.in;
  target.out += src.out;
  target.cacheCreate += src.cacheCreate;
  target.cacheRead += src.cacheRead;
  target.cacheCreate1h += src.cacheCreate1h;
  target.cacheCreate5m += src.cacheCreate5m;
}

/**
 * LA règle de déduplication, à un seul endroit. Claude Code écrit une ligne
 * JSONL par bloc de contenu (réflexion, texte, appel d'outil) et **toutes
 * portent le même `usage`** : sans déduplication par identifiant de message, le
 * seau compte N fois la même consommation.
 *
 * Les deux côtés se contredisaient ici, et c'est le seul endroit où ils le
 * faisaient vraiment : le serveur testait la vérité (`if (msgId)`), le moteur la
 * non-nullité (`if (msgId !== null)`). **C'est le sens du serveur qui est
 * retenu : un identifiant vide n'est pas un identifiant.**
 *
 * Ce n'est pas un choix de style. Dédupliquer sur `''` fusionnerait des messages
 * **distincts** dépourvus d'identifiant en un seul, donc **sous-compterait** —
 * une perte silencieuse, dans le sens le plus difficile à voir. Même doctrine
 * que la variable d'environnement vide de C5 : vide vaut non posé.
 *
 * Mesuré avant de trancher : `"id":""` apparaît **0 fois sur les 833
 * transcripts** de la machine. Aucun chiffre déjà publié ne bouge.
 */
export function isDedupableMsgId(msgId: unknown): boolean {
  return typeof msgId === 'string' && msgId !== '';
}
