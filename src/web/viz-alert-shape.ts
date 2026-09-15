// viz-alert-shape.ts — ce qu'est une alerte sur le fil, vérifié une seule fois,
// à l'entrée du navigateur.
//
// Module pur : ni DOM ni réseau. Le journal ne garantit que `id` et
// `createdAt`, et le flux SSE arrive par `JSON.parse` : sans cette porte, le
// type `Alert` serait une promesse que rien ne tient à l'exécution.
//
// Une ligne hors forme est écartée et comptée, jamais complétée : un tableau
// absent remplacé par `[]` ferait dire « aucun échec » d'une chose inconnue.

// Clause entière en `import type` : le serveur efface la ligne au service, et
// le navigateur ne demande jamais le détecteur.
import type { Alert, AlertType } from '../engine/watchdog/detector.ts';

// Les types qu'un détecteur lève. Le navigateur ne charge pas le détecteur,
// d'où cette copie : `satisfies` refuse une chaîne inconnue, et le test croisé
// avec `_DETECTOR_TYPES` refuse un type oublié.
export const ALERT_TYPES = ['loop', 'retryStorm', 'stuck', 'badInvocation'] as const satisfies readonly AlertType[];

type Predicat<T> = (v: unknown) => v is T;

// Un prédicat par champ. tsc refuse une table à laquelle il manque un champ du
// type, et une table qui garde un champ que le type n'a plus.
type Table<T> = { [K in keyof T]-?: Predicat<T[K]> };

const estChaine = (v: unknown): v is string => typeof v === 'string';
const estNombre = (v: unknown): v is number => typeof v === 'number';
const estBooleen = (v: unknown): v is boolean => typeof v === 'boolean';
const estEnregistrement = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const estTypeAlerte = (v: unknown): v is AlertType => (ALERT_TYPES as readonly unknown[]).includes(v);

const tableauDe = <T>(ok: Predicat<T>): Predicat<T[]> =>
  (v: unknown): v is T[] => Array.isArray(v) && v.every(ok);

// Le prédicat rétrécit le type, il ne recopie pas la valeur : un champ en plus
// (`ackAt`, que le journal ajoute) traverse sans être lu.
function lecteur<T>(table: Table<T>): Predicat<T> {
  const champs: [string, Predicat<unknown>][] = Object.entries(table);
  return (v: unknown): v is T => estEnregistrement(v) && champs.every(([cle, ok]) => ok(v[cle]));
}

const estOccurrence = lecteur<Alert['occurrences'][number]>({
  ts: estNombre,
  toolUseId: estChaine,
  failed: (v: unknown): v is boolean | null => v === null || typeof v === 'boolean',
});

const estOutil = lecteur<Alert['tools'][number]>({
  toolUseId: estChaine,
  toolName: estChaine,
  subject: estChaine,
  startedAt: estNombre,
  agentId: estChaine,
  agentType: estChaine,
});

const estAlerte = lecteur<Alert>({
  id: estChaine,
  type: estTypeAlerte,
  sessionId: estChaine,
  toolName: estChaine,
  count: estNombre,
  createdAt: estNombre,
  message: estChaine,
  agentId: estChaine,
  agentType: estChaine,
  subject: estChaine,
  occurrences: tableauDe(estOccurrence),
  tools: tableauDe(estOutil),
  cwd: estChaine,
  standing: estBooleen,
  patternId: estChaine,
  acknowledged: estBooleen,
});

// Une ligne du fil : un message SSE `alert`, ou un élément de GET /alerts.
// `null` dit « hors forme » : cette ligne n'a rien à montrer.
export function readAlert(v: unknown): Alert | null {
  return estAlerte(v) ? v : null;
}

// La réponse entière de GET /alerts. Une liste absente est une lecture ratée,
// pas un journal vide : l'erreur le dit en nommant le champ.
export function readAlertsPayload(v: unknown): { alerts: Alert[]; rejetees: number; activeIds: string[] } {
  if (!estEnregistrement(v) || !Array.isArray(v.alerts)) {
    throw new Error('réponse de /alerts hors forme : alerts n’est pas une liste');
  }
  const activeIds = v.activeIds;
  if (!tableauDe(estChaine)(activeIds)) {
    throw new Error('réponse de /alerts hors forme : activeIds n’est pas une liste de chaînes');
  }
  const alerts: Alert[] = [];
  let rejetees = 0;
  for (const ligne of v.alerts) {
    const alerte = readAlert(ligne);
    if (alerte) alerts.push(alerte);
    else rejetees++;
  }
  return { alerts, rejetees, activeIds };
}
