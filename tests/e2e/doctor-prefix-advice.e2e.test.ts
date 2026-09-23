// Le conseil « préfixe modifié » du rendu terminal, sur sa PROPRE fixture : deux tours
// rapprochés dont la perte de cache ne vient ni d’une pause ni d’un compactage.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { embeddedPricing } from '../../src/engine/core/pricing.ts';
import { runDoctor } from '../../src/engine/doctor/index.ts';
import { renderReport } from '../../src/engine/doctor/report/terminal.ts';
import { assistantLine, promptLine, writeSessionTree } from '../helpers/build-transcript.ts';

const adviceDir = mkdtempSync(path.join(tmpdir(), 'netgain-e2e-advice-'));
afterAll(() => rmSync(adviceDir, { recursive: true, force: true }));

test('un churn prefixChange dominant fait apparaître le conseil étiqueté labo', async () => {
  // 2 tours rapprochés, même modèle : perte de cache > tolérance sans pause ni
  // compaction → prefixChange (sans marqueur), seule cause réelle → gate ouvert.
  writeSessionTree(adviceDir, 'F--conseil-proj', 'sess-c1', [
    promptLine('continue le refactor', { timestamp: '2026-07-09T10:00:00.000Z', cwd: 'F:\\conseil-proj' }),
    assistantLine({
      msgId: 'msg_c1',
      model: 'claude-opus-4-8',
      usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 30000, cache_read_input_tokens: 0 },
      timestamp: '2026-07-09T10:00:05.000Z',
    }),
    assistantLine({
      msgId: 'msg_c2',
      model: 'claude-opus-4-8',
      usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 25000, cache_read_input_tokens: 2000 },
      timestamp: '2026-07-09T10:00:30.000Z',
    }),
  ]);
  const text = renderReport(await runDoctor({ claudeDir: adviceDir, pricing: embeddedPricing }));
  expect(text).toContain('préfixe modifié — marqueurs : sans marqueur ×1');
  expect(text).toContain('conseil (mécanismes mesurés en laboratoire, pas déduits de ces journaux)');
  expect(text).toContain('ne pas changer de modèle en cours de session');
  expect(text).toContain('l’enveloppe est rebâtie à la reprise');
});
