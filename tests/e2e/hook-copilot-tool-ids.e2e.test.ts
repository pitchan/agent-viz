// Copilot CLI n'envoie aucun identifiant d'appel : la page relie la fin d'un outil à son début
// par `tool_use_id`. Le vrai hook, lancé en processus enfant sur des charges au format de la
// référence des hooks de Copilot CLI, doit poser le même identifiant au début et à la fin.
// Charges documentées, non relevées sur une vraie session : identifiants et chemins neutres.

import { afterEach, beforeEach, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { state, vis } from '../../src/web/viz-state.ts';
import { processEvent, type HookEvent } from '../../src/web/viz-graph.ts';
import { resetErrors } from '../../src/web/viz-errors.ts';

const HOOK = fileURLToPath(new URL('../../src/server/hook.ts', import.meta.url));
const SESSION_A = 'cccc0000-0000-0000-0000-000000000042';
const SESSION_B = 'cccc0000-0000-0000-0000-000000000043';

type Charge = Record<string, unknown>;

const racines: string[] = [];

function racineIsolee(): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-copilot-ids-'));
  racines.push(r);
  return r;
}

beforeEach(() => {
  state.nodes.clear();
  state.timelineEntries.length = 0;
  state.toolsCompleted = 0;
  state.toolsFailed = 0;
  state.toolOutcomes.clear();
  vis.nodes.clear();
  vis.runningNodes.clear();
  resetErrors();
});

afterEach(() => {
  for (const r of racines.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

// Forme « compatible VS Code » de la référence, celle qu'envoie le fichier de hooks de l'installeur.
function charge(evenement: string, outil: string, args: Charge, session = SESSION_A, extra: Charge = {}): Charge {
  return {
    hook_event_name: evenement,
    session_id: session,
    timestamp: '2026-10-30T10:00:00.000Z',
    cwd: '/projet',
    tool_name: outil,
    tool_input: args,
    ...extra,
  };
}

// Le port pointe vers personne : le POST /notify est en « tire et oublie ».
function lanceLeHook(racine: string, evt: Charge): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const enfant = spawn(process.execPath, [HOOK, '--source=copilot'], {
      env: { ...process.env, TMPDIR: racine, TEMP: racine, TMP: racine, AGENT_VIZ_PORT: '59999' },
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    enfant.on('error', reject);
    enfant.on('close', () => resolve());
    enfant.stdin.end(JSON.stringify(evt));
  });
}

async function enchaine(racine: string, evts: Charge[]): Promise<void> {
  for (const evt of evts) await lanceLeHook(racine, evt);
}

function ecrits(racine: string, session = SESSION_A): Charge[] {
  const texte = fs.readFileSync(path.join(racine, 'agent-events', `${session}.jsonl`), 'utf8');
  return texte.split('\n').filter(Boolean).map(l => JSON.parse(l) as Charge);
}

const VIEW = { path: '/projet/README.md' };
const BASH = { command: 'npm test' };

test('la fin réussie d’un outil Copilot porte l’identifiant de son début', async () => {
  // Arrange
  const racine = racineIsolee();
  await lanceLeHook(racine, charge('PreToolUse', 'view', VIEW));
  // Act
  await lanceLeHook(racine, charge('PostToolUse', 'view', VIEW, SESSION_A, { tool_response: 'ok' }));
  // Assert
  const [debut, fin] = ecrits(racine);
  expect(typeof debut?.tool_use_id).toBe('string');
  expect(fin?.tool_use_id).toBe(debut?.tool_use_id);
});

test('l’échec d’un outil Copilot porte l’identifiant de son début', async () => {
  // Arrange
  const racine = racineIsolee();
  await lanceLeHook(racine, charge('PreToolUse', 'bash', BASH));
  // Act
  await lanceLeHook(racine, charge('PostToolUseFailure', 'bash', BASH, SESSION_A, { error: 'Exit code 1' }));
  // Assert
  const [debut, fin] = ecrits(racine);
  expect(typeof debut?.tool_use_id).toBe('string');
  expect(fin?.tool_use_id).toBe(debut?.tool_use_id);
});

test('deux appels identiques successifs reçoivent deux identifiants, chacun repris par sa fin', async () => {
  // Arrange
  const racine = racineIsolee();
  await enchaine(racine, [
    charge('PreToolUse', 'view', VIEW),
    charge('PostToolUse', 'view', VIEW),
    charge('PreToolUse', 'view', VIEW),
  ]);
  // Act
  await lanceLeHook(racine, charge('PostToolUse', 'view', VIEW));
  // Assert
  const ids = ecrits(racine).map(e => e.tool_use_id);
  expect(typeof ids[0]).toBe('string');
  expect(ids[2]).not.toBe(ids[0]);
  expect(ids).toEqual([ids[0], ids[0], ids[2], ids[2]]);
});

test('un début resté sans fin ne capte pas la fin de l’outil suivant', async () => {
  // Arrange
  const racine = racineIsolee();
  await enchaine(racine, [
    charge('PreToolUse', 'view', VIEW),
    charge('PreToolUse', 'bash', BASH),
  ]);
  // Act
  await lanceLeHook(racine, charge('PostToolUse', 'bash', BASH));
  // Assert
  const [view, bash, fin] = ecrits(racine);
  expect(bash?.tool_use_id).not.toBe(view?.tool_use_id);
  expect(fin?.tool_use_id).toBe(bash?.tool_use_id);
});

test('deux sessions Copilot ne mélangent ni leurs identifiants ni leurs fins', async () => {
  // Arrange
  const racine = racineIsolee();
  await enchaine(racine, [
    charge('PreToolUse', 'view', VIEW, SESSION_A),
    charge('PreToolUse', 'view', VIEW, SESSION_B),
  ]);
  // Act
  await lanceLeHook(racine, charge('PostToolUse', 'view', VIEW, SESSION_B));
  // Assert
  const [debutA] = ecrits(racine, SESSION_A);
  const [debutB, finB] = ecrits(racine, SESSION_B);
  expect(debutB?.tool_use_id).not.toBe(debutA?.tool_use_id);
  expect(finB?.tool_use_id).toBe(debutB?.tool_use_id);
});

test('lus par la page, l’outil réussi est terminé, l’outil en échec est rouge, plus rien ne tourne', async () => {
  // Arrange
  const racine = racineIsolee();
  await enchaine(racine, [
    charge('PreToolUse', 'view', VIEW),
    charge('PostToolUse', 'view', VIEW),
    charge('PreToolUse', 'bash', BASH),
    charge('PostToolUseFailure', 'bash', BASH, SESSION_A, { error: 'Exit code 1' }),
  ]);
  const evts = ecrits(racine) as unknown as HookEvent[];
  // Act
  for (const evt of evts) processEvent(evt);
  // Assert
  const outils = [...state.nodes.values()].filter(n => n.type === 'tool').map(n => `${n.label}:${n.status}`);
  expect(outils).toEqual(['view:done', 'bash:error']);
  expect(vis.runningNodes.size).toBe(0);
});
