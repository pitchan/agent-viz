import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { discoverSessions } from '../../src/engine/core/discovery.js';
import type { NormalizedEvent, RawUsage, ToolUseRef } from '../../src/engine/core/events.js';
import { netTokens, TokensAggregator } from '../../src/engine/doctor/aggregators/tokens.js';
import { TurnsAggregator } from '../../src/engine/doctor/aggregators/turns.js';
import { runDoctor } from '../../src/engine/doctor/index.js';
import { renderReport } from '../../src/engine/doctor/report/terminal.js';
import { scanSession } from '../../src/engine/doctor/scan-session.js';
import { assistantLine, promptLine, toolUse, writeSessionTree } from '../helpers/build-transcript.js';

type AssistantEvent = Extract<NormalizedEvent, { kind: 'assistant' }>;
type UserPromptEvent = Extract<NormalizedEvent, { kind: 'user_prompt' }>;

function usage(inTk: number, outTk: number, cacheCreate = 0, cacheRead = 0): RawUsage {
  return { input_tokens: inTk, output_tokens: outTk, cache_creation_input_tokens: cacheCreate, cache_read_input_tokens: cacheRead };
}

function assistant(msgId: string | null, u: RawUsage | null, ts?: string): AssistantEvent {
  return {
    kind: 'assistant',
    msgId,
    model: 'claude-sonnet-5',
    usage: u,
    toolUses: [],
    textChars: 0,
    ...(ts !== undefined ? { timestamp: ts } : {}),
    isSidechain: false,
  };
}

function prompt(text: string, ts?: string): UserPromptEvent {
  return { kind: 'user_prompt', text, shape: 'string', ...(ts !== undefined ? { timestamp: ts } : {}) };
}

