// Un agent se déclare à trois endroits : la configuration du serveur, la liste des badges de la
// vue, et les couleurs de la feuille de style. Un oubli donne un badge absent ou sans couleur.
import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_CONFIG } from '../../src/server/install-hooks/config.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lire = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('la vue et la feuille de style connaissent exactement les agents du serveur', () => {
  // Arrange
  const serveur = Object.keys(AGENT_CONFIG).sort();
  const declaration = /const KNOWN_AGENTS = new Set\(\[([^\]]*)\]\)/.exec(lire('src/web/viz-network.ts'));
  // Act
  const vue = [...(declaration?.[1] ?? '').matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
  const styles = [...lire('src/web/viz.css').matchAll(/\.agent-badge\.agent-([a-z]+)/g)].map(m => m[1]);
  // Assert
  expect(vue, 'KNOWN_AGENTS de src/web/viz-network.ts').toEqual(serveur);
  expect([...new Set(styles)].sort(), 'classes .agent-badge.agent-* de src/web/viz.css').toEqual(serveur);
});
