import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { InstallError, readJsonFile, writeJsonFileAtomic } from '../../src/engine/install/json-file.js';

const root = mkdtempSync(path.join(tmpdir(), 'netgain-jsonfile-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
function file(content?: string): string {
  const p = path.join(root, `f${n++}.json`);
  if (content !== undefined) writeFileSync(p, content);
  return p;
}

describe('readJsonFile', () => {
  test('fichier absent → value undefined, indent par défaut 2 espaces', () => {
    expect(readJsonFile(file())).toEqual({ value: undefined, indent: '  ' });
  });

  test('JSON valide → objet parsé', () => {
    expect(readJsonFile(file('{\n  "a": 1\n}\n')).value).toEqual({ a: 1 });
  });

  test('BOM U+FEFF toléré (leçon v0.2.1)', () => {
    expect(readJsonFile(file('﻿{\n  "a": 1\n}\n')).value).toEqual({ a: 1 });
  });

  test('JSON invalide → InstallError citant le chemin', () => {
    const p = file('{oops');
    expect(() => readJsonFile(p)).toThrow(InstallError);
    expect(() => readJsonFile(p)).toThrow(path.basename(p));
  });

  test('indentation 4 espaces détectée', () => {
    expect(readJsonFile(file('{\n    "a": 1\n}\n')).indent).toBe('    ');
  });

  test('indentation tab détectée', () => {
    expect(readJsonFile(file('{\n\t"a": 1\n}\n')).indent).toBe('\t');
  });
});

describe('writeJsonFileAtomic', () => {
  test("écrit l'indentation donnée, \\n final, sans BOM, sans temp résiduel", () => {
    const p = file();
    writeJsonFileAtomic(p, { a: 1 }, '    ');
    const raw = readFileSync(p, 'utf8');
    expect(raw).toBe('{\n    "a": 1\n}\n');
    expect(raw.charCodeAt(0)).not.toBe(0xfeff);
    expect(readdirSync(path.dirname(p)).filter((f) => f.includes('netgain-tmp'))).toEqual([]);
  });

  test('crée le dossier parent manquant (.claude/ inexistant)', () => {
    const p = path.join(root, 'sub', '.claude', 'settings.local.json');
    writeJsonFileAtomic(p, { a: 1 }, '  ');
    expect(readJsonFile(p).value).toEqual({ a: 1 });
  });

  test('roundtrip : indentation détectée en lecture réutilisée en écriture', () => {
    const p = file('{\n    "a": 1,\n    "b": 2\n}\n');
    const { value, indent } = readJsonFile(p);
    writeJsonFileAtomic(p, value, indent);
    expect(readFileSync(p, 'utf8')).toBe('{\n    "a": 1,\n    "b": 2\n}\n');
  });
});
