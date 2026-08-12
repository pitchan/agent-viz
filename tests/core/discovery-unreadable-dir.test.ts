import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { discoverSessions } from '../../src/engine/core/discovery.js';

// Item 1 de la revue : le balayage récursif d'origine (readdir({recursive:true})) rejette
// la promesse ENTIÈRE au premier sous-dossier illisible, et la session perd TOUS ses
// sous-agents — pas seulement ceux du dossier fautif. Prouvé en réel avec une ACE de refus
// sur wf_1/ (voir la revue), mais une vraie ACL Windows est lente à poser et à lever, et
// flaky selon les droits de la machine qui fait tourner la suite. On simule donc l'échec de
// scandir avec un mock CIBLÉ sur node:fs/promises : seul le readdir() dont le chemin se
// termine par ce segment échoue (EPERM), tout le reste passe par l'implémentation réelle.
// Portable, déterministe, aucune ACL touchée.
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

describe('discoverSubagents — dossier illisible (Item 1 de la revue)', () => {
  test('un sous-dossier dont le readdir échoue coûte CE dossier, pas la session entière', async () => {
    const sessions = await discoverSessions(claudeDir, {});
    const sess = sessions.find((s) => s.sessionId === 'sess-new');
    const ids = sess?.subagents.map((a) => a.agentId) ?? [];
    // Le sous-agent ordinaire du même parent survit : l'échec reste localisé au dossier fautif.
    expect(ids).toContain('abc');
    // Celui du dossier bloqué est simplement absent — aucune erreur ne remonte jusqu'ici,
    // contrairement à l'ancien readdir({recursive:true}) qui aurait fait perdre 'abc' aussi.
    expect(ids).not.toContain('xyz');
  });
});
