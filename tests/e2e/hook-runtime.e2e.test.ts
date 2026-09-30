// `runHook` (src/server/hook.ts) n'est importé que par `src/server/cli.ts` : ce
// fichier l'exerce comme le harnais le lance, en processus enfant, la charge sur
// l'entrée standard.
//
// `DIR` est calculé une fois depuis `os.tmpdir()`, au chargement du module :
// l'enfant reçoit son dossier temporaire par l'environnement (TMPDIR côté POSIX,
// TEMP/TMP côté Windows), sans modifier le code de production.

import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../../src/server/hook.ts', import.meta.url));
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

interface ResultatHook {
  code: number | null;
  stderr: string;
  stdout: string;
  racine: string;
  dossier: string;
}

// Lance le hook sur une charge donnée, dans un dossier temporaire isolé.
// Le port pointe volontairement vers personne : le POST /notify est en
// « tire et oublie », son échec est déjà avalé par `req.on('error')`.
function lanceLeHook(charge: string | Buffer, args: string[] = ['--source=claude']): Promise<ResultatHook> {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-hook-test-'));
  return new Promise<ResultatHook>((resolve, reject) => {
    const enfant = spawn(process.execPath, [HOOK, ...args], {
      env: { ...process.env, TMPDIR: racine, TEMP: racine, TMP: racine, AGENT_VIZ_PORT: '59999' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    enfant.stdout.on('data', c => { stdout += c; });
    enfant.stderr.on('data', c => { stderr += c; });
    enfant.on('error', reject);
    enfant.on('close', code => resolve({
      code,
      stderr,
      stdout,
      racine,
      dossier: path.join(racine, 'agent-events'),
    }));
    enfant.stdin.end(charge);
  });
}

function lit(fichier: string): string | null {
  try { return fs.readFileSync(fichier, 'utf8'); } catch { return null; }
}

test('un hook préfixé d’un BOM est capturé, pas perdu', async () => {
  // Arrange
  const evt = { session_id: 'sess-bom-1', hook_event_name: 'PreToolUse', tool_name: 'Read' };
  const charge = Buffer.concat([BOM, Buffer.from(JSON.stringify(evt))]);
  // Act
  const r = await lanceLeHook(charge);
  // Assert
  try {
    const ligne = lit(path.join(r.dossier, 'sess-bom-1.jsonl'));
    expect(ligne, 'aucun .jsonl écrit : l’événement a été perdu').not.toBe(null);
    const relu = JSON.parse(ligne!.trim());
    expect(relu.session_id).toBe('sess-bom-1');
    expect(relu.hook_event_name).toBe('PreToolUse');
    expect(relu._source).toBe('claude');
  } finally {
    fs.rmSync(r.racine, { recursive: true, force: true });
  }
});

test('une charge illisible laisse une trace dans _hook-errors.log', async () => {
  // Arrange
  const charge = '{ceci n’est pas du JSON';
  // Act
  const r = await lanceLeHook(charge);
  // Assert
  try {
    const journal = lit(path.join(r.dossier, '_hook-errors.log'));
    expect(journal, 'aucun journal d’erreur : l’échec est totalement silencieux').not.toBe(null);
    expect(journal, 'journal d’erreur vide').toMatch(/\S/);
  } finally {
    fs.rmSync(r.racine, { recursive: true, force: true });
  }
});

// Garde-fou de NON-RÉGRESSION, pas un contrôle étalonnant : ce cas passe avec ou
// sans la tolérance au BOM. Il existe pour qu'un retrait de BOM trop gourmand, ou un
// journal d'erreur écrit à tort, se voie immédiatement sur le chemin normal.
test('non-régression : une charge normale, sans BOM, reste capturée et sans erreur journalisée', async () => {
  // Arrange
  const evt = { session_id: 'sess-normale-1', hook_event_name: 'PostToolUse', tool_name: 'Edit' };
  const charge = JSON.stringify(evt);
  // Act
  const r = await lanceLeHook(charge);
  // Assert
  try {
    const ligne = lit(path.join(r.dossier, 'sess-normale-1.jsonl'));
    expect(ligne, 'le chemin normal a cessé de capturer').not.toBe(null);
    expect(JSON.parse(ligne!.trim()).session_id).toBe('sess-normale-1');
    expect(lit(path.join(r.dossier, '_hook-errors.log')),
      'une charge valide ne doit rien écrire dans le journal d’erreur').toBe(null);
  } finally {
    fs.rmSync(r.racine, { recursive: true, force: true });
  }
});

test('une charge Antigravity est écrite normalisée, sous le nom de sa conversation', async () => {
  // Arrange
  const charge = { conversationId: 'conv-agy-1', stepIdx: 4, toolCall: { name: 'run_command', args: { CommandLine: 'echo fin' } } };
  // Act
  const r = await lanceLeHook(JSON.stringify(charge), ['--source=antigravity', '--event=PreToolUse']);
  // Assert
  try {
    const ligne = lit(path.join(r.dossier, 'conv-agy-1.jsonl'));
    expect(ligne, 'aucun .jsonl écrit pour la conversation').not.toBe(null);
    const relu = JSON.parse(ligne!.trim());
    expect(relu.hook_event_name).toBe('PreToolUse');
    expect(relu.tool_use_id).toBe('conv-agy-1:4');
    expect(relu._source).toBe('antigravity');
    expect(r.stdout, 'agy lit stdout : le hook doit y rester muet').toBe('');
  } finally {
    fs.rmSync(r.racine, { recursive: true, force: true });
  }
});

test('une charge Antigravity sans --event est refusée, tracée, jamais écrite', async () => {
  // Arrange
  const charge = { conversationId: 'conv-agy-2', stepIdx: 1 };
  // Act
  const r = await lanceLeHook(JSON.stringify(charge), ['--source=antigravity']);
  // Assert
  try {
    expect(lit(path.join(r.dossier, 'conv-agy-2.jsonl')), 'un événement sans nom ne doit pas être écrit').toBe(null);
    expect(lit(path.join(r.dossier, '_hook-errors.log'))).toMatch(/--event/);
    expect(r.code).toBe(0);
    expect(r.stdout, 'agy lit stdout : le hook doit y rester muet').toBe('');
  } finally {
    fs.rmSync(r.racine, { recursive: true, force: true });
  }
});
