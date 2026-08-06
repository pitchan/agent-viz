import { describe, expect, test } from 'vitest';
import { SubagentsAggregator } from '../../src/doctor/aggregators/subagents.js';

describe('SubagentsAggregator', () => {
  test('compte les side-cars et ventile par agentType du meta.json', () => {
    const agg = new SubagentsAggregator();
    agg.addSidecar('Explore');
    agg.addSidecar('Explore');
    agg.addSidecar('claude-code-guide');
    agg.addSidecar(null);
    const r = agg.result();
    expect(r.sidecarCount).toBe(4);
    expect(r.byType).toEqual({ Explore: 2, 'claude-code-guide': 1, '(sans meta)': 1 });
  });

  test('compte les tool_uses de spawn Agent ET Task (legacy), ignore le reste', () => {
    const agg = new SubagentsAggregator();
    agg.addSpawnToolUse('Agent');
    agg.addSpawnToolUse('Task');
    agg.addSpawnToolUse('Bash');
    agg.addSpawnToolUse('Read');
    const r = agg.result();
    expect(r.spawnToolUses).toBe(2);
  });
});
