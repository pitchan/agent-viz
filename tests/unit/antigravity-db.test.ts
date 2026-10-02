// La lecture des jetons d'Antigravity dans la base de la conversation, sur une base fabriquée
// dans un dossier temporaire à l'image de l'arborescence d'agy.
import { afterEach, beforeEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { antigravityUsageSnapshot } from '../../src/server/transcript-adapters/antigravity-db.ts';
import { pbBytes, pbMessage, pbVarint } from '../helpers/protobuf-encode.ts';

let racine: string;
let transcript: string;
let base: string;

beforeEach(() => {
  racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-db-test-'));
  transcript = path.join(racine, 'brain', 'conv-1', '.system_generated', 'logs', 'transcript_full.jsonl');
  base = path.join(racine, 'conversations', 'conv-1.db');
  fs.mkdirSync(path.dirname(base), { recursive: true });
});

afterEach(() => {
  fs.rmSync(racine, { recursive: true, force: true });
});

function appel(id: string, entree: number, sortie: number, reflexion: number): Uint8Array {
  const usage = pbMessage(
    pbVarint(2, entree), pbVarint(3, sortie), pbBytes(7, id), pbVarint(9, reflexion), pbVarint(10, sortie - reflexion),
  );
  return pbMessage(pbBytes(1, pbMessage(pbBytes(4, usage), pbBytes(19, 'gemini-3.8-flash'))));
}

function ecrireBase(blocs: Uint8Array[]): void {
  const db = new DatabaseSync(base);
  db.exec('CREATE TABLE gen_metadata (idx integer PRIMARY KEY, data blob, size integer NOT NULL DEFAULT 0)');
  const insert = db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)');
  blocs.forEach((bloc, i) => insert.run(i, bloc));
  db.close();
}

test('chaque appel au modèle de la conversation est rendu, dans l\'ordre', () => {
  // Arrange
  ecrireBase([appel('bot-a', 12087, 749, 657), appel('bot-b', 12924, 149, 46)]);
  // Act
  const lu = antigravityUsageSnapshot.read(transcript);
  // Assert
  expect(lu).toEqual({
    ok: true,
    calls: [
      { id: 'bot-a', model: 'gemini-3.8-flash', usage: { input_tokens: 12087, output_tokens: 749, cache_read_input_tokens: 0 } },
      { id: 'bot-b', model: 'gemini-3.8-flash', usage: { input_tokens: 12924, output_tokens: 149, cache_read_input_tokens: 0 } },
    ],
  });
});

test('un seul appel au format refusé fait refuser toute la lecture, en nommant l\'appel', () => {
  // Arrange
  ecrireBase([appel('bot-a', 12087, 749, 657), Uint8Array.from([0x0b])]);
  // Act
  const lu = antigravityUsageSnapshot.read(transcript);
  // Assert
  expect(lu).toEqual({ ok: false, reason: 'appel 1 : bloc illisible' });
});

test('la lecture ne laisse aucun fichier à côté de la base', () => {
  // Arrange
  ecrireBase([appel('bot-a', 12087, 749, 657)]);
  // Act
  antigravityUsageSnapshot.read(transcript);
  // Assert
  expect(fs.readdirSync(path.dirname(base))).toEqual(['conv-1.db']);
});

test('l\'empreinte est nulle tant que la base n\'existe pas', () => {
  // Arrange — aucune base écrite
  // Act
  const empreinte = antigravityUsageSnapshot.stamp(transcript);
  // Assert
  expect(empreinte).toBeNull();
});

test('l\'empreinte change quand le journal de la base grossit', () => {
  // Arrange
  ecrireBase([appel('bot-a', 12087, 749, 657)]);
  const avant = antigravityUsageSnapshot.stamp(transcript);
  fs.writeFileSync(`${base}-wal`, 'x'.repeat(64));
  // Act
  const apres = antigravityUsageSnapshot.stamp(transcript);
  // Assert
  expect(apres).not.toBe(avant);
});
