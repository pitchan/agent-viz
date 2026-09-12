// clock-time.ts — l'heure locale a laquelle un fait a ete vu, en un seul endroit.
//
// Pure : pas d'horloge, pas d'etat. `viz-alert-format.ts` et le navigateur
// veulent la meme regle de formatage ; le detecteur du moteur en a besoin
// aussi (les alertes `stuck` qu'il produit portent une heure), donc la
// fonction vit ici plutot que d'etre dupliquee cote navigateur et cote Node.

export function clockTime(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 8);
}