describe('TurnsAggregator — découpage en tours et classement par le détecteur du router', () => {
  test('question à signal de graphe → tour tiré, tokens du tour dans triggered', () => {
    const agg = new TurnsAggregator();
    agg.addPrompt(prompt("quel est l'impact de modifier x.ts ?", '2026-07-01T10:00:00Z'));
    agg.addAssistant(assistant('m1', usage(100, 50), '2026-07-01T10:00:05Z'), 'main');
    agg.addAssistant(assistant('m2', usage(200, 30, 1000), '2026-07-01T10:00:10Z'), 'main');
    const r = agg.result();
    expect(r.turns).toBe(1);
    expect(r.triggered).toEqual({ turns: 1, netTokens: 100 + 50 + 200 + 30 + 1000 });
    expect(r.silent).toEqual({ turns: 0, netTokens: 0 });
    expect(r.bySignal['impact']).toBe(1);
  });

  test('question sans signal → tour silencieux', () => {
    const agg = new TurnsAggregator();
    agg.addPrompt(prompt("corrige le bug d'affichage", '2026-07-01T10:00:00Z'));
    agg.addAssistant(assistant('m1', usage(80, 20), '2026-07-01T10:00:05Z'), 'main');
    const r = agg.result();
    expect(r.silent).toEqual({ turns: 1, netTokens: 100 });
    expect(r.triggered).toEqual({ turns: 0, netTokens: 0 });
  });

  test('tokens avant la première question (démarrage de session) → non-attribuable, jamais silencieux', () => {
    const agg = new TurnsAggregator();
    agg.addAssistant(assistant('m0', usage(500, 10), '2026-07-01T09:59:00Z'), 'main');
    agg.addPrompt(prompt('bonjour', '2026-07-01T10:00:00Z'));
    agg.addAssistant(assistant('m1', usage(80, 20), '2026-07-01T10:00:05Z'), 'main');
    const r = agg.result();
    expect(r.unattributedNetTokens).toBe(510);
    expect(r.silent.netTokens).toBe(100);
  });

  test('un prompt de bruit du harnais n’ouvre PAS de tour — ses tokens restent au tour courant', () => {
    const agg = new TurnsAggregator();
    agg.addPrompt(prompt('explique ce module', '2026-07-01T10:00:00Z'));
    agg.addAssistant(assistant('m1', usage(80, 20), '2026-07-01T10:00:05Z'), 'main');
    agg.addPrompt(prompt('<local-command-stdout>ok</local-command-stdout>', '2026-07-01T10:00:06Z'));
    agg.addAssistant(assistant('m2', usage(40, 10), '2026-07-01T10:00:08Z'), 'main');
    const r = agg.result();
    expect(r.turns).toBe(1);
    expect(r.silent).toEqual({ turns: 1, netTokens: 150 });
  });

  test('même msgId répété (une ligne par content block) → compté une seule fois', () => {
    const agg = new TurnsAggregator();
    agg.addPrompt(prompt('explique ce module', '2026-07-01T10:00:00Z'));
    agg.addAssistant(assistant('m1', usage(80, 20), '2026-07-01T10:00:05Z'), 'main');
    agg.addAssistant(assistant('m1', usage(80, 20), '2026-07-01T10:00:05Z'), 'main');
    expect(agg.result().silent.netTokens).toBe(100);
  });

  test('sous-agent dont le premier événement tombe dans la fenêtre du tour 2 → facturé au tour 2', () => {
    const agg = new TurnsAggregator();
    agg.addPrompt(prompt('explique ce module', '2026-07-01T10:00:00Z'));
    agg.addAssistant(assistant('m1', usage(80, 20), '2026-07-01T10:00:05Z'), 'main');
    agg.addPrompt(prompt('qui dépend de auth.ts ?', '2026-07-01T10:05:00Z'));
    agg.addAssistant(assistant('m2', usage(100, 30), '2026-07-01T10:05:05Z'), 'main');
    agg.addAssistant(assistant('a1', usage(1000, 200), '2026-07-01T10:05:30Z'), 'agent-x');
    agg.addAssistant(assistant('a2', usage(2000, 100), '2026-07-01T10:06:00Z'), 'agent-x');
    const r = agg.result();
    expect(r.triggered).toEqual({ turns: 1, netTokens: 100 + 30 + 1000 + 200 + 2000 + 100 });
    expect(r.silent).toEqual({ turns: 1, netTokens: 100 });
    expect(r.subagents).toEqual({ attributed: 1, unattributed: 0 });
    expect(r.bySignal['dependents']).toBe(1);
  });

  test('sous-agent sans horodatage → non-attribuable, compté à part', () => {
    const agg = new TurnsAggregator();
    agg.addPrompt(prompt('explique ce module', '2026-07-01T10:00:00Z'));
    agg.addAssistant(assistant('a1', usage(1000, 200)), 'agent-x');
    const r = agg.result();
    expect(r.unattributedNetTokens).toBe(1200);
    expect(r.subagents).toEqual({ attributed: 0, unattributed: 1 });
  });

  test('sous-agent horodaté avant la première question → non-attribuable', () => {
    const agg = new TurnsAggregator();
    agg.addPrompt(prompt('explique ce module', '2026-07-01T10:00:00Z'));
    agg.addAssistant(assistant('a1', usage(1000, 200), '2026-07-01T09:00:00Z'), 'agent-x');
    const r = agg.result();
    expect(r.unattributedNetTokens).toBe(1200);
    expect(r.subagents).toEqual({ attributed: 0, unattributed: 1 });
  });

  test('result() est stable : deux appels rendent les mêmes comptes (pas de double rattachement)', () => {
    const agg = new TurnsAggregator();
    agg.addPrompt(prompt('qui dépend de auth.ts ?', '2026-07-01T10:00:00Z'));
    agg.addAssistant(assistant('m1', usage(100, 30), '2026-07-01T10:00:05Z'), 'main');
    agg.addAssistant(assistant('a1', usage(1000, 200), '2026-07-01T10:00:30Z'), 'agent-x');
    expect(agg.result()).toEqual(agg.result());
  });

  test('invariant de somme : tirés + silencieux + non-attribuable = net TokensAggregator, à l’unité', () => {
    const turns = new TurnsAggregator();
    const tokens = new TokensAggregator();
    const feed = (evt: AssistantEvent, agentKey: string): void => {
      turns.addAssistant(evt, agentKey);
      tokens.addAssistant(evt, agentKey);
    };
    feed(assistant('m0', usage(500, 10, 2000, 300), '2026-07-01T09:59:00Z'), 'main'); // avant 1re question
    turns.addPrompt(prompt("quel est l'impact de modifier x.ts ?", '2026-07-01T10:00:00Z'));
    feed(assistant('m1', usage(100, 50, 700, 40), '2026-07-01T10:00:05Z'), 'main');
    feed(assistant('m1', usage(100, 50, 700, 40), '2026-07-01T10:00:05Z'), 'main'); // doublon msgId
    turns.addPrompt(prompt('corrige le bug', '2026-07-01T10:05:00Z'));
    feed(assistant('m2', usage(60, 20), '2026-07-01T10:05:05Z'), 'main');
    feed(assistant('a1', usage(1000, 200, 500), '2026-07-01T10:05:30Z'), 'agent-x'); // rattaché au tour 2
    feed(assistant('b1', usage(300, 80)), 'agent-y'); // sans horodatage → non-attribuable
    feed(assistant(null, usage(7, 3)), 'main'); // sans msgId : pas de dédup possible, compté tel quel
    const r = turns.result();
    const expected = netTokens(tokens.result().total);
    expect(r.triggered.netTokens + r.silent.netTokens + r.unattributedNetTokens).toBe(expected);
  });
});

