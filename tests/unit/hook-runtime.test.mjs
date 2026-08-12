// C1 (audit de qualité de code, docs/audit-qualite-code.md) — le crochet
// `lib/hook.js` n'avait AUCUN test : `runHook` n'est importé que par
// `bin/agent-viz.js`, et les quatre fichiers de test qui citaient `hook.js` s'en
// servaient comme nom de fichier de fixture, jamais comme module.
//
// On l'exerce ici pour de vrai, en le lançant comme le harnais le lance : un
// processus enfant, la charge sur l'entrée standard. `DIR` étant calculé une
// fois pour toutes depuis `os.tmpdir()`, on redirige le dossier temporaire de
// l'enfant par son environnement (TMPDIR côté POSIX, TEMP/TMP côté Windows) —
// aucune modification du code de production n'est nécessaire pour le tester.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../../src/server/hook.js', import.meta.url));
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// Lance le crochet sur une charge donnée, dans un dossier temporaire isolé.
// Le port pointe volontairement vers personne : le POST /notify est en
// « tire et oublie », son échec est déjà avalé par `req.on('error')`.
function lanceLeCrochet(charge) {
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

test('un crochet préfixé d’un BOM est capturé, pas perdu', async () => {
  const evt = { session_id: 'sess-bom-1', hook_event_name: 'PreToolUse', tool_name: 'Read' };
  const r = await lanceLeCrochet(Buffer.concat([BOM, Buffer.from(JSON.stringify(evt))]));
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
  const r = await lanceLeCrochet('{ceci n’est pas du JSON');
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
  const r = await lanceLeCrochet(JSON.stringify(evt));
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
