// `runHook` (src/server/hook.ts) n'est importé que par `bin/agent-viz.js` : ce
// fichier l'exerce comme le harnais le lance, en processus enfant, la charge sur
// l'entrée standard.
//
// `DIR` est calculé une fois depuis `os.tmpdir()`, au chargement du module :
// l'enfant reçoit son dossier temporaire par l'environnement (TMPDIR côté POSIX,
// TEMP/TMP côté Windows), sans modifier le code de production.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../../src/server/hook.ts', import.meta.url));
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// Lance le hook sur une charge donnée, dans un dossier temporaire isolé.
// Le port pointe volontairement vers personne : le POST /notify est en
// « tire et oublie », son échec est déjà avalé par `req.on('error')`.
function lanceLeHook(charge) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-hook-test-'));
  return new Promise((resolve, reject) => {
    const enfant = spawn(process.execPath, [HOOK, '--source=claude'], {
      env: { ...process.env, TMPDIR: racine, TEMP: racine, TMP: racine, AGENT_VIZ_PORT: '59999' },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    enfant.stderr.on('data', c => { stderr += c; });
    enfant.on('error', reject);
    enfant.on('close', code => resolve({
      code,
      stderr,
      racine,
      dossier: path.join(racine, 'agent-events'),
    }));
    enfant.stdin.end(charge);
  });
}

function lit(fichier) {
  try { return fs.readFileSync(fichier, 'utf8'); } catch { return null; }
}

test('un hook préfixé d’un BOM est capturé, pas perdu', async () => {
  const evt = { session_id: 'sess-bom-1', hook_event_name: 'PreToolUse', tool_name: 'Read' };
  const r = await lanceLeHook(Buffer.concat([BOM, Buffer.from(JSON.stringify(evt))]));
  try {
    const ligne = lit(path.join(r.dossier, 'sess-bom-1.jsonl'));
    assert.notEqual(ligne, null, 'aucun .jsonl écrit : l’événement a été perdu');
    const relu = JSON.parse(ligne.trim());
    assert.equal(relu.session_id, 'sess-bom-1');
    assert.equal(relu.hook_event_name, 'PreToolUse');
    assert.equal(relu._source, 'claude');
  } finally {
    fs.rmSync(r.racine, { recursive: true, force: true });
  }
});

test('une charge illisible laisse une trace dans _hook-errors.log', async () => {
  const r = await lanceLeHook('{ceci n’est pas du JSON');
  try {
    const journal = lit(path.join(r.dossier, '_hook-errors.log'));
    assert.notEqual(journal, null, 'aucun journal d’erreur : l’échec est totalement silencieux');
    assert.match(journal, /\S/, 'journal d’erreur vide');
  } finally {
    fs.rmSync(r.racine, { recursive: true, force: true });
  }
});

// Garde-fou de NON-RÉGRESSION, pas un contrôle étalonnant : ce cas passe déjà
// avant le correctif. Il existe pour qu'un retrait de BOM trop gourmand, ou un
// journal d'erreur écrit à tort, se voie immédiatement sur le chemin normal.
test('non-régression : une charge normale, sans BOM, reste capturée et sans erreur journalisée', async () => {
  const evt = { session_id: 'sess-normale-1', hook_event_name: 'PostToolUse', tool_name: 'Edit' };
  const r = await lanceLeHook(JSON.stringify(evt));
  try {
    const ligne = lit(path.join(r.dossier, 'sess-normale-1.jsonl'));
    assert.notEqual(ligne, null, 'le chemin normal a cessé de capturer');
    assert.equal(JSON.parse(ligne.trim()).session_id, 'sess-normale-1');
    assert.equal(lit(path.join(r.dossier, '_hook-errors.log')), null,
      'une charge valide ne doit rien écrire dans le journal d’erreur');
  } finally {
    fs.rmSync(r.racine, { recursive: true, force: true });
  }
});
