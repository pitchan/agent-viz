// viz-errors.mjs — le registre des echecs d'outils de la session affichee.
//
// Module pur : pas de DOM. Il existe parce que le compteur « N errors » du
// bandeau se calculait en balayant les noeuds du graphe, ce qui le rendait
// faux de trois facons, toutes trois mesurees au navigateur :
//
//   1. le ramasse-miettes efface un noeud d'outil fini au bout de dix minutes,
//      donc le compteur retombait a zero sans que rien ne soit resolu ;
//   2. un echec arrive sans son noeud — `PreToolUse` non recu, noeud deja
//      ramasse — n'etait compte nulle part, parce que tout le traitement de
//      l'echec vivait sous un `if (n)` ;
//   3. les noeuds d'agent, eux, ne sont JAMAIS ramasses : le meme chiffre
//      melangeait donc deux durees de vie.
//
// Le remede tient en une phrase : on capte a l'EVENEMENT, pas au noeud
// survivant. Le registre ne connait pas le graphe ; il retient seulement de
// quoi comprendre l'echec sans lui, plus l'identifiant du noeud a rejoindre
// quand il est encore la.
//
// Portee : une session. `clearState` le vide au changement de session, sinon
// le rejeu du journal compterait deux fois et le volet melangerait deux
// sessions — or le bandeau n'en montre qu'une.

import { toolSubject } from './viz-tool-subject.mjs';

// Une session reelle depasse rarement trois echecs (mesure sur 30 jours
// d'historique : mediane 1, p90 3, maximum 17). Cent laisse donc toute la
// marge utile tout en bornant la memoire d'un onglet laisse ouvert.
export const ERRORS_MAX = 100;

const _errors = [];
const _listeners = new Set();

function notify() {
  for (const cb of _listeners) {
    try { cb(getErrors()); } catch { /* un abonne qui casse n'emporte pas les autres */ }
  }
}

// Rend une COPIE : le registre est la source de verite du chiffre affiche,
// un appelant ne doit pas pouvoir le vider par megarde en manipulant sa liste.
export function getErrors() {
  return _errors.slice();
}

// Le seul point d'entree. Il accepte l'evenement brut et decide lui-meme si
// c'est un echec : l'appelant n'a pas a le savoir, et surtout pas a le savoir
// deux fois.
export function recordError(evt) {
  if (!evt || evt.hook_event_name !== 'PostToolUseFailure') return null;
  const toolUseId = evt.tool_use_id || '';
  const rec = {
    ts: evt._ts || new Date().toISOString(),
    toolName: evt.tool_name || '',
    // Le sujet vient de la regle partagee : ajouter un outil se fait a un seul
    // endroit, pas ici en plus.
    subject: toolSubject(evt),
    message: evt.error || '',
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
  notify();
  return rec;
}

export function resetErrors() {
  _errors.length = 0;
  // Prevenir meme quand il n'y avait rien : la pastille et le point du flux
  // doivent repartir propres, et l'abonne ne sait pas ce qu'il y avait avant.
  notify();
}

export function onErrorsChanged(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
