// L'écriture atomique sur un vrai dossier temporaire : l'ancien fichier de hooks
// survit à une écriture ratée. Les pannes passent par un faux `io` bâti sur le
// vrai `fs`, jamais par un `fs` modifié en place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeJsonAtomic } from '../../src/server/install-hooks/atomic-write.ts';

const ANCIEN = '{\n  "hooks": {\n    "ancien": true\n  }\n}\n';

function dossierTemporaire() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-atomic-write-'));
}

function fichierExistant() {
  const dossier = dossierTemporaire();
  const fichier = path.join(dossier, 'settings.json');
  fs.writeFileSync(fichier, ANCIEN);
  return { dossier, fichier };
}

function erreurFs(code, detail) {
  return Object.assign(new Error(`${code}: ${detail}`), { code });
}

test('le fichier écrit porte le JSON indenté de deux espaces suivi d\'un retour à la ligne, dans un dossier parent créé au besoin', () => {
  // Arrange
  const fichier = path.join(dossierTemporaire(), 'absent', '.claude', 'settings.json');
  // Act
  writeJsonAtomic(fichier, { hooks: { Stop: [] } });
  // Assert
  assert.equal(fs.readFileSync(fichier, 'utf8'), '{\n  "hooks": {\n    "Stop": []\n  }\n}\n');
});

test('remplacer un fichier existant met le nouveau contenu en place et ne laisse aucun temporaire', () => {
  // Arrange
  const { dossier, fichier } = fichierExistant();
  // Act
  writeJsonAtomic(fichier, { hooks: { nouveau: true } });
  // Assert
  assert.deepEqual(fs.readdirSync(dossier), ['settings.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(fichier, 'utf8')), { hooks: { nouveau: true } });
});

test('un renommage refusé laisse l\'ancien fichier intact, retire le temporaire et relance l\'erreur telle quelle', () => {
  // Arrange
  const { dossier, fichier } = fichierExistant();
  const refus = erreurFs('EPERM', 'operation not permitted, rename');
  const io = { ...fs, renameSync: () => { throw refus; } };
  // Act
  const appel = () => writeJsonAtomic(fichier, { hooks: { nouveau: true } }, io);
  // Assert
  assert.throws(appel, (e) => e === refus);
  assert.equal(fs.readFileSync(fichier, 'utf8'), ANCIEN);
  assert.deepEqual(fs.readdirSync(dossier), ['settings.json']);
});

test('une écriture du temporaire refusée laisse l\'ancien fichier intact et relance l\'erreur telle quelle', () => {
  // Arrange
  const { fichier } = fichierExistant();
  const refus = erreurFs('ENOSPC', 'no space left on device, write');
  const io = { ...fs, writeFileSync: () => { throw refus; } };
  // Act
  const appel = () => writeJsonAtomic(fichier, { hooks: { nouveau: true } }, io);
  // Assert
  assert.throws(appel, (e) => e === refus);
  assert.equal(fs.readFileSync(fichier, 'utf8'), ANCIEN);
});

// Copilot charge tout `*.json` de ses dossiers de hooks : un temporaire nommé
// ainsi serait lu comme un second fichier de hooks.
test('le contenu part d\'abord dans un fichier dont le nom ne finit pas par .json', () => {
  // Arrange
  const fichier = path.join(dossierTemporaire(), 'agent-viz.json');
  const cheminsEcrits = [];
  const io = {
    ...fs,
    writeFileSync: (chemin, donnees) => { cheminsEcrits.push(chemin); fs.writeFileSync(chemin, donnees); },
  };
  // Act
  writeJsonAtomic(fichier, { version: 1, hooks: {} }, io);
  // Assert
  assert.equal(cheminsEcrits.length, 1);
  assert.doesNotMatch(cheminsEcrits[0], /\.json$/);
});
