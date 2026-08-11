// Une identite de test = le fichier qui le porte, plus son nom. Le nom seul ne
// suffit pas : deux fichiers peuvent nommer deux tests pareil, et un diff de
// noms seuls serait alors aveugle a un test qui change de fichier.
import path from 'node:path';

export function formatId(fichier, nom, racine) {
  const relatif = path.relative(racine, fichier).split(path.sep).join('/');
  return `${relatif} :: ${nom}`;
}

export function trierIds(ids) {
  return [...ids].sort();
}
