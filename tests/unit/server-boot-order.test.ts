// L'ordre de demarrage que le lecteur d'evenements suppose. Lu dans le source
// et non charge : charger server.ts lie le port 3333 de la machine.
//
// Le watcher du dossier ne s'arme qu'apres l'index initial. Arme avant, il
// poserait une fiche vide sur une session active que l'index n'a pas encore
// comptee, et toute la session serait rejouee sur le canevas.

import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const SOURCE = fs.readFileSync(
  path.join(import.meta.dirname, '..', '..', 'src', 'server', 'server.ts'), 'utf8');

test('le watcher du dossier d evenements s arme apres l index initial, et une seule fois', () => {
  // Arrange
  const debutBoot = SOURCE.indexOf('async function boot(');

  // Act
  const indexInitial = SOURCE.indexOf('await scanAndWatch()', debutBoot);
  const armement = SOURCE.indexOf('fs.watch(DIR');

  // Assert
  expect(debutBoot, '`async function boot(` introuvable dans src/server/server.ts').toBeGreaterThan(-1);
  expect(indexInitial, '`await scanAndWatch()` introuvable dans boot').toBeGreaterThan(debutBoot);
  expect(armement, 'le watcher du dossier s arme avant l index initial').toBeGreaterThan(indexInitial);
  expect(SOURCE.lastIndexOf('fs.watch(DIR'), 'le dossier d evenements est surveille deux fois').toBe(armement);
});
