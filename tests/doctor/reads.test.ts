import { describe, expect, test } from 'vitest';
import type { NormalizedEvent, ToolUseRef } from '../../src/engine/core/events.js';
import { ReadsAggregator } from '../../src/engine/doctor/aggregators/reads.js';

function readUse(id: string, filePath: string, range?: { offset?: number; limit?: number }): ToolUseRef {
  return { id, name: 'Read', input: { file_path: filePath, ...range } };
}

function result(id: string, bytes: number, contentHash: string | null, isError = false): Extract<NormalizedEvent, { kind: 'tool_result' }> {
  return { kind: 'tool_result', toolUseId: id, bytes, isError, contentHash };
}

describe('ReadsAggregator — ventilation des lectures Read', () => {
  test('première lecture d’un fichier → firstRead', () => {
    const agg = new ReadsAggregator();
    agg.registerToolUse(readUse('t1', 'C:\\proj\\a.ts'));
    agg.addToolResult(result('t1', 5000, 'aaa'), 'main');
    const r = agg.result();
    expect(r.cases.firstRead).toEqual({ count: 1, bytes: 5000 });
    expect(r.totalResults).toBe(1);
    expect(r.totalBytes).toBe(5000);
  });

  test('même agent, même fichier, même empreinte → relecture identique (le gisement du dédoublonneur)', () => {
    const agg = new ReadsAggregator();
    agg.registerToolUse(readUse('t1', 'a.ts'));
    agg.registerToolUse(readUse('t2', 'a.ts'));
    agg.addToolResult(result('t1', 5000, 'aaa'), 'main');
    agg.addToolResult(result('t2', 5000, 'aaa'), 'main');
    const r = agg.result();
    expect(r.cases.firstRead).toEqual({ count: 1, bytes: 5000 });
    expect(r.cases.identicalReread).toEqual({ count: 1, bytes: 5000 });
  });

  test('même agent, même fichier, empreinte différente → relecture après modification (irréductible)', () => {
    const agg = new ReadsAggregator();
    agg.registerToolUse(readUse('t1', 'a.ts'));
    agg.registerToolUse(readUse('t2', 'a.ts'));
    agg.addToolResult(result('t1', 5000, 'aaa'), 'main');
    agg.addToolResult(result('t2', 5200, 'bbb'), 'main');
    expect(agg.result().cases.modifiedReread).toEqual({ count: 1, bytes: 5200 });
  });

  test('autre agent de la même session, même fichier + empreinte → doublon inter-agents', () => {
    const agg = new ReadsAggregator();
    agg.registerToolUse(readUse('t1', 'a.ts'));
    agg.registerToolUse(readUse('t2', 'a.ts'));
    agg.addToolResult(result('t1', 5000, 'aaa'), 'main');
    agg.addToolResult(result('t2', 5000, 'aaa'), 'agent-x');
    expect(agg.result().cases.crossAgentDuplicate).toEqual({ count: 1, bytes: 5000 });
    expect(agg.result().cases.identicalReread).toEqual({ count: 0, bytes: 0 });
  });

  test('une plage différente (offset/limit) est une autre clé → firstRead, pas une relecture', () => {
    const agg = new ReadsAggregator();
    agg.registerToolUse(readUse('t1', 'a.ts'));
    agg.registerToolUse(readUse('t2', 'a.ts', { offset: 100, limit: 50 }));
    agg.addToolResult(result('t1', 5000, 'aaa'), 'main');
    agg.addToolResult(result('t2', 800, 'ccc'), 'main');
    expect(agg.result().cases.firstRead).toEqual({ count: 2, bytes: 5800 });
  });

  test('résultat en erreur → compté à part, jamais classé', () => {
    const agg = new ReadsAggregator();
    agg.registerToolUse(readUse('t1', 'absent.ts'));
    agg.registerToolUse(readUse('t2', 'absent.ts'));
    agg.addToolResult(result('t1', 120, null, true), 'main');
    agg.addToolResult(result('t2', 120, null, true), 'main');
    const r = agg.result();
    expect(r.cases.error).toEqual({ count: 2, bytes: 240 });
    expect(r.cases.firstRead).toEqual({ count: 0, bytes: 0 });
  });

  test('les résultats des autres outils sont ignorés', () => {
    const agg = new ReadsAggregator();
    agg.registerToolUse({ id: 'g1', name: 'Grep', input: { pattern: 'x' } });
    agg.addToolResult(result('g1', 9000, 'zzz'), 'main');
    expect(agg.result().totalResults).toBe(0);
  });

  test('invariant : les cases s’additionnent exactement au total (occurrences et octets)', () => {
    const agg = new ReadsAggregator();
    const uses: [string, string, string | null, number, string, boolean?][] = [
      ['t1', 'a.ts', 'aaa', 5000, 'main'],
      ['t2', 'a.ts', 'aaa', 5000, 'main'], // identique
      ['t3', 'a.ts', 'bbb', 5100, 'main'], // modifiée
      ['t4', 'b.ts', 'ddd', 2000, 'main'],
      ['t5', 'b.ts', 'ddd', 2000, 'agent-x'], // doublon inter-agents
      ['t6', 'c.ts', null, 100, 'main', true], // erreur
    ];
    for (const [id, file] of uses.map((u) => [u[0], u[1]] as const)) agg.registerToolUse(readUse(id, file));
    for (const [id, , hash, bytes, agent, isError] of uses) agg.addToolResult(result(id, bytes, hash, isError ?? false), agent);
    const r = agg.result();
    const cases = Object.values(r.cases);
    expect(cases.reduce((a, c) => a + c.count, 0)).toBe(r.totalResults);
    expect(cases.reduce((a, c) => a + c.bytes, 0)).toBe(r.totalBytes);
    expect(r.totalResults).toBe(6);
    expect(r.totalBytes).toBe(19200);
  });
});
