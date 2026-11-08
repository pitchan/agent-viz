// Où Codex range le transcript d'un sous-agent : dans le dossier du jour local de sa création,
// sous la même racine que le transcript du fil qui l'a lancé.
import { afterEach, beforeEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codexChildTranscript } from '../../src/server/codex-child-transcript.ts';

const FIL = '01a18c32-9406-7bf2-b730-000000000002';
let racine: string;

beforeEach(() => { racine = fs.mkdtempSync(path.join(os.tmpdir(), 'aviz-codex-enfant-')); });
afterEach(() => { fs.rmSync(racine, { recursive: true, force: true }); });

function poser(jour: string, nom: string): string {
  const dossier = path.join(racine, ...jour.split('/'));
  fs.mkdirSync(dossier, { recursive: true });
  const fichier = path.join(dossier, nom);
  fs.writeFileSync(fichier, '');
  return fichier;
}

test('le transcript d un sous-agent se trouve par son fil dans le dossier du jour de son lancement', () => {
  // Arrange
  const parent = poser('2026/10/30', 'rollout-2026-10-30T10-44-37-01a18c32-6f35-78b0-a09f-000000000001.jsonl');
  const enfant = poser('2026/10/30', `rollout-2026-10-30T10-44-47-${FIL}.jsonl`);
  const lancement = new Date(2026, 9, 30, 10, 44, 47, 430).toISOString();
  // Act
  const trouve = codexChildTranscript(parent, FIL, lancement);
  // Assert
  expect(trouve).toBe(enfant);
});

test('un sous-agent créé juste avant minuit et annoncé juste après se trouve dans le dossier de la veille', () => {
  // Arrange
  const parent = poser('2026/10/30', 'rollout-2026-10-30T23-50-00-01a18c32-6f35-78b0-a09f-000000000001.jsonl');
  const enfant = poser('2026/10/30', `rollout-2026-10-30T23-59-59-${FIL}.jsonl`);
  const lancement = new Date(2026, 9, 31, 0, 0, 0, 40).toISOString();
  // Act
  const trouve = codexChildTranscript(parent, FIL, lancement);
  // Assert
  expect(trouve).toBe(enfant);
});

test('un fil sans transcript sur le disque ne donne aucun chemin', () => {
  // Arrange
  const parent = poser('2026/10/30', 'rollout-2026-10-30T10-44-37-01a18c32-6f35-78b0-a09f-000000000001.jsonl');
  const lancement = new Date(2026, 9, 30, 10, 44, 47, 430).toISOString();
  // Act
  const trouve = codexChildTranscript(parent, FIL, lancement);
  // Assert
  expect(trouve).toBe(null);
});
