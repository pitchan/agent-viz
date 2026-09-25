// Une session minimale telle que les règles de skills la lisent : rapport réduit aux
// faits de skills. `null` imite un rapport stocké avant ces faits.
import type { Session, SkillFacts } from '../../src/server/observatory/rules/types.ts';

export const listed = (name: string, chars = 100, hasDescription = true) => ({ name, chars, hasDescription });

export function skillSession(id: string, facts: Partial<SkillFacts> | null,
  { costUsd = 10, netTokens = 100000, costComplete = true } = {}): Session {
  const skills = facts === null ? { listed: [], calls: {}, attributed: [] }
    : { listed: [], calls: {}, attributed: [], listing: [], typed: {}, bodies: [], unattributedBodies: 0, ...facts };
  return {
    id, project: 'F--proj', startedAt: '2026-09-01T10:00:00.000Z', endedAt: '2026-09-01T11:00:00.000Z',
    sessionKind: 'interactive', netTokens, costUsd, costComplete,
    report: { cwd: 'F:/DEV/proj', skills },
  } as unknown as Session;
}
