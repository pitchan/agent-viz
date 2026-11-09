// La bande du narrateur est souvent masquée, et un élément masqué ne prend pas de place dans la
// grille de #app : sans placement explicite, #main remonte dans la rangée de la bande. #main doit
// donc nommer lui-même la rangée souple (fr) d'une grille de hauteur fixe, à toutes les largeurs.
import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CSS = fs.readFileSync(path.join(ROOT, 'src/web/viz.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

type Declaration = [propriete: string, valeur: string];

// Seules les règles hors @media valent pour toutes les largeurs de fenêtre.
function reglesDePremierNiveau(): Array<[selecteur: string, corps: string]> {
  const regles: Array<[string, string]> = [];
  let profondeur = 0, debut = 0, ouverture = 0;
  for (let i = 0; i < CSS.length; i++) {
    if (CSS[i] === '{' && profondeur++ === 0) ouverture = i;
    if (CSS[i] === '}' && --profondeur === 0) {
      regles.push([CSS.slice(debut, ouverture).trim(), CSS.slice(ouverture + 1, i)]);
      debut = i + 1;
    }
  }
  return regles;
}

const viseElement = (selecteur: string, id: string): boolean =>
  selecteur.split(',').some(s => s.trim().split(/[\s>+~]+/).at(-1) === id);

function derniereValeur(id: string, proprietes: string[]): Declaration | undefined {
  return reglesDePremierNiveau()
    .filter(([selecteur, corps]) => !selecteur.startsWith('@') && !corps.includes('{') && viseElement(selecteur, id))
    .flatMap(([, corps]) => corps.split(';'))
    .map(d => d.split(':').map(x => x.trim()))
    .filter((d): d is Declaration => d.length === 2 && proprietes.includes(d[0]!))
    .at(-1);
}

// Numéro de la rangée où #main commence, pour grid-row, grid-row-start ou grid-area.
function rangeeDeDepart([propriete, valeur]: Declaration, nbPistes: number, zones: string[]): number {
  const [debut = '', fin] = valeur.split('/').map(x => x.trim());
  if (propriete === 'grid-area' && !/^-?\d+$/.test(debut) && !debut.startsWith('span')) {
    return zones.findIndex(z => z.split(/\s+/).includes(debut)) + 1;
  }
  const ligne = (n: number) => (n < 0 ? nbPistes + 2 + n : n);
  const span = /^span\s+(\d+)$/.exec(debut);
  return span && fin !== undefined ? ligne(Number(fin)) - Number(span[1]) : ligne(Number(debut));
}

test('la zone principale occupe la rangée souple de la grille, bande du narrateur visible ou non', () => {
  // Arrange
  const pistes = (derniereValeur('#app', ['grid-template-rows'])?.[1] ?? '').split(/\s+/).filter(Boolean);
  const zones = [...(derniereValeur('#app', ['grid-template-areas'])?.[1] ?? '').matchAll(/"([^"]*)"/g)].map(m => m[1]!);

  // Act
  const placement = derniereValeur('#main', ['grid-row', 'grid-row-start', 'grid-area']);

  // Assert
  expect(derniereValeur('#app', ['height'])?.[1], 'hauteur de #app').toMatch(/^100d?vh$/);
  expect(placement, 'placement explicite de #main hors @media dans src/web/viz.css').toBeDefined();
  expect(pistes[rangeeDeDepart(placement!, pistes.length, zones) - 1], 'piste de la rangée de #main').toMatch(/^\d*\.?\d*fr$/);
});