/** Le geste canonique du réel : « qui importe GristServer » sur tout le dépôt. */
function gestureUse(id: string): ToolUseRef {
  return { id, name: 'Grep', input: { pattern: `from ['"].*lib/GristServer['"]`, glob: '**/*.ts' } };
}

describe('TurnsAggregator — gestes de graphe de l’agent (comportement-agent)', () => {
  test('geste du main sur un tour sans signal → agentOnly (le tour et ses jetons)', () => {
    const agg = new TurnsAggregator();
    agg.addPrompt(prompt('corrige le bug', '2026-07-01T10:00:00Z'));
    agg.addAssistant(assistant('m1', usage(80, 20), '2026-07-01T10:00:05Z'), 'main');
    agg.registerToolUse(gestureUse('g1'), 'main');
    const r = agg.result();
    expect(r.agentGraph.events).toBe(1);
    expect(r.agentGraph.byKind).toEqual({ grepImport: 1, bashImport: 0, spawnGraphPrompt: 0 });
    expect(r.agentGraph.turnsWithGesture).toBe(1);
    expect(r.agentGraph.agentOnly).toEqual({ turns: 1, netTokens: 100 });
    expect(r.agentGraph.unattributedEvents).toBe(0);
  });

  test('tour à signal prompt + geste → turnsWithGesture, mais PAS agentOnly (rien de neuf : le prompt tirait déjà)', () => {
    const agg = new TurnsAggregator();
    agg.addPrompt(prompt('qui dépend de auth.ts ?', '2026-07-01T10:00:00Z'));
    agg.addAssistant(assistant('m1', usage(80, 20), '2026-07-01T10:00:05Z'), 'main');
    agg.registerToolUse(gestureUse('g1'), 'main');
    const r = agg.result();
    expect(r.agentGraph.turnsWithGesture).toBe(1);
    expect(r.agentGraph.agentOnly).toEqual({ turns: 0, netTokens: 0 });
  });

  test('outil sans geste (Read) → rien ne bouge', () => {
    const agg = new TurnsAggregator();
    agg.addPrompt(prompt('corrige le bug', '2026-07-01T10:00:00Z'));
    agg.registerToolUse({ id: 'r1', name: 'Read', input: { file_path: 'src/imports.ts' } }, 'main');
    const r = agg.result();
    expect(r.agentGraph.events).toBe(0);
    expect(r.agentGraph.turnsWithGesture).toBe(0);
  });

  test('geste d’un sous-agent → tour hôte via son premier événement horodaté, jetons du sous-agent compris', () => {
    const agg = new TurnsAggregator();
    agg.addPrompt(prompt('explique ce module', '2026-07-01T10:00:00Z'));
    agg.addAssistant(assistant('m1', usage(100, 30), '2026-07-01T10:00:05Z'), 'main');
    agg.addAssistant(assistant('a1', usage(1000, 200), '2026-07-01T10:00:30Z'), 'agent-x');
    agg.registerToolUse(gestureUse('g1'), 'agent-x');
    const r = agg.result();
    expect(r.agentGraph.turnsWithGesture).toBe(1);
    expect(r.agentGraph.agentOnly).toEqual({ turns: 1, netTokens: 130 + 1200 });
    expect(r.agentGraph.unattributedEvents).toBe(0);
  });

  test('même id de tool_use répété (une ligne assistant par content block) → un seul événement', () => {
    const agg = new TurnsAggregator();
    agg.addPrompt(prompt('corrige le bug', '2026-07-01T10:00:00Z'));
    agg.registerToolUse(gestureUse('g1'), 'main');
    agg.registerToolUse(gestureUse('g1'), 'main');
    expect(agg.result().agentGraph.events).toBe(1);
  });

  test('geste du main avant la première question → unattributedEvents, aucun tour flaggé', () => {
    const agg = new TurnsAggregator();
    agg.registerToolUse(gestureUse('g0'), 'main');
    agg.addPrompt(prompt('corrige le bug', '2026-07-01T10:00:00Z'));
    const r = agg.result();
    expect(r.agentGraph.events).toBe(1);
    expect(r.agentGraph.unattributedEvents).toBe(1);
    expect(r.agentGraph.turnsWithGesture).toBe(0);
    expect(r.agentGraph.agentOnly).toEqual({ turns: 0, netTokens: 0 });
  });

  test('geste d’un sous-agent sans horodatage → unattributedEvents', () => {
    const agg = new TurnsAggregator();
    agg.addPrompt(prompt('corrige le bug', '2026-07-01T10:00:00Z'));
    agg.addAssistant(assistant('a1', usage(1000, 200)), 'agent-x');
    agg.registerToolUse(gestureUse('g1'), 'agent-x');
    const r = agg.result();
    expect(r.agentGraph.unattributedEvents).toBe(1);
    expect(r.agentGraph.turnsWithGesture).toBe(0);
  });

  test('le geste est un drapeau, jamais une dépense : triggered/silent/non-attribuable identiques avec ou sans gestes', () => {
    const feed = (agg: TurnsAggregator): void => {
      agg.addAssistant(assistant('m0', usage(500, 10), '2026-07-01T09:59:00Z'), 'main');
      agg.addPrompt(prompt("quel est l'impact de modifier x.ts ?", '2026-07-01T10:00:00Z'));
      agg.addAssistant(assistant('m1', usage(100, 50), '2026-07-01T10:00:05Z'), 'main');
      agg.addPrompt(prompt('corrige le bug', '2026-07-01T10:05:00Z'));
      agg.addAssistant(assistant('m2', usage(60, 20), '2026-07-01T10:05:05Z'), 'main');
      agg.addAssistant(assistant('a1', usage(1000, 200), '2026-07-01T10:05:30Z'), 'agent-x');
    };
    const sans = new TurnsAggregator();
    feed(sans);
    const avec = new TurnsAggregator();
    feed(avec);
    avec.registerToolUse(gestureUse('g1'), 'main');
    avec.registerToolUse(gestureUse('g2'), 'agent-x');
    expect(avec.result().triggered).toEqual(sans.result().triggered);
    expect(avec.result().silent).toEqual(sans.result().silent);
    expect(avec.result().unattributedNetTokens).toBe(sans.result().unattributedNetTokens);
    // Invariants du bloc agentGraph : somme des cases = events = attribués + non-attribuables.
    const g = avec.result().agentGraph;
    expect(g.byKind.grepImport + g.byKind.bashImport + g.byKind.spawnGraphPrompt).toBe(g.events);
    expect(g.agentOnly.turns).toBeLessThanOrEqual(avec.result().silent.turns);
    expect(g.agentOnly.netTokens).toBeLessThanOrEqual(avec.result().silent.netTokens);
  });

  test('result() reste stable avec des gestes (deux appels rendent les mêmes comptes)', () => {
    const agg = new TurnsAggregator();
    agg.addPrompt(prompt('corrige le bug', '2026-07-01T10:00:00Z'));
    agg.addAssistant(assistant('m1', usage(100, 30), '2026-07-01T10:00:05Z'), 'main');
    agg.addAssistant(assistant('a1', usage(1000, 200), '2026-07-01T10:00:30Z'), 'agent-x');
    agg.registerToolUse(gestureUse('g1'), 'agent-x');
    expect(agg.result()).toEqual(agg.result());
  });
});

