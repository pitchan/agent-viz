import type { RawUsage } from './events.ts';

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
 * Un compte de jetons est un entier sûr ≥ 0. Une chaîne, un booléen, `NaN`,
 * `Infinity` (ce que `JSON.parse` tire de `1e999`), un négatif, un décimal ou un
 * entier à partir de 2^53 n'en sont pas.
 */
export function isTokenCount(v: unknown): v is number {
  return Number.isSafeInteger(v) && (v as number) >= 0;
}

/**
 * LA garde des compteurs et du coût : la valeur si c'est un compte, sinon zéro.
 * Additionner un négatif retrancherait des jetons comptés sur d'autres messages,
 * et `0 + "100"` changerait le seau en texte jusque dans l'enveloppe SSE.
 */
export function countOrZero(v: unknown): number {
  return isTokenCount(v) ? v : 0;
}

/** Ce que porte un champ `usage` brut : aucune mesure, une mesure exploitable, ou une mesure inexploitable. */
export type UsageVerdict = 'absent' | 'sain' | 'malforme';

/**
 * Le verdict sur un `usage` tel que le JSONL le porte. Il se rend avant toute
 * normalisation, qui ramène un non-objet à `null` et le confond alors avec l'absence.
 *
 * Le contrat est le type `Usage` du SDK Anthropic : `input_tokens` et
 * `output_tokens` obligatoires, les champs de cache facultatifs ou `null`.
 * Les clés que ce type ne connaît pas sont ignorées.
 */
export function usageVerdict(raw: unknown): UsageVerdict {
  if (raw === undefined || raw === null) return 'absent';
  if (!isPlainObject(raw)) return 'malforme';
  if (!isTokenCount(raw.input_tokens) || !isTokenCount(raw.output_tokens)) return 'malforme';
  if (!isOptionalCount(raw.cache_creation_input_tokens) || !isOptionalCount(raw.cache_read_input_tokens)) return 'malforme';
  const detail = raw.cache_creation;
  if (detail === undefined || detail === null) return 'sain';
  if (!isPlainObject(detail)) return 'malforme';
  return isOptionalCount(detail.ephemeral_5m_input_tokens) && isOptionalCount(detail.ephemeral_1h_input_tokens)
    ? 'sain'
    : 'malforme';
}

function isOptionalCount(v: unknown): boolean {
  return v === undefined || v === null || isTokenCount(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
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
  b.in += countOrZero(u.input_tokens);
  b.out += countOrZero(u.output_tokens);
  b.cacheCreate += countOrZero(u.cache_creation_input_tokens);
  b.cacheRead += countOrZero(u.cache_read_input_tokens);
  // Les deux fenêtres de cache sont des champs BRUTS distincts : leur somme n'a
  // aucune raison de valoir `cache_creation_input_tokens`, et la primitive ne
  // réconcilie rien.
  b.cacheCreate1h += countOrZero(u.cache_creation?.ephemeral_1h_input_tokens);
  b.cacheCreate5m += countOrZero(u.cache_creation?.ephemeral_5m_input_tokens);
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
