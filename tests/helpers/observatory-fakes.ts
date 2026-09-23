// Un rapport de session et une référence de transcript minimaux, tels que le scan
// incrémental de l'observatoire les consomme — sans moteur ni fichier.
import type { SessionRef } from '../../src/engine/core/discovery.ts';
import type { SessionReport } from '../../src/engine/doctor/report/types.ts';

export function fakeReport(id: string, over: Record<string, unknown> = {}) {
  return {
    sessionId: id, projectSlug: 'F--proj', cwd: 'F:\\proj',
    startedAt: '2026-07-01T10:00:00.000Z', endedAt: '2026-07-01T10:20:00.000Z',
    sessionKind: 'interactive',
    tokens: { perModel: { 'claude-opus-4-8': { in: 100, out: 50, cacheCreate: 850, cacheRead: 4000 } },
      costUsd: 0.5, costComplete: true },
    netTokens: 1000, events: 10, parseErrors: 0,
    ...over,
  } as unknown as SessionReport;
}

// Une ligne du magasin dont le rapport n'appelle que ces modèles : ce que le service
// relit pour savoir quels modèles les transcripts utilisent.
export const storedRowUsing = (id: string, models: string[]) => ({
  id, project: 'F--proj', startedAt: '2026-09-01T10:00:00.000Z', endedAt: '2026-09-01T10:20:00.000Z',
  sessionKind: 'interactive', netTokens: 0, costUsd: 0, costComplete: true,
  reportJson: JSON.stringify({ tokens: { perModel: Object.fromEntries(models.map(m => [m, {}])) } }),
});

export const fakeRef = (id: string, { mtime = 1000, size = 2048 } = {}) => ({
  sessionId: id, projectSlug: 'F--proj', mainPath: `F:\\p\\${id}.jsonl`,
  subagents: [], mtime: new Date(mtime), sizeBytes: size } as unknown as SessionRef);
