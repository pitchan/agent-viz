// La copie d'un fichier de hooks sur un vrai dossier temporaire : les octets
// d'avant, un dossier par fichier source, les 30 dernières copies. Les pannes
// passent par un faux `io` bâti sur le vrai `fs`, jamais par un `fs` modifié en place.
import { expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupHookFile } from '../../src/server/install-hooks/backup.ts';

const T0 = Date.UTC(2026, 8, 14, 10, 5, 7, 123);
const CRLF = '{\r\n  "a": 1\r\n}\r\n';

// Un fichier de hooks dans un dossier dont le nom porte une espace, et la racine
// des copies à côté, pas encore créée.
function fichierSource() {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-backup-'));
  const file = path.join(dossier, 'src dir', 'settings.local.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, CRLF);
  return { dossier, file, root: path.join(dossier, 'backups') };
}

function dossierDesCopies(root: string, file: string) {
  return path.join(root, file.replace(/[^A-Za-z0-9._-]/g, '-'));
}

function nomDeCopie(ms: number) {
  return new Date(ms).toISOString().replace(/:/g, '-') + '.json';
}

// Trente copies plus anciennes que T0, d'une milliseconde chacune.
function poserTrenteCopies(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  for (let k = 30; k >= 1; k--) fs.writeFileSync(path.join(dir, nomDeCopie(T0 - k)), 'ancienne');
}

function erreurFs(code: string, detail: string) {
  return Object.assign(new Error(`${code}: ${detail}`), { code });
}

test('la copie garde les octets tels quels, fins de ligne CRLF comprises, et rend son chemin dans le dossier nommé d\'après le fichier source', () => {
  // Arrange
  const { file, root } = fichierSource();
  // Act
  const copie = backupHookFile(file, { root, now: () => T0 });
  // Assert
  expect(copie).toBe(path.join(dossierDesCopies(root, file), '2026-09-14T10-05-07.123Z.json'));
  expect(fs.readFileSync(copie!)).toEqual(Buffer.from(CRLF));
});

test('un fichier absent ne se copie pas : rien n\'est rendu et la racine des copies n\'est pas créée', () => {
  // Arrange
  const { dossier, root } = fichierSource();
  const absent = path.join(dossier, 'absent.json');
  // Act
  const copie = backupHookFile(absent, { root, now: () => T0 });
  // Assert
  expect(copie).toBe(null);
  expect(fs.existsSync(root)).toBe(false);
});

test('au-delà de 30 copies, la plus ancienne part et un fichier posé là par quelqu\'un d\'autre reste', () => {
  // Arrange
  const { file, root } = fichierSource();
  const dir = dossierDesCopies(root, file);
  poserTrenteCopies(dir);
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'posé à la main');
  // Act
  backupHookFile(file, { root, now: () => T0 });
  // Assert
  const noms = fs.readdirSync(dir);
  expect(noms.filter(nom => nom.endsWith('Z.json')).length).toBe(30);
  expect(noms.includes(nomDeCopie(T0 - 30)), 'la plus ancienne copie devait partir').toBe(false);
  expect(noms.includes(nomDeCopie(T0)), 'la nouvelle copie devait rester').toBeTruthy();
  expect(noms.includes('notes.txt'), 'un fichier étranger ne devait être ni compté ni supprimé').toBeTruthy();
});

test('deux copies du même fichier dans la même milliseconde : la seconde prend la milliseconde suivante, se trie après la première, et la première garde les octets d\'origine', () => {
  // Arrange
  const { file, root } = fichierSource();
  const premiere = backupHookFile(file, { root, now: () => T0 });
  fs.writeFileSync(file, '{"reecrit":true}\n');
  // Act
  const seconde = backupHookFile(file, { root, now: () => T0 });
  // Assert
  expect(seconde).toBe(path.join(dossierDesCopies(root, file), nomDeCopie(T0 + 1)));
  expect(fs.readFileSync(seconde!, 'utf8')).toBe('{"reecrit":true}\n');
  expect(fs.readFileSync(premiere!, 'utf8')).toBe(CRLF);
  expect(fs.readdirSync(dossierDesCopies(root, file)).sort()).toEqual([nomDeCopie(T0), nomDeCopie(T0 + 1)]);
});

test('une horloge en retard sur les copies déjà là : la copie neuve se nomme après la dernière et la purge la garde', () => {
  // Arrange
  const { file, root } = fichierSource();
  const dir = dossierDesCopies(root, file);
  const T1 = T0 + 60 * 60 * 1000;
  fs.mkdirSync(dir, { recursive: true });
  for (let k = 29; k >= 0; k--) fs.writeFileSync(path.join(dir, nomDeCopie(T1 - k)), 'ancienne');
  // Act
  const copie = backupHookFile(file, { root, now: () => T0 });
  // Assert
  expect(copie).toBe(path.join(dir, nomDeCopie(T1 + 1)));
  expect(fs.readFileSync(copie!, 'utf8')).toBe(CRLF);
  expect(fs.readdirSync(dir).length).toBe(30);
  expect(fs.existsSync(path.join(dir, nomDeCopie(T1 - 29))), 'la plus ancienne copie devait partir').toBe(false);
});

test('une copie ne s\'écrase jamais : un nom pris entre la lecture du dossier et la copie lève EEXIST et la copie déjà là garde ses octets', () => {
  // Arrange
  const { file, root } = fichierSource();
  const premiere = backupHookFile(file, { root, now: () => T0 });
  fs.writeFileSync(file, '{"reecrit":true}\n');
  // Un dossier lu vide : le nom de T0 paraît libre, comme si un autre processus
  // venait de le prendre.
  const io = { ...fs, readdirSync: () => [] };
  // Act
  const appel = () => backupHookFile(file, { root, io, now: () => T0 });
  // Assert
  try {
    appel();
    expect.fail('devrait avoir levé');
  } catch (e: any) {
    expect(e.message.startsWith(`backup of ${file} failed, file left unchanged: EEXIST`)).toBeTruthy();
    expect(e.cause.code).toBe('EEXIST');
  }
  expect(fs.readFileSync(premiere!, 'utf8')).toBe(CRLF);
});

test('une copie qui échoue lève en nommant le fichier de hooks et garde l\'erreur fs en cause', () => {
  // Arrange
  const { file, root } = fichierSource();
  const refus = erreurFs('EACCES', 'permission denied, copyfile');
  const io = { ...fs, copyFileSync: () => { throw refus; } };
  // Act
  const appel = () => backupHookFile(file, { root, io, now: () => T0 });
  // Assert
  try {
    appel();
    expect.fail('devrait avoir levé');
  } catch (e: any) {
    expect(e.message).toBe(`backup of ${file} failed, file left unchanged: EACCES: permission denied, copyfile`);
    expect(e.cause).toBe(refus);
  }
});

test('une purge qui échoue lève aussi, en nommant le fichier de hooks', () => {
  // Arrange
  const { file, root } = fichierSource();
  poserTrenteCopies(dossierDesCopies(root, file));
  const refus = erreurFs('EBUSY', 'resource busy or locked, unlink');
  const io = { ...fs, unlinkSync: () => { throw refus; } };
  // Act
  const appel = () => backupHookFile(file, { root, io, now: () => T0 });
  // Assert
  try {
    appel();
    expect.fail('devrait avoir levé');
  } catch (e: any) {
    expect(e.message).toBe(`backup of ${file} failed, file left unchanged: EBUSY: resource busy or locked, unlink`);
    expect(e.cause).toBe(refus);
  }
});
