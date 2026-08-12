import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { iterJsonlLines, type JsonlLine } from '../../src/engine/core/jsonl.js';

const dir = mkdtempSync(path.join(tmpdir(), 'netgain-jsonl-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function writeFixture(name: string, content: string | Buffer): string {
  const p = path.join(dir, name);
  writeFileSync(p, content);
  return p;
}

async function collect(p: string): Promise<JsonlLine[]> {
  const out: JsonlLine[] = [];
  for await (const line of iterJsonlLines(p)) out.push(line);
  return out;
}

describe('iterJsonlLines', () => {
  test('parse chaque ligne JSON valide', async () => {
    const p = writeFixture('ok.jsonl', '{"a":1}\n{"b":2}\n');
    expect(await collect(p)).toEqual([
      { ok: true, value: { a: 1 } },
      { ok: true, value: { b: 2 } },
    ]);
  });

  test('ligne cassée signalée, jamais de throw, les suivantes continuent', async () => {
    const p = writeFixture('broken.jsonl', '{"a":1}\n{"tronqué":\n{"c":3}\n');
    expect(await collect(p)).toEqual([
      { ok: true, value: { a: 1 } },
      { ok: false, rawLength: 11 },
      { ok: true, value: { c: 3 } },
    ]);
  });

  test('BOM UTF-8 sur la première ligne toléré', async () => {
    const p = writeFixture('bom.jsonl', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}\n')]));
    expect(await collect(p)).toEqual([{ ok: true, value: { a: 1 } }]);
  });

  test('fins de ligne CRLF tolérées', async () => {
    const p = writeFixture('crlf.jsonl', '{"a":1}\r\n{"b":2}\r\n');
    expect(await collect(p)).toEqual([
      { ok: true, value: { a: 1 } },
      { ok: true, value: { b: 2 } },
    ]);
  });

  test('lignes vides ignorées, fichier vide = zéro événement', async () => {
    const empty = writeFixture('empty.jsonl', '');
    const blanks = writeFixture('blanks.jsonl', '\n\n{"a":1}\n\n');
    expect(await collect(empty)).toEqual([]);
    expect(await collect(blanks)).toEqual([{ ok: true, value: { a: 1 } }]);
  });
});
