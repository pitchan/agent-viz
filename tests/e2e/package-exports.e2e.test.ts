import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import * as core from '../../src/engine/core/index.js';
import * as doctor from '../../src/engine/doctor/index.js';
import { assistantLine, promptLine, writeSessionTree } from '../helpers/build-transcript.js';

describe('barillets publics — le contrat consommé par le produit', () => {
  const claudeDir = mkdtempSync(path.join(tmpdir(), 'netgain-exports-'));
  afterAll(() => rmSync(claudeDir, { recursive: true, force: true }));

  test('le barillet core expose discoverSessions et parseSince', () => {
    expect(typeof core.discoverSessions).toBe('function');
    expect(typeof core.parseSince).toBe('function');
  });

  test('le barillet doctor expose scanSession, netTokens et runDoctor', () => {
    expect(typeof doctor.scanSession).toBe('function');
    expect(typeof doctor.netTokens).toBe('function');
    expect(typeof doctor.runDoctor).toBe('function');
  });

  test('découverte puis scan par les seuls barillets produisent un rapport complet', async () => {
    writeSessionTree(claudeDir, 'F--exports-proj', 'sess-exp', [
      promptLine('bonjour', { timestamp: '2026-07-01T10:00:00.000Z', cwd: 'F:\\exports-proj' }),
      assistantLine({
        msgId: 'm1',
        model: 'claude-opus-4-8',
        usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 500 },
        timestamp: '2026-07-01T10:00:04.000Z',
      }),
    ]);

    const refs = await core.discoverSessions(claudeDir, { project: 'exports-proj' });
    expect(refs).toHaveLength(1);
    const report = await doctor.scanSession(refs[0]!, 100);

    expect(report.sessionId).toBe('sess-exp');
    expect(report.endedAt).toBe('2026-07-01T10:00:04.000Z');
    expect(doctor.netTokens(report.tokens.total)).toBe(620);
  });
});