describe('scanSession — branchement du découpage en tours', () => {
  const claudeDir = mkdtempSync(path.join(tmpdir(), 'netgain-turns-'));
  afterAll(() => rmSync(claudeDir, { recursive: true, force: true }));

  test('le rapport de session expose turns, sous-agent facturé à son tour, invariant tenu', async () => {
    writeSessionTree(
      claudeDir,
      'F--turns-proj',
      'sess-t',
      [
        promptLine("quel est l'impact de modifier x.ts ?", { timestamp: '2026-07-01T10:00:00Z', cwd: 'F:\\turns-proj' }),
        assistantLine({
          msgId: 'm1',
          model: 'claude-opus-4-8',
          usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 1000 },
          timestamp: '2026-07-01T10:00:05Z',
        }),
        promptLine('corrige le bug', { timestamp: '2026-07-01T10:05:00Z' }),
        assistantLine({
          msgId: 'm2',
          model: 'claude-opus-4-8',
          usage: { input_tokens: 50, output_tokens: 5 },
          timestamp: '2026-07-01T10:05:05Z',
        }),
      ],
      [
        {
          agentId: 'aaa',
          lines: [
            assistantLine({
              msgId: 'a1',
              model: 'claude-haiku-4-5',
              usage: { input_tokens: 500, output_tokens: 100 },
              timestamp: '2026-07-01T10:01:00Z',
              isSidechain: true,
              agentId: 'aaa',
            }),
          ],
          meta: { agentType: 'Explore' },
        },
      ],
    );
    const refs = await discoverSessions(claudeDir, {});
    const ref = refs[0];
    if (ref === undefined) throw new Error('session non découverte');
    const report = await scanSession(ref, 100);
    expect(report.turns.turns).toBe(2);
    expect(report.turns.triggered).toEqual({ turns: 1, netTokens: 1110 + 600 });
    expect(report.turns.silent).toEqual({ turns: 1, netTokens: 55 });
    expect(report.turns.unattributedNetTokens).toBe(0);
    expect(report.turns.subagents).toEqual({ attributed: 1, unattributed: 0 });
    expect(report.turns.triggered.netTokens + report.turns.silent.netTokens + report.turns.unattributedNetTokens).toBe(
      report.netTokens,
    );
  });
});

