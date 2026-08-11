// Adaptateur : le rapport JSON de vitest vers les MEMES identites.
import { formatId, trierIds } from './format.mjs';

export function idsDepuisJsonVitest(json, racine) {
  const ids = json.testResults.flatMap(fichier =>
    fichier.assertionResults.map(t => formatId(fichier.name, t.fullName, racine)));
  return trierIds(ids);
}
