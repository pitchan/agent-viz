import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { SessionClock } from '../../src/doctor/aggregators/clock.js';
import { discoverSessions } from '../../src/core/discovery.js';
import { scanSession } from '../../src/doctor/scan-session.js';
import { assistantLine, promptLine, toolResultLine, toolUse, writeSessionTree } from '../helpers/build-transcript.js';

describe('SessionClock — premier et dernier horodatage', () => {
  test('sans aucun horodatage, first et last valent null', () => {
    const clock = new SessionClock();
    clock.add(undefined);
    expect(clock.first()).toBeNull();
    expect(clock.last()).toBeNull();
  });

  test('un seul horodatage : first et last sont identiques', () => {
    const clock = new SessionClock();
    clock.add('2026-07-01T10:00:00.000Z');
    expect(clock.first()).toBe('2026-07-01T10:00:00.000Z');
    expect(clock.last()).toBe('2026-07-01T10:00:00.000Z');
  });

  test('ordre d’arrivée quelconque : first = le plus ancien, last = le plus récent', () => {
    const clock = new SessionClock();
    clock.add('2026-07-01T10:05:00.000Z');
    clock.add('2026-07-01T10:00:00.000Z');
    clock.add('2026-07-01T10:09:00.000Z');
    expect(clock.first()).toBe('2026-07-01T10:00:00.000Z');
    expect(clock.last()).toBe('2026-07-01T10:09:00.000Z');
  });

  test('un horodatage impossible à parser est ignoré, jamais fatal', () => {
    const clock = new SessionClock();
    clock.add('pas-une-date');
    clock.add('2026-07-01T10:00:00.000Z');
    expect(clock.first()).toBe('2026-07-01T10:00:00.000Z');
    expect(clock.last()).toBe('2026-07-01T10:00:00.000Z');
  });
});

describe('scanSession — la session porte sa durée', () => {
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
});
