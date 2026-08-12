#!/usr/bin/env node
'use strict';
// Multi-agent hook: read JSON event from stdin, append to a per-session JSONL
// file in os.tmpdir()/agent-events/, and fire-and-forget POST /notify to the
// running agent-viz server (default 127.0.0.1:3333).
//
// Source agent (claude | copilot) is taken from --source=<agent> on argv.
// Defaults to 'claude' for back-compat with old hook commands installed by
// agent-viz < 0.2.0 that didn't carry the flag.

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const DIR = path.join(os.tmpdir(), 'agent-events');
const PORT = parseInt(process.env.AGENT_VIZ_PORT || process.env.PORT || '3333', 10);

// Journal d'erreur du crochet. Volontairement PAS stderr : certaines interfaces
// d'agent affichent toute sortie stderr non vide comme une « erreur de hook »
// même quand le processus sort en 0. Un échec d'écriture disque est avalé — on
// ne peut de toute façon rien en faire ici.
function logHookError(message) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(path.join(DIR, '_hook-errors.log'), `${new Date().toISOString()} ${message}\n`);
  } catch {}
}

function parseSource(argv) {
  for (const a of argv) {
    if (a.startsWith('--source=')) {
      const v = a.slice('--source='.length);
      if (v === 'claude' || v === 'copilot') return v;
    }
  }
  return 'claude';
}

function runHook() {
  try { fs.mkdirSync(DIR, { recursive: true }); } catch {}

  const source = parseSource(process.argv.slice(2));

  // Safety net: if stdin never closes (Windows-common), exit after 3 s. Stays
  // well under the hook's `timeout` setting on every install we've shipped
  // (historic 5 s, current 10 s) so the safety fires *before* the agent kills
  // us — otherwise we race and the event gets lost.
  const safety = setTimeout(() => process.exit(0), 3000);

  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { input += c; });
  process.stdin.on('end', () => {
    clearTimeout(safety);
    try {
      // BOM U+FEFF toléré : un writer Windows (.NET UTF8Encoding) préfixe la
      // charge, JSON.parse le rejette. Sans ce retrait, l'événement était perdu
      // en silence total — même leçon que netgain/src/router/hook.ts:12-14, qui
      // l'avait apprise de son côté sans que ce fichier en profite (constat C1
      // de docs/audit-qualite-code.md). Le BOM est compare par CODE de
      // caractere, jamais par un motif contenant le caractere lui-meme : un
      // BOM litteral dans le source serait invisible a la relecture.
      const evt = JSON.parse(input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input);
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
    } catch (err) {
      // Ce catch etait VIDE, et le journal d'erreur vivait lui-meme dans le
      // try, apres l'analyse : un echec de JSON.parse ne laissait donc AUCUNE
      // trace, nulle part. Perte de capture totale et silencieuse dans un
      // produit dont la capture est la raison d'etre (constat C1). On sort
      // toujours en 0 — on ne bloque jamais l'agent — mais plus jamais muet.
      logHookError(`payload rejected: ${(err && err.message) || err} source=${source}`);
    }
    process.exit(0);
  });
}

module.exports = { runHook, parseSource };

if (require.main === module) runHook();
