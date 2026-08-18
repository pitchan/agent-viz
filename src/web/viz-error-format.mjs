// viz-error-format.mjs — comment une erreur d'outil se dit, en un seul endroit.
//
// Module pur : pas de DOM. Meme raison d'etre que viz-alert-format pour les
// alertes — le volet des erreurs est la SEULE porte d'entree vers un echec
// (le graphe n'affiche que les dix derniers outils, le flux n'en garde que
// soixante lignes en DOM), donc ce qui n'est pas dit ici n'est dit nulle part.
//
// `clockTime` et `truncate` viennent de viz-alert-format : ce sont les memes
// regles generiques, et deux copies divergeraient. L'heure est LOCALE, comme
// celle des alertes — c'est l'heure a laquelle l'utilisateur a vu passer
// l'echec, pas celle du fichier.

import { clockTime, truncate } from './viz-alert-format.mjs';

// Un message d'erreur n'a pas de longueur naturelle (une trace de pile peut
// faire des kilo-octets) et le volet a une largeur fixe. On coupe VISIBLEMENT :
// un message tronque en silence se lit comme un message complet, et c'est
// justement sur un message d'erreur qu'on ne peut pas se le permettre.
export const MESSAGE_MAX = 220;

// `hasNode` est FOURNI par l'appelant, et ce n'est pas un detail : un echec
// orphelin porte un `tool_use_id` comme les autres — c'est son `PreToolUse` qui
// manque, pas son identifiant. Deduire la rejoignabilite du seul identifiant
// annoncait donc une ligne cliquable qui ne menait nulle part (defaut trouve au
// navigateur, pas a la lecture). Ce module ne connait pas le graphe ; seul
// l'appelant sait si le noeud existe encore, et il le dit.
export function errorRow(rec, hasNode = false) {
  const reachable = Boolean(rec.nodeId) && Boolean(hasNode);
  return {
    tool: rec.toolName || '',
    subject: rec.subject || '',
    message: truncate(rec.message || '', MESSAGE_MAX),
    time: clockTime(rec.ts),
    nodeId: rec.nodeId || null,
    reachable,
    // Une ligne morte sans explication se lit comme un bug du volet. Elle porte
    // deja tout ce qu'il faut pour comprendre l'echec ; il reste a dire qu'il
    // n'y a rien de plus a ouvrir.
    goneNote: reachable ? '' : 'Call no longer on the canvas — nothing left to open.',
  };
}

// Le titre repond a la question posee devant l'ecran : « une erreur, oui,
// mais de quoi ? ». Le bandeau ne montre qu'une session a la fois, et le volet
// doit le dire — sinon le chiffre reste aussi flottant qu'avant.
export function errorsPanelTitle(sessionId, count) {
  const s = count === 1 ? '' : 's';
  const tete = `${count} error${s}`;
  // Au tout premier chargement, avant le moindre evenement, l'onglet ne sait
  // pas encore quelle session il montre : mieux vaut ne rien dire qu'ecrire
  // « session undefined », qui se lit comme un bug.
  return sessionId ? `${tete} · session ${String(sessionId).slice(0, 8)}` : tete;
}
