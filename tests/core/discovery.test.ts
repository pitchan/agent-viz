import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { discoverSessions, parseSince } from '../../src/engine/core/discovery.js';

const claudeDir = mkdtempSync(path.join(tmpdir(), 'netgain-disc-'));
afterAll(() => rmSync(claudeDir, { recursive: true, force: true }));

function touch(rel: string, content: string, mtime: Date): string {
  const p = path.join(claudeDir, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
  utimesSync(p, mtime, mtime);
  return p;
}

const T1 = new Date('2026-07-01T10:00:00Z');
const T2 = new Date('2026-07-05T10:00:00Z');
const T3 = new Date('2026-07-09T10:00:00Z');

// Arbre factice imitant ~/.claude/projects
touch('projects/F--DEV-proj-a/sess-old.jsonl', '{"type":"user"}\n', T1);
touch('projects/F--DEV-proj-a/sess-new.jsonl', '{"type":"user"}\n', T3);
touch('projects/F--DEV-proj-a/sess-new/subagents/agent-abc.jsonl', '{"type":"assistant"}\n', T3);
touch('projects/F--DEV-proj-a/sess-new/subagents/agent-abc.meta.json', '{"agentType":"Explore"}', T3);
touch('projects/F--DEV-proj-a/sess-new/subagents/agent-def.jsonl', '{"type":"assistant"}\n', T3);
// Troisième palier : les sous-agents lancés par un workflow, plus deux leurres
// que le filtre de nom doit écarter (journal de workflow, script de workflow).
touch('projects/F--DEV-proj-a/sess-new/subagents/workflows/wf_123/agent-ghi.jsonl', '{"type":"assistant"}\n', T3);
touch('projects/F--DEV-proj-a/sess-new/subagents/workflows/wf_123/agent-ghi.meta.json', '{"agentType":"Plan"}', T3);
touch('projects/F--DEV-proj-a/sess-new/subagents/workflows/wf_123/journal.jsonl', '{"type":"other"}\n', T3);
touch('projects/F--DEV-proj-a/sess-new/subagents/workflows/wf_123.json', '{"meta":true}', T3);
// Second dossier de workflow, avec un agentId IDENTIQUE ('ghi') et un agentType
// DIFFÉRENT : si le meta était un jour reclé sur le nom seul au lieu du chemin
// complet, ce dossier volerait le meta de l'autre et le test le verrait.
touch('projects/F--DEV-proj-a/sess-new/subagents/workflows/wf_456/agent-ghi.jsonl', '{"type":"assistant"}\n', T3);
touch('projects/F--DEV-proj-a/sess-new/subagents/workflows/wf_456/agent-ghi.meta.json', '{"agentType":"Debug"}', T3);
touch('projects/F--DEV-proj-a/notes.txt', 'pas un transcript', T3);
touch('projects/D--other-proj/sess-mid.jsonl', '{"type":"user"}\n', T2);

describe('discoverSessions', () => {
  test('découvre les sessions de tous les projets, triées de la plus récente à la plus ancienne', async () => {
    const sessions = await discoverSessions(claudeDir, {});
    expect(sessions.map((s) => s.sessionId)).toEqual(['sess-new', 'sess-mid', 'sess-old']);
    expect(sessions.map((s) => s.projectSlug)).toEqual(['F--DEV-proj-a', 'D--other-proj', 'F--DEV-proj-a']);
    expect(sessions[0]?.mainPath.endsWith('sess-new.jsonl')).toBe(true);
  });

  test('attache les sous-agents avec meta.json quand présent, null sinon', async () => {
    const sessions = await discoverSessions(claudeDir, {});
    const withAgents = sessions.find((s) => s.sessionId === 'sess-new');
    // 'ghi' apparaît deux fois : un agentId identique dans deux dossiers de workflow
    // distincts (wf_123 et wf_456), cf. le test dédié ci-dessous pour le meta de chacun.
    expect(withAgents?.subagents.map((a) => a.agentId).sort()).toEqual(['abc', 'def', 'ghi', 'ghi']);
    const abc = withAgents?.subagents.find((a) => a.agentId === 'abc');
    const def = withAgents?.subagents.find((a) => a.agentId === 'def');
    expect(abc?.metaPath?.endsWith('agent-abc.meta.json')).toBe(true);
    expect(def?.metaPath).toBeNull();
    const without = sessions.find((s) => s.sessionId === 'sess-old');
    expect(without?.subagents).toEqual([]);
  });

  test('descend sous subagents/workflows/ sans y ramasser autre chose que des agent-*.jsonl', async () => {
    const sessions = await discoverSessions(claudeDir, {});
    const withAgents = sessions.find((s) => s.sessionId === 'sess-new');
    const ghis = withAgents?.subagents.filter((a) => a.agentId === 'ghi') ?? [];
    expect(ghis).toHaveLength(2);
    const wf123 = ghis.find((a) => a.jsonlPath.includes(path.join('workflows', 'wf_123')));
    const wf456 = ghis.find((a) => a.jsonlPath.includes(path.join('workflows', 'wf_456')));

    // Les deux transcripts profonds sont découverts, et chacun résout le meta.json de
    // SON PROPRE dossier — pas celui de l'autre dossier de workflow (même nom de fichier,
    // agentType différent : Plan pour wf_123, Debug pour wf_456 dans les fixtures).
    expect(wf123?.metaPath?.endsWith(path.join('wf_123', 'agent-ghi.meta.json'))).toBe(true);
    expect(wf456?.metaPath?.endsWith(path.join('wf_456', 'agent-ghi.meta.json'))).toBe(true);
    // Non croisé : le meta d'un dossier ne doit jamais pointer vers l'autre.
    expect(wf123?.metaPath?.includes('wf_456')).toBe(false);
    expect(wf456?.metaPath?.includes('wf_123')).toBe(false);

    // Les non-transcripts du même dossier restent dehors.
    const paths = withAgents?.subagents.map((a) => a.jsonlPath) ?? [];
    expect(paths.some((p) => p.endsWith('journal.jsonl'))).toBe(false);
    expect(paths.some((p) => p.endsWith('wf_123.json'))).toBe(false);

    // L'ordre est déterministe (la marche en pile ne le garantit pas nativement).
    expect([...paths].sort()).toEqual(paths);
  });

  test('filtre --project par sous-chaîne de slug', async () => {
    const sessions = await discoverSessions(claudeDir, { project: 'other' });
    expect(sessions.map((s) => s.sessionId)).toEqual(['sess-mid']);
  });

  test('filtre --last garde les N plus récentes', async () => {
    const sessions = await discoverSessions(claudeDir, { last: 2 });
    expect(sessions.map((s) => s.sessionId)).toEqual(['sess-new', 'sess-mid']);
  });

  test('filtre --since exclut les sessions plus anciennes', async () => {
    const sessions = await discoverSessions(claudeDir, { since: new Date('2026-07-03T00:00:00Z') });
    expect(sessions.map((s) => s.sessionId)).toEqual(['sess-new', 'sess-mid']);
  });

  test('dossier projects absent → liste vide, pas de throw', async () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'netgain-empty-'));
    try {
      expect(await discoverSessions(empty, {})).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('parseSince', () => {
  const now = new Date('2026-07-09T12:00:00Z');
  test('7d et 30d relatifs à maintenant', () => {
    expect(parseSince('7d', now)).toEqual(new Date('2026-07-02T12:00:00Z'));
    expect(parseSince('30d', now)).toEqual(new Date('2026-06-09T12:00:00Z'));
  });
  test('date ISO acceptée telle quelle', () => {
    expect(parseSince('2026-07-01', now)).toEqual(new Date('2026-07-01T00:00:00.000Z'));
  });
  test('valeur invalide → throw', () => {
    expect(() => parseSince('demain', now)).toThrow();
  });
});
