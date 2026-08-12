import { buildHookCommand, buildHookEntry, isOurs } from './hook-edit.js';
import { InstallError } from './json-file.js';
import { buildMcpEntry, findProjectKeys, MCP_SERVER_NAME } from './mcp-edit.js';
import type { StatusInput } from './status.js';

/**
 * Les QUEUES de chemin d'AVANT la fusion (étape 2 : netgain/src → src/engine,
 * netgain/dist → dist/engine). Une configuration écrite avant le déplacement les
 * porte ; après, plus rien ne les résout — et `netgain status` répondait « ON ».
 *
 * Une queue, et non « le chemin contient netgain/dist » ni une comparaison à la
 * commande reconstruite : cinq faux négatifs mesurés (dépôt cloné dans un dossier
 * nommé netgain, racine sous un chemin portant netgain/dist, casse Windows,
 * antislashes, entrée périmée venue d'une AUTRE racine).
 */
export const QUEUE_HOOK = 'netgain/dist/cli.js';
export const QUEUE_MCP = 'netgain/dist/mcp/main.js';

const EVENT = 'UserPromptSubmit';

type JsonObject = Record<string, unknown>;

/**
 * Antislashes en barres obliques, casse repliée. Les guillemets ne sont PAS retirés :
 * mesuré sur douze cas, le prédicat ne diverge jamais — la queue est cherchée au MILIEU
 * de la chaîne, et un guillemet ne peut pas s'y interposer. Un membre qu'aucun test ne
 * peut distinguer est un motif mort.
 */
function normalise(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/** Vrai si la valeur est une chaîne portant la queue ; sur toute autre forme : false, JAMAIS de levée. */
export function porteQueueAvantFusion(valeur: unknown, queue: string): boolean {
  if (typeof valeur !== 'string') return false;
  return normalise(valeur).includes(`/${normalise(queue)}`);
}

/**
 * Périmé = l'enregistré porte la queue ET le souhaité ne la porte plus.
 * La garde fait toute la datation : avant la tâche 3 le souhaité la porte encore,
 * le prédicat est faux partout, et aucune installation saine n'est signalée.
 */
export function estAvantFusion(enregistre: unknown, souhaite: string, queue: string): boolean {
  return porteQueueAvantFusion(enregistre, queue) && !porteQueueAvantFusion(souhaite, queue);
}

/** Les commandes de crochet d'un document de settings, lecture tolérante : difforme = aucune. */
function commandesDeCrochet(doc: unknown): unknown[] {
  const out: unknown[] = [];
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return out;
  const hooks = (doc as JsonObject)['hooks'];
  const event = typeof hooks === 'object' && hooks !== null ? (hooks as JsonObject)[EVENT] : undefined;
  for (const group of Array.isArray(event) ? event : []) {
    if (typeof group !== 'object' || group === null || Array.isArray(group)) continue;
    const inner = (group as JsonObject)['hooks'];
    for (const entry of Array.isArray(inner) ? inner : []) {
      if (typeof entry === 'object' && entry !== null) out.push((entry as JsonObject)['command']);
    }
  }
  return out;
}

/** Nos crochets périmés dans un document de settings quelconque (scope canonique OU hors portée). */
export function crochetsAvantFusion(doc: unknown, netgainRoot: string): string[] {
  const desired = buildHookEntry(netgainRoot);
  const souhaite = buildHookCommand(netgainRoot);
  const out: string[] = [];
  for (const command of commandesDeCrochet(doc)) {
    if (!isOurs(command, desired)) continue; // jamais une entrée étrangère
    if (estAvantFusion(command, souhaite, QUEUE_HOOK)) out.push(command as string);
  }
  return out;
}

/** Notre entrée MCP périmée dans un conteneur `mcpServers` quelconque, sous sa forme littérale. */
export function mcpAvantFusion(servers: unknown, netgainRoot: string, repoDir: string): string[] {
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return [];
  if (!(MCP_SERVER_NAME in (servers as JsonObject))) return []; // jamais un serveur étranger
  const entry = (servers as JsonObject)[MCP_SERVER_NAME];
  if (typeof entry !== 'object' || entry === null) return [];
  const args = (entry as JsonObject)['args'];
  const premier: unknown = Array.isArray(args) ? args[0] : undefined; // ni garanti présent ni garanti string
  const souhaite = (buildMcpEntry(netgainRoot, repoDir)['args'] as string[])[0] ?? '';
  return estAvantFusion(premier, souhaite, QUEUE_MCP) ? [premier as string] : [];
}

/**
 * findProjectKeys LÈVE (asObject) sur tout nœud non-objet. Appelé hors du try/catch de
 * `tolerantMcp`, il ferait remonter un InstallError jusqu'à computeStatus, dont le contrat
 * est « structures illisibles = lecture tolérante, jamais de throw ». Ici : difforme = aucune clé.
 */
function clefsProjetTolerantes(root: unknown, repoDir: string): string[] {
  try {
    return findProjectKeys(root, repoDir);
  } catch (err) {
    if (err instanceof InstallError) return [];
    throw err;
  }
}

/**
 * Les enregistrements À NOUS effectivement périmés — crochet puis MCP, forme littérale.
 * Côté MCP, TOUTES les variantes de clé projet sont parcourues : une entrée périmée peut
 * vivre sous une variante backslash, que `hasCanonicalMcp` compte alors présente.
 */
export function cheminsAvantFusion(input: StatusInput): string[] {
  const out = crochetsAvantFusion(input.settingsLocal, input.netgainRoot);
  const clefs = clefsProjetTolerantes(input.claudeJson, input.repoDir);
  const projects = clefs.length > 0 ? ((input.claudeJson as JsonObject)['projects'] as JsonObject) : {};
  for (const key of clefs) {
    const projet = projects[key];
    const servers = typeof projet === 'object' && projet !== null ? (projet as JsonObject)['mcpServers'] : undefined;
    out.push(...mcpAvantFusion(servers, input.netgainRoot, input.repoDir));
  }
  return out;
}
