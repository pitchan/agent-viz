// viz-errors.ts — le registre des echecs d'outils de la session affichee.
//
// Module pur : pas de DOM. Il capte a l'EVENEMENT, pas au noeud survivant : il ne
// connait pas le graphe, et retient de quoi comprendre l'echec sans lui, plus
// l'identifiant du noeud a rejoindre quand il est encore la.
//
// Compter les noeuds serait faux trois fois : le ramasse-miettes efface un outil fini
// au bout de dix minutes, un echec peut arriver sans noeud (`PreToolUse` non recu,
// noeud ramasse), et les noeuds d'agent ne sont jamais ramasses.
//
// Les erreurs VIEILLISSENT, sans jamais etre interpretees : trois faits comptables
// separent la sonde rattrapee de l'agent qui boucle — la repetition, la continuite
// (outils reussis depuis), le dernier verdict ; tests/unit/errors-register.test.mjs.
//
// Portee : une session. `clearState` le vide au changement de session, sinon
// le rejeu du journal compterait deux fois et le volet melangerait deux
// sessions — or le bandeau n'en montre qu'une.

import { toolSubject, type ToolCallEvent } from '../engine/core/tool-subject.ts';

// L'evenement hook lu ici : les champs de ToolCallEvent (moteur, deja typé)
// plus ceux propres au registre d'echecs — horodatage, session, agent.
interface HookFailureEvent extends ToolCallEvent {
  hook_event_name?: string;
  tool_use_id?: string;
  error?: string;
  session_id?: string;
  agent_id?: string;
  _ts?: string;
}

// Une session reelle depasse rarement trois echecs (mesure sur 30 jours
// d'historique : mediane 1, p90 3, maximum 17). Cent laisse donc toute la
// marge utile tout en bornant la memoire d'un onglet laisse ouvert. Le plafond
// compte des lignes DISTINCTES : une erreur qui se repete n'en consomme qu'une.
export const ERRORS_MAX = 100;

// Une ligne du registre : un motif d'echec distinct (signature = outil + sujet
// ou message), avec le compte de repetitions et le point de depart de la
// continuite. `sig` et `successesAt` restent internes — `getErrors` les retire.
interface ErrorRecord {
  sig: string;
  count: number;
  successesAt: number;
  ts: string;
  toolName: string;
  subject: string;
  message: string;
  toolUseId: string;
  nodeId: string | null;
  sessionId: string;
  agentId: string;
}

type ErrorChangeReason = 'error' | 'success' | 'reset';
type ErrorListener = (errors: ReturnType<typeof getErrors>, reason: ErrorChangeReason) => void;

const _errors: ErrorRecord[] = [];
const _listeners = new Set<ErrorListener>();
// La continuite et le dernier verdict vivent ici, pas dans les lignes : ce
// sont des faits de SESSION que chaque ligne lit au moment ou on l'affiche.
let _successCount = 0;
let _lastFailed = false;

// La raison accompagne la liste parce que les abonnes n'ont pas tous le meme
// prix : sur `error` le bandeau reconstruit tout le flux (rare, justifie) ;
// sur `success` il ne doit repeindre que la pastille — a chaque appel d'outil.
function notify(reason: ErrorChangeReason) {
  for (const cb of _listeners) {
    try { cb(getErrors(), reason); } catch { /* un abonne qui casse n'emporte pas les autres */ }
  }
}

// Rend des COPIES : le registre est la source de verite du chiffre affiche,
// un appelant ne doit pas pouvoir le corrompre en manipulant sa liste. La
// signature et le point de depart de la continuite restent dedans — dehors,
// seule compte la difference, calculee a l'instant de la lecture.
export function getErrors() {
  return _errors.map(({ sig, successesAt, ...pub }) => ({
    ...pub,
    successesSince: _successCount - successesAt,
  }));
}

// Les trois faits que la pastille agrege. `total` compte les ECHECS, pas les
// lignes : deux occurrences empilees restent deux echecs aux yeux du chiffre.
export function getErrorsSummary() {
  let total = 0;
  let hasRepeat = false;
  for (const rec of _errors) {
    total += rec.count;
    if (rec.count >= 2) hasRepeat = true;
  }
  return { total, hasRepeat, lastFailed: _lastFailed };
}

// La porte d'entree des echecs. Elle accepte l'evenement brut et decide
// elle-meme si c'en est un : l'appelant n'a pas a le savoir deux fois.
export function recordError(evt: HookFailureEvent | null | undefined): ErrorRecord | null {
  if (!evt || evt.hook_event_name !== 'PostToolUseFailure') return null;
  const toolUseId = evt.tool_use_id || '';
  const subject = toolSubject(evt);
  const message = evt.error || '';
  // Le sujet identifie la repetition ; a defaut, le message. Sans quoi tous
  // les echecs d'un outil hors du tableau des sujets s'empileraient ensemble.
  const sig = `${evt.tool_name || ''}\u0000${subject || message}`;
  _lastFailed = true;
  const existing = _errors.find(r => r.sig === sig);
  if (existing) {
    existing.count += 1;
    // La ligne rejoint sa DERNIERE occurrence : heure, message, noeud — et la
    // continuite repart de la, sinon « N reussis depuis » mentirait sur un
    // echec qui vient de revenir.
    existing.ts = evt._ts || new Date().toISOString();
    existing.message = message;
    existing.toolUseId = toolUseId;
    existing.nodeId = toolUseId ? `t:${toolUseId}` : null;
    existing.successesAt = _successCount;
    _errors.splice(_errors.indexOf(existing), 1);
    _errors.push(existing);
    notify('error');
    return existing;
  }
  const rec = {
    sig,
    count: 1,
    successesAt: _successCount,
    ts: evt._ts || new Date().toISOString(),
    toolName: evt.tool_name || '',
    subject,
    message,
    toolUseId,
    // `null` et pas une chaine vide : le volet doit pouvoir DISTINGUER
    // « noeud a rejoindre » de « rien a rejoindre » sans deviner.
    nodeId: toolUseId ? `t:${toolUseId}` : null,
    sessionId: evt.session_id || '',
    agentId: evt.agent_id || '',
  };
  _errors.push(rec);
  // La plus ancienne part : la derniere erreur est celle qu'on cherche.
  while (_errors.length > ERRORS_MAX) _errors.shift();
  notify('error');
  return rec;
}

// La porte d'entree des succes — le fait de continuite. Silencieuse tant
// qu'aucune erreur n'est enregistree : le cas de tres loin le plus frequent
// (une session sans echec) ne paie pas une repeinture par appel d'outil.
export function recordSuccess(evt: HookFailureEvent | null | undefined): void {
  if (!evt || evt.hook_event_name !== 'PostToolUse') return;
  _successCount += 1;
  _lastFailed = false;
  if (_errors.length) notify('success');
}

export function resetErrors() {
  _errors.length = 0;
  _successCount = 0;
  _lastFailed = false;
  // Prevenir meme quand il n'y avait rien : la pastille et le point du flux
  // doivent repartir propres, et l'abonne ne sait pas ce qu'il y avait avant.
  notify('reset');
}

export function onErrorsChanged(cb: ErrorListener): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