describe('scanSession + runDoctor — branchement des gestes de graphe de l’agent', () => {
  const claudeDir = mkdtempSync(path.join(tmpdir(), 'netgain-gestes-'));
  afterAll(() => rmSync(claudeDir, { recursive: true, force: true }));

  test('gestes du main et du sous-agent comptés, totaux projet sommés', async () => {
    writeSessionTree(
      claudeDir,
      'F--gestes-proj',
      'sess-g',
      [
        promptLine('continue le refactor', { timestamp: '2026-07-01T10:00:00Z', cwd: 'F:\gestes-proj' }),
        assistantLine({
          msgId: 'm1',
          model: 'claude-opus-4-8',
          usage: { input_tokens: 100, output_tokens: 10 },
          content: [toolUse('g1', 'Grep', { pattern: `from ['"].*lib/GristServer['"]`, glob: '**/*.ts' })],
          timestamp: '2026-07-01T10:00:05Z',
        }),
        // même message répété (une ligne par content block) : le geste ne compte qu'une fois
        assistantLine({
          msgId: 'm1',
          model: 'claude-opus-4-8',
          usage: { input_tokens: 100, output_tokens: 10 },
          content: [toolUse('g1', 'Grep', { pattern: `from ['"].*lib/GristServer['"]`, glob: '**/*.ts' })],
          timestamp: '2026-07-01T10:00:05Z',
        }),
      ],
      [
        {
          agentId: 'xx',
          lines: [
            assistantLine({
              msgId: 'a1',
              model: 'claude-haiku-4-5',
              usage: { input_tokens: 500, output_tokens: 100 },
              content: [toolUse('g2', 'Bash', { command: `rg "from '@/lib/foo'" src/` })],
              timestamp: '2026-07-01T10:01:00Z',
              isSidechain: true,
              agentId: 'xx',
            }),
          ],
          meta: { agentType: 'Explore' },
        },
      ],
    );
    const report = await runDoctor({ claudeDir });
    const sess = report.projects[0]?.sessions[0];
    expect(sess?.turns.agentGraph.events).toBe(2);
    expect(sess?.turns.agentGraph.byKind).toEqual({ grepImport: 1, bashImport: 1, spawnGraphPrompt: 0 });
    expect(sess?.turns.agentGraph.turnsWithGesture).toBe(1);
    // tour sans signal de graphe au prompt : ses jetons (sous-agent compris) sont l'assiette agentOnly
    expect(sess?.turns.agentGraph.agentOnly).toEqual({ turns: 1, netTokens: 110 + 600 });
    expect(sess?.turns.agentGraph.unattributedEvents).toBe(0);
    // totaux : les 6 champs plats sommés au niveau projet et machine
    const totals = report.projects[0]?.totals;
    expect(totals?.agentGestureEvents).toBe(2);
    expect(totals?.agentGrepGestures).toBe(1);
    expect(totals?.agentBashGestures).toBe(1);
    expect(totals?.agentSpawnGestures).toBe(0);
    expect(totals?.agentOnlyTurns).toBe(1);
    expect(totals?.agentOnlyNetTokens).toBe(710);
    expect(report.totals.agentGestureEvents).toBe(2);
    // branchement du rendu : la section apparaît sous le dépôt, fourchette étiquetée hypothèse
    const text = renderReport(report);
    expect(text).toContain('comportement-agent : recherches d’imports faites à la main ×2');
    expect(text).toContain('dont tours SANS question de graphe : 1 tour(s)');
    expect(text).toContain('étage NON construit, pas une mesure');
  });
});
