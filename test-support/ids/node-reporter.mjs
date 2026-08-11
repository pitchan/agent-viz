// Adaptateur : le flux d'evenements de node:test vers des identites.
// Le filtre sur les types est ce qui distingue un test d'un diagnostic ou du
// fichier qui les contient — verifie sur un echantillon capture, pas suppose.
import { formatId, trierIds } from './format.mjs';

const TYPES_DE_TEST = new Set(['test:pass', 'test:fail']);

export function idsDepuisEvenementsNode(evenements, racine) {
  const ids = evenements
    .filter(e => TYPES_DE_TEST.has(e.type) && e.data?.file)
    .map(e => formatId(e.data.file, e.data.name, racine));
  return trierIds(ids);
}

export default async function* rapporteur(source) {
  const evenements = [];
  for await (const e of source) evenements.push({ type: e.type, data: e.data });
  for (const id of idsDepuisEvenementsNode(evenements, process.cwd())) yield `${id}\n`;
}
