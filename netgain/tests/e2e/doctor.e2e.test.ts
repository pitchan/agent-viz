import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { runDoctor } from '../../src/doctor/index.js';
import { renderReport } from '../../src/doctor/report/terminal.js';
import { assistantLine, compactLine, promptLine, toolResultLine, toolUse, writeSessionTree } from '../helpers/build-transcript.js';

const claudeDir = mkdtempSync(path.join(tmpdir(), 'netgain-e2e-'));
afterAll(() => rmSync(claudeDir, { recursive: true, force: true }));

const msg1 = assistantLine({
  msgId: 'msg_1',
  model: 'claude-opus-4-8',
  usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 20000, cache_read_input_tokens: 0 },
  content: [toolUse('toolu_1', 'Bash', { command: 'npx vitest run' })],
  timestamp: '2026-07-09T09:00:05.000Z',
});

writeSessionTree(
  claudeDir,
  'F--test-proj',
  'sess-1',
  [
    promptLine('Où est définie la route des communes ?', {
      timestamp: '2026-07-09T09:00:00.000Z',
      cwd: 'F:\\test-proj',
      version: '2.1.201',
      gitBranch: 'main',
    }),
    msg1,
    msg1, // Claude Code écrit une ligne par content block : même message dupliqué
    toolResultLine('toolu_1', 'x'.repeat(5000)),
    assistantLine({
      msgId: 'msg_2',
      model: 'claude-opus-4-8',
      usage: { input_tokens: 50, output_tokens: 5, cache_creation_input_tokens: 500, cache_read_input_tokens: 20000 },
      content: [toolUse('toolu_2', 'Agent', { prompt: 'explore le module' })],
    }),
    assistantLine({
      msgId: 'msg_3',
      model: 'claude-futur-9', // modèle inconnu de la table de prix
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    compactLine('auto', 12345),
    '{"type":"queue-operation","operation":"dequeue"}',
    '{oops', // ligne cassée
  ],
  [
    {
      agentId: 'aaa',
      lines: [
        assistantLine({
          msgId: 'msg_a1',
          model: 'claude-haiku-4-5',
          usage: { input_tokens: 10, output_tokens: 2 },
          isSidechain: true,
          agentId: 'aaa',
        }),
      ],
      meta: { agentType: 'Explore' },
    },
  ],
);

describe('runDoctor bout-en-bout sur fixture', () => {
  test('produit le rapport complet attendu', async () => {
    const report = await runDoctor({ claudeDir });

    // scan : les échecs sont VISIBLES, jamais silencieux
    expect(report.scan.sessions).toBe(1);
    expect(report.scan.parseErrors).toBe(1);
    expect(report.scan.otherEventTypes).toEqual({ 'queue-operation': 1 });
    expect(report.scan.unknownModels).toEqual(['claude-futur-9']);
    expect(report.scan.clientVersions).toEqual(['2.1.201']);

    const proj = report.projects[0];
    const sess = proj?.sessions[0];
    expect(proj?.projectSlug).toBe('F--test-proj');
    expect(sess?.cwd).toBe('F:\\test-proj');
    expect(sess?.gitBranch).toBe('main');
    expect(sess?.startedAt).toBe('2026-07-09T09:00:00.000Z');

    // métrique 1 : dédup msg_1, buckets main + agent, coût partie connue
    expect(sess?.tokens.main).toMatchObject({ in: 151, out: 16, cacheCreate: 20500, cacheRead: 20000 });
    expect(sess?.tokens.perAgent['agent-aaa']).toMatchObject({ in: 10, out: 2 });
    expect(sess?.netTokens).toBe(161 + 20500 + 18);
    // opus msg_1 0.12575 + opus msg_2 0.0135 + haiku 0.00002 = 0.13927 ; futur-9 exclu (inconnu)
    expect(sess?.tokens.costUsd).toBeCloseTo(0.13927, 6);
    expect(sess?.tokens.costComplete).toBe(false);

    // métrique 2 : bande 2–30 Ko, recognizer vitest
    expect(sess?.toolResults.bySize.band).toEqual({ count: 1, bytes: 5000 });
    expect(sess?.toolResults.byRecognizer['vitest']).toEqual({ count: 1, bytes: 5000, bandBytes: 5000 });

    // métrique 3 : side-car typé + spawn tool_use (dédupliqué malgré la ligne double)
    expect(sess?.subagents).toEqual({ sidecarCount: 1, spawnToolUses: 1, byType: { Explore: 1 } });

    // métrique 4 : compaction visible, pas de churn (1er tour exempté, msg_2 sous le seuil)
    expect(sess?.context.compactions).toEqual([{ trigger: 'auto', preTokens: 12345 }]);
    expect(sess?.context.cacheChurnEvents).toBe(0);

    // métrique 5 : corpus forme carte
    expect(sess?.prompts.totalPrompts).toBe(1);
    expect(sess?.prompts.mapShapedCount).toBe(1);
    expect(sess?.prompts.corpus).toEqual([{ text: 'Où est définie la route des communes ?', category: 'where' }]);

    // « gain vécu » : 1 tour silencieux (« où » ne tire pas le router), agent sans horodatage non-attribuable
    expect(sess?.turns.turns).toBe(1);
    expect(sess?.turns.triggered).toEqual({ turns: 0, netTokens: 0 });
    expect(sess?.turns.silent).toEqual({ turns: 1, netTokens: 20667 });
    expect(sess?.turns.unattributedNetTokens).toBe(12);
    expect(sess?.turns.subagents).toEqual({ attributed: 0, unattributed: 1 });
    // invariant de somme au niveau session : tirés + silencieux + non-attribuable = net
    expect(sess !== undefined && sess.turns.silent.netTokens + sess.turns.unattributedNetTokens).toBe(sess?.netTokens);
    expect(report.totals.turns).toBe(1);
    expect(report.totals.triggeredNetTokens).toBe(0);

    // totaux
    expect(report.totals.sessions).toBe(1);
    expect(report.totals.costComplete).toBe(false);
    expect(report.totals.costUsd).toBeCloseTo(0.13927, 6);
  });

  test('le rendu terminal expose les faits qui fâchent (parse errors, coût partiel)', async () => {
    const report = await runDoctor({ claudeDir });
    const text = renderReport(report);
    expect(text).toContain('netgain doctor');
    expect(text).toContain('2–30 Ko');
    expect(text).toContain('1 ligne(s) illisible(s)');
    expect(text).toContain('claude-futur-9');
    expect(text).toContain('partiel');
    expect(text).not.toContain('saved'); // jamais de compteur « saved »
    // la projection est étiquetée comme telle, avec ses hypothèses ; ici 0 tour tiré → verdict négatif tel quel
    expect(text).toContain('gain vécu (projection J6, pas une mesure)');
    expect(text).toContain('entre −6,0 % et −1,4 % du net → sur ce profil, ne pas installer');
    expect(text).toContain('hypothèses : −48 % (J6) sur les seuls tours tirés (minorant)');
  });
});

describe('conseil « préfixe modifié » dans le rendu terminal', () => {
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
    const text = renderReport(await runDoctor({ claudeDir: adviceDir }));
    expect(text).toContain('préfixe modifié — marqueurs : sans marqueur ×1');
    expect(text).toContain('conseil (mécanismes prouvés en labo v0.8.0, pas déduits de ces journaux)');
    expect(text).toContain('ne pas changer de modèle en cours de session');
    expect(text).toContain('l’enveloppe est rebâtie à la reprise');
  });
});

describe('CLI bout-en-bout', () => {
  test('netgain doctor --json écrit un rapport JSON valide sur stdout, exit 0', () => {
    const netgainRoot = path.resolve(import.meta.dirname, '..', '..');
    const tsxCli = path.join(netgainRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const out = execFileSync(
      process.execPath,
      [tsxCli, path.join(netgainRoot, 'src', 'cli.ts'), 'doctor', '--json', '--claude-dir', claudeDir],
      { encoding: 'utf8', cwd: netgainRoot },
    );
    const parsed = JSON.parse(out) as { scan: { sessions: number }; totals: { costComplete: boolean } };
    expect(parsed.scan.sessions).toBe(1);
    expect(parsed.totals.costComplete).toBe(false);
  });
});
