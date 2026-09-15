// viz-error-format.ts — comment une erreur d'outil se dit, en un seul endroit.
//
// Module pur : pas de DOM. Meme raison d'etre que viz-alert-format pour les
// alertes — le volet des erreurs est la SEULE porte d'entree vers un echec
// (le graphe n'affiche que les dix derniers outils, le flux n'en garde que
// soixante lignes en DOM), donc ce qui n'est pas dit ici n'est dit nulle part.
//
// `clockTime` vient du moteur (partagee avec le detecteur cote serveur) et
// `truncate` de viz-alert-format : ce sont les memes regles generiques, et
// deux copies divergeraient. L'heure est LOCALE, comme celle des alertes —
// c'est l'heure a laquelle l'utilisateur a vu passer l'echec, pas celle du
// fichier.

import { clockTime } from '../engine/core/clock-time.ts';
import { truncate } from './viz-alert-format.ts';

// Un message d'erreur n'a pas de longueur naturelle (une trace de pile peut
// faire des kilo-octets) et le volet a une largeur fixe. On coupe VISIBLEMENT :
// un message tronque en silence se lit comme un message complet, et c'est
// justement sur un message d'erreur qu'on ne peut pas se le permettre.
export const MESSAGE_MAX = 220;

// `hasNode` est FOURNI par l'appelant : un echec orphelin porte un `tool_use_id` comme les
// autres — c'est son `PreToolUse` qui manque —, et ce module ne connait pas le graphe.
// Deduire la rejoignabilite du seul identifiant annoncait une ligne cliquable morte.
// Le sous-ensemble d'une ligne du registre (viz-errors.ts) que l'affichage lit.
interface ErrorLike {
  toolName?: string;
  subject?: string;
  message?: string;
  ts: string;
  nodeId?: string | null;
  count?: number;
  successesSince?: number;
}

export function errorRow(rec: ErrorLike, hasNode = false) {
  const reachable = Boolean(rec.nodeId) && Boolean(hasNode);
  const count = rec.count || 1;
  const since = rec.successesSince || 0;
  return {
    tool: rec.toolName || '',
    subject: rec.subject || '',
    message: truncate(rec.message || '', MESSAGE_MAX),
    // clockTime attend un epoch (contrat moteur) ; le registre du navigateur
    // date en ISO — conversion locale, sans toucher au module partage.
    time: clockTime(new Date(rec.ts).getTime()),
    nodeId: rec.nodeId || null,
    reachable,
    // « ×3 » seulement a partir de deux : un ×1 n'apprend rien et alourdit la
    // ligne — or la repetition est justement ce qui doit sauter aux yeux.
    repeat: count >= 2 ? `×${count}` : '',
    // Le fait de continuite : combien d'outils ont REUSSI depuis la derniere
    // occurrence. C'est un compte, pas un verdict — le volet ne pretend jamais
    // que l'agent « s'est rattrape », il laisse le chiffre le dire. A zero, la
    // note se tait : l'echec est le dernier mot, et ca se voit deja.
    sinceNote: since > 0 ? `${since} tool${since === 1 ? '' : 's'} succeeded since` : '',
    // Une ligne morte sans explication se lit comme un bug du volet. Elle porte
    // deja tout ce qu'il faut pour comprendre l'echec ; il reste a dire qu'il
    // n'y a rien de plus a ouvrir.
    goneNote: reachable ? '' : 'Call no longer on the canvas — nothing left to open.',
  };
}

// Le titre repond a la question posee devant l'ecran : « une erreur, oui,
// mais de quoi ? ». Le bandeau ne montre qu'une session a la fois, et le volet
// doit le dire — sinon le chiffre ne dit pas de quelle session il parle.
export function errorsPanelTitle(sessionId: string | null | undefined, count: number) {
  const s = count === 1 ? '' : 's';
  const tete = `${count} error${s}`;
  // Au tout premier chargement, avant le moindre evenement, l'onglet ne sait
  // pas encore quelle session il montre : mieux vaut ne rien dire qu'ecrire
  // « session undefined », qui se lit comme un bug.
  return sessionId ? `${tete} · session ${String(sessionId).slice(0, 8)}` : tete;
}
