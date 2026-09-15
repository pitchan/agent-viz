// La plage de Node exigée est une donnée dupliquée : package.json, package-lock.json
// et la section « Requirements » du README la recopient. Ce test verrouille les trois.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const lit = (fichier) => readFileSync(path.join(ROOT, fichier), 'utf8');

test('le README « Requirements » cite mot pour mot la plage engines.node', () => {
  // Arrange
  const plage = JSON.parse(lit('package.json')).engines.node;
  const readme = lit('README.md');
  // Act
  const requirements = readme.slice(readme.indexOf('## Requirements'), readme.indexOf('## Development'));
  // Assert
  assert.ok(requirements.includes('`' + plage + '`'),
    `README « Requirements » ne cite pas \`${plage}\` :\n${requirements}`);
});

test('package-lock.json recopie la plage engines.node du paquet racine', () => {
  // Arrange
  const plage = JSON.parse(lit('package.json')).engines.node;
  // Act
  const racineDuLock = JSON.parse(lit('package-lock.json')).packages[''];
  // Assert
  assert.equal(racineDuLock.engines.node, plage);
});
