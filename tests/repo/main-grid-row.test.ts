// La bande du narrateur est souvent masquée, et un élément masqué ne prend pas de place dans la
// grille de #app : sans placement explicite, #main remonte dans la rangée de la bande. #main doit
// donc nommer lui-même la rangée souple (fr) d'une grille de hauteur fixe, à toutes les largeurs.
import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CSS = fs.readFileSync(path.join(ROOT, 'src/web/viz.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

type Regle = { selecteur: string; corps: string; conditionnelle: boolean };
type Declaration = { propriete: string; valeur: string; conditionnelle: boolean };

// Une règle rangée dans @media ou @supports ne vaut pas à toutes les largeurs : elle est
// « conditionnelle ». Le contenu d'un bloc @ est relu comme une feuille à part entière.
function regles(css: string, conditionnelle: boolean): Regle[] {
  const liste: Regle[] = [];
  let profondeur = 0, debut = 0, ouverture = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{' && profondeur++ === 0) ouverture = i;
    if (css[i] === '}' && --profondeur === 0) {
      const selecteur = css.slice(debut, ouverture).trim(), corps = css.slice(ouverture + 1, i);
      if (selecteur.startsWith('@')) liste.push(...regles(corps, true));
      else liste.push({ selecteur, corps, conditionnelle });
      debut = i + 1;
    }
  }
  return liste;
}

// Toute règle dont le dernier sélecteur simple porte l'id compte (body #main, div#main,
// #main:not(.x)…) : aucune ne doit pouvoir sortir #main de la rangée souple, quelle que soit
// sa priorité.
function viseElement(selecteur: string, id: string): boolean {
  return selecteur.replace(/\([^)]*\)/g, '()').split(',').some(s => {
    const compose = s.trim().split(/\s*[\s>+~]\s*/).at(-1) ?? '';
    return !compose.includes('::') && new RegExp(`#${id}(?![\\w-])`).test(compose);
  });
}

function declarations(id: string, proprietes: string[]): Declaration[] {
  return regles(CSS, false)
    .filter(r => viseElement(r.selecteur, id))
    .flatMap(r => r.corps.split(';').map(d => {
      const deuxPoints = d.indexOf(':');
      return {
        propriete: d.slice(0, deuxPoints).trim().toLowerCase(),
        valeur: d.slice(deuxPoints + 1).replace(/!important/i, '').trim(),
        conditionnelle: r.conditionnelle,
      };
    }))
    .filter(d => proprietes.includes(d.propriete));
}

type Grille = { pistes: string[]; zones: string[] };

// grid-template-rows, ou grid-template : ses chaînes de zones ouvrent chacune une rangée
// (auto par défaut), la taille qui suit la chaîne fixe la piste.
function grille({ propriete, valeur }: Declaration, zones: string[]): Grille {
  const jetons = valeur.split('/')[0]!.match(/"[^"]*"|\[[^\]]*\]|[^\s(["]+(?:\([^)]*\))?/g) ?? [];
  if (propriete === 'grid-template-rows' || !jetons.some(j => j.startsWith('"'))) {
    return { pistes: jetons.filter(j => !j.startsWith('[')), zones };
  }
  const pistes: string[] = [], zonesDuRaccourci: string[] = [];
  for (const jeton of jetons) {
    if (jeton.startsWith('"')) { zonesDuRaccourci.push(jeton.slice(1, -1)); pistes.push('auto'); }
    else if (!jeton.startsWith('[')) pistes[pistes.length - 1] = jeton;
  }
  return { pistes, zones: zonesDuRaccourci };
}

// Numéro de la rangée où #main commence ; NaN quand la déclaration n'en nomme aucune.
function rangeeDeDepart({ propriete, valeur }: Declaration, { pistes, zones }: Grille): number {
  const parts = valeur.split('/').map(x => x.trim());
  const debut = propriete === 'grid-row-end' ? 'auto' : parts[0]!;
  const fins: Record<string, string | undefined> = { 'grid-row-end': parts[0], 'grid-row': parts[1], 'grid-area': parts[2] };
  const fin = fins[propriete];
  const ligne = (n: number) => (n < 0 ? pistes.length + 2 + n : n);
  if (/^-?\d+$/.test(debut)) return ligne(Number(debut));
  const span = /^(?:auto|span\s+(\d+))$/.exec(debut);
  if (span && fin !== undefined && /^-?\d+$/.test(fin)) return ligne(Number(fin)) - Number(span[1] ?? 1);
  const zone = zones.findIndex(z => z.split(/\s+/).includes(debut));
  return span || zone < 0 ? NaN : zone + 1;
}

const PISTE_SOUPLE = /^(?:\d*\.?\d+fr|minmax\(.+,\s*\d*\.?\d+fr\))$/;

test('la zone principale occupe la rangée souple de la grille, bande du narrateur visible ou non', () => {
  // Arrange
  const hauteurs = declarations('app', ['height']);
  const zones = declarations('app', ['grid-template-areas'])
    .map(d => [...d.valeur.matchAll(/"([^"]*)"/g)].map(m => m[1]!));
  const pistes = declarations('app', ['grid-template-rows', 'grid-template']);
  const grilles = pistes.flatMap(d => (zones.length ? zones : [[]]).map(z => grille(d, z)));

  // Act
  const placements = declarations('main', ['grid-row', 'grid-row-start', 'grid-row-end', 'grid-area']);
  const horsPisteSouple = placements.flatMap(p => grilles
    .filter(g => !PISTE_SOUPLE.test(g.pistes[rangeeDeDepart(p, g) - 1] ?? ''))
    .map(g => `${p.propriete}: ${p.valeur} dans ${g.pistes.join(' ')}`));

  // Assert
  expect(hauteurs.some(d => !d.conditionnelle), 'hauteur de #app hors @media').toBe(true);
  expect(hauteurs.map(d => d.valeur).filter(v => !/^100[dsl]?vh$/.test(v)), 'hauteurs de #app hors 100vh').toEqual([]);
  expect(pistes.some(d => !d.conditionnelle), 'rangées de #app hors @media').toBe(true);
  expect(placements.some(d => !d.conditionnelle), 'placement explicite de #main hors @media').toBe(true);
  expect(horsPisteSouple, 'placements de #main hors de la rangée souple').toEqual([]);
});
