// La durée que scanSession attache à une session, lue de bout en bout sur un
// transcript écrit dans un dossier temporaire.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { discoverSessions } from '../../src/engine/core/discovery.ts';
import { scanSession } from '../../src/engine/doctor/scan-session.ts';
import { assistantLine, promptLine, toolResultLine, toolUse, writeSessionTree } from '../helpers/build-transcript.ts';

const claudeDir = mkdtempSync(path.join(tmpdir(), 'netgain-clock-'));
afterAll(() => rmSync(claudeDir, { recursive: true, force: true }));

test('startedAt = 1er horodatage main, endedAt = dernier, y compris un tool_result final', async () => {
  writeSessionTree(claudeDir, 'F--clock-proj', 'sess-clock', [
    promptLine('lance le test', { timestamp: '2026-07-01T10:00:00.000Z', cwd: 'F:\\clock-proj' }),
    assistantLine({
      msgId: 'm1',
      model: 'claude-opus-4-8',
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [toolUse('t1', 'Bash', { command: 'npm test' })],
      timestamp: '2026-07-01T10:00:05.000Z',
    }),
    toolResultLine('t1', 'ok', { timestamp: '2026-07-01T10:03:30.000Z' }),
  ]);

  const refs = await discoverSessions(claudeDir, { project: 'clock-proj' });
  const ref = refs.find((r) => r.sessionId === 'sess-clock');
  expect(ref).toBeDefined();
  const report = await scanSession(ref!, 100);

  expect(report.startedAt).toBe('2026-07-01T10:00:00.000Z');
  expect(report.endedAt).toBe('2026-07-01T10:03:30.000Z');
});

test('une session sans aucun horodatage expose startedAt et endedAt à null', async () => {
  writeSessionTree(claudeDir, 'F--clock-nots', 'sess-nots', [
    promptLine('sans date'),
    assistantLine({ msgId: 'm1', model: 'claude-opus-4-8', usage: { input_tokens: 10, output_tokens: 5 } }),
  ]);

  const refs = await discoverSessions(claudeDir, { project: 'clock-nots' });
  const report = await scanSession(refs.find((r) => r.sessionId === 'sess-nots')!, 100);

  expect(report.startedAt).toBeNull();
  expect(report.endedAt).toBeNull();
});
