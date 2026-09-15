// viz-duration.ts — combien de temps ça a duré, écrit pour être lu d'un coup
// d'œil dans une carte, un fil ou une phrase de narrateur.
//
// Une seule arithmétique pour la carte du graphe, le fil et le narrateur : deux
// seuils, 1 s et 1 min, et une décimale au-delà. Trois copies s'accorderaient sur le
// domaine nominal et ne divergeraient QUE hors contrat, là où rien ne les compare.
//
// D'où la frontière : ce module dit ce qu'est une durée et comment on l'écrit.
// Ce qui n'en est pas une reçoit `null`, et l'appelant garde SON mot pour ce
// cas — `null` sur une carte du graphe, `?` dans une phrase du narrateur, rien
// du tout dans le fil. Un module qui choisirait ce mot imposerait la même
// phrase à trois écrans qui n'ont pas les mêmes contraintes de place.

export function formatDuration(ms: number): string | null {
  // Une horloge qui recule (correction NTP entre deux événements) donne un
  // écart négatif ; une date illisible donne NaN. Ni l'un ni l'autre n'est une
  // durée, et les écrire produisait « -5000ms » ou « NaNm ».
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
