export interface SubagentStats {
  /** Fichiers side-car subagents/agent-*.jsonl découverts. */
  sidecarCount: number;
  /** tool_uses de spawn vus dans le main (Agent en 2.1.201, Task avant). */
  spawnToolUses: number;
  byType: Record<string, number>;
}

export const SPAWN_TOOL_NAMES = new Set(['Agent', 'Task']);

/** Métrique 3 : dépense sous-agents — combien de spawns, de quels types. */
export class SubagentsAggregator {
  private sidecarCount = 0;
  private spawnToolUses = 0;
  private readonly byType: Record<string, number> = {};

  addSidecar(agentType: string | null): void {
    this.sidecarCount += 1;
    const key = agentType ?? '(sans meta)';
    this.byType[key] = (this.byType[key] ?? 0) + 1;
  }

  addSpawnToolUse(toolName: string): void {
    if (SPAWN_TOOL_NAMES.has(toolName)) this.spawnToolUses += 1;
  }

  result(): SubagentStats {
    return { sidecarCount: this.sidecarCount, spawnToolUses: this.spawnToolUses, byType: this.byType };
  }
}
