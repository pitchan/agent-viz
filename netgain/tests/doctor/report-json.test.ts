import { describe, expect, test } from 'vitest';
import { stableStringify } from '../../src/doctor/report/json.js';

describe('stableStringify', () => {
  test('clés triées récursivement, round-trip fidèle', () => {
    const obj = { b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } };
    const out = stableStringify(obj);
    expect(JSON.parse(out)).toEqual(obj);
    expect(out.indexOf('"a"')).toBeLessThan(out.indexOf('"b"'));
    expect(out.indexOf('"c"')).toBeLessThan(out.indexOf('"d"'));
    expect(out.indexOf('"e"')).toBeLessThan(out.indexOf('"f"'));
  });

  test('déterministe : deux objets équivalents donnent la même chaîne', () => {
    expect(stableStringify({ x: 1, y: 2 })).toBe(stableStringify({ y: 2, x: 1 }));
  });
});
