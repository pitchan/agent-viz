// Ce que ce fichier protege : `esc` rend un texte inerte dans le HTML, y
// compris a l'interieur d'un attribut entre guillemets (`data-node="…"`).

import { expect, test } from 'vitest';
import { esc } from '../../src/web/viz-state.ts';

test('un guillemet double ne ferme pas l attribut', () => {
  expect(esc('x" onmouseover="alert(1)')).toBe('x&quot; onmouseover=&quot;alert(1)');
});

test('une apostrophe ne ferme pas un attribut entre apostrophes', () => {
  expect(esc("x' onclick='y")).toBe('x&#39; onclick=&#39;y');
});

test('une balise devient du texte', () => {
  expect(esc('<img src=x>')).toBe('&lt;img src=x&gt;');
});

test('l esperluette est echappee en premier : une entite deja ecrite reste lisible telle quelle', () => {
  expect(esc('&quot;')).toBe('&amp;quot;');
});
