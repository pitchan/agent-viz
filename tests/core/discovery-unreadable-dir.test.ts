import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { discoverSessions } from '../../src/engine/core/discovery.ts';

// Un sous-dossier illisible ne coûte que lui-même : un readdir({recursive:true}) unique
// rejette la promesse ENTIÈRE au premier sous-dossier illisible, et la session perd TOUS
// ses sous-agents, pas seulement ceux du dossier fautif.
//
// Une vraie ACL de refus sous Windows est lente à poser et à lever, et dépend des droits de
// la machine : un mock CIBLÉ sur node:fs/promises fait échouer (EPERM) le seul readdir() dont
// le chemin se termine par ce segment, tout le reste passe par l'implémentation réelle.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const mockedReaddir = (async (dir: unknown, opts?: unknown) => {
    if (typeof dir === 'string' && dir.endsWith('blocked-by-mock')) {
      throw Object.assign(new Error('EPERM: operation not permitted, scandir'), { code: 'EPERM' });
    }
    return (actual.readdir as (d: unknown, o?: unknown) => Promise<unknown>)(dir, opts);
  }) as typeof actual.readdir;
  return { ...actual, readdir: mockedReaddir };
});

const claudeDir = mkdtempSync(path.join(tmpdir(), 'netgain-disc-unreadable-'));
afterAll(() => rmSync(claudeDir, { recursive: true, force: true }));

function touch(rel: string, content: string): void {
  const p = path.join(claudeDir, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
}

// Le nom 'blocked-by-mock' doit correspondre au littéral testé dans le mock ci-dessus.
touch('projects/F--DEV-proj-a/sess-new.jsonl', '{"type":"user"}\n');
touch('projects/F--DEV-proj-a/sess-new/subagents/agent-abc.jsonl', '{"type":"assistant"}\n');
touch('projects/F--DEV-proj-a/sess-new/subagents/blocked-by-mock/agent-xyz.jsonl', '{"type":"assistant"}\n');

describe('discoverSubagents — dossier illisible', () => {
  test('un sous-dossier dont le readdir échoue coûte CE dossier, pas la session entière', async () => {
    const sessions = await discoverSessions(claudeDir, {});
    const sess = sessions.find((s) => s.sessionId === 'sess-new');
    const ids = sess?.subagents.map((a) => a.agentId) ?? [];
    // Le sous-agent ordinaire du même parent survit : l'échec reste localisé au dossier fautif.
    expect(ids).toContain('abc');
    // Celui du dossier bloqué est simplement absent : aucune erreur ne remonte jusqu'ici.
    expect(ids).not.toContain('xyz');
  });
});
