#!/usr/bin/env node
'use strict';
// Multi-agent hook: read JSON event from stdin, append to a per-session JSONL
// file in os.tmpdir()/agent-events/, and fire-and-forget POST /notify to the
// running agent-viz server (default 127.0.0.1:3333).
//
// Source agent (claude | copilot) is taken from --source=<agent> on argv.
// Sans --source, la source est 'claude' : des settings.json portent encore une
// commande de hook installée sans ce drapeau, et elle doit rester lue.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// node:http par process.getBuiltinModule, pas par `import` : materialiser l'espace de noms ESM
// de node:http se paie a chaque processus de hook, donc a chaque evenement. getBuiltinModule rend
// le meme objet sans ce cout, et reste synchrone (API stable depuis Node 22.3, sous `engines`).
const http = process.getBuiltinModule('node:http');

const DIR = path.join(os.tmpdir(), 'agent-events');
const PORT = parseInt(process.env.AGENT_VIZ_PORT || process.env.PORT || '3333', 10);

// Journal d'erreur du hook. Volontairement PAS stderr : certaines interfaces
// d'agent affichent toute sortie stderr non vide comme une « erreur de hook »
// même quand le processus sort en 0. Un échec d'écriture disque est avalé — on
// ne peut de toute façon rien en faire ici.
function logHookError(message: string): void {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(path.join(DIR, '_hook-errors.log'), `${new Date().toISOString()} ${message}\n`);
  } catch {}
}

function parseSource(argv: string[]): 'claude' | 'copilot' {
  for (const a of argv) {
    if (a.startsWith('--source=')) {
      const v = a.slice('--source='.length);
      if (v === 'claude' || v === 'copilot') return v;
    }
  }
  return 'claude';
}

function runHook(): void {
  try { fs.mkdirSync(DIR, { recursive: true }); } catch {}

  const source = parseSource(process.argv.slice(2));

  // Safety net: if stdin never closes (Windows-common), exit after 3 s — under every hook
  // `timeout` a settings file can carry (10 s, or 5 s from an older install), so the safety
  // fires *before* the agent kills us; otherwise we race and the event gets lost.
  const safety = setTimeout(() => process.exit(0), 3000);

  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { input += c; });
  process.stdin.on('end', () => {
    clearTimeout(safety);
    try {
      // BOM U+FEFF toléré : un writer Windows (.NET UTF8Encoding) préfixe la charge, que JSON.parse
      // rejette ; sans ce retrait, l'événement était perdu en silence. Le BOM est comparé par CODE
      // de caractère : un BOM littéral dans le source serait invisible à la relecture.
      const evt: Record<string, unknown> = JSON.parse(input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input);
      evt._ts = new Date().toISOString();
      evt._source = source;
      const sid = evt.session_id;
      if (typeof sid !== 'string' || !sid) {
        logHookError(`event without session_id (${evt.hook_event_name || '?'}) source=${source}`);
        process.exit(0);
      }
      const file = path.join(DIR, `${sid}.jsonl`);
      fs.appendFileSync(file, JSON.stringify(evt) + '\n');

      const body = JSON.stringify({ session: sid });
      const req = http.request({
        hostname: '127.0.0.1', port: PORT, path: '/notify',
        method: 'POST', timeout: 200,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, () => {});
      req.on('error', () => {});
      req.on('timeout', () => req.destroy());
      req.end(body);
    } catch (err: unknown) {
      // Ce catch etait VIDE, et le journal d'erreur vivait dans le try, apres l'analyse : un
      // JSON.parse en echec ne laissait AUCUNE trace. On sort toujours en 0 — on ne bloque
      // jamais l'agent — mais jamais sans trace.
      const message = err instanceof Error ? err.message : String(err);
      logHookError(`payload rejected: ${message} source=${source}`);
    }
    process.exit(0);
  });
}

export { runHook, parseSource };

if (process.argv[1] === fileURLToPath(import.meta.url)) runHook();
