#!/usr/bin/env node
'use strict';
// Multi-agent hook: read JSON event from stdin, append to a per-session JSONL
// file in os.tmpdir()/agent-events/, and fire-and-forget POST /notify to the
// running agent-viz server (default 127.0.0.1:3333).
//
// Source agent taken from --source=<agent> on argv; sans --source, 'claude' : des
// settings.json portent encore une commande installée sans ce drapeau. Une source dont la
// charge ne nomme pas l'événement (Antigravity) reçoit aussi --event=<nom>.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { HOOK_SOURCES, NORMALIZERS, NEEDS_EVENT_FLAG, type HookSource } from './hook-normalize.ts';
import { lateFailures } from './hook-antigravity-verdicts.ts';
import { sessionStart } from './hook-antigravity-session-start.ts';
import { validSessionId } from './session-id.ts';

// node:http arrive par process.getBuiltinModule, pas par `import` : matérialiser son espace de
// noms ESM se paie à chaque processus de hook, donc à chaque événement. getBuiltinModule rend le
// même objet sans ce coût, reste synchrone, et date de Node 22.3, là où `engines` exige Node 24.
const http = process.getBuiltinModule('node:http');

const DIR = path.join(os.tmpdir(), 'agent-events');
const PORT = parseInt(process.env.AGENT_VIZ_PORT || process.env.PORT || '3333', 10);

// Journal d'erreur du hook. Volontairement PAS stderr : certaines interfaces
// d'agent affichent toute sortie stderr non vide comme une « erreur de hook »
// même quand le processus sort en 0. Un échec d'écriture disque est avalé — on
// ne peut de toute façon rien en faire ici.
function logHookError(message: string): void {
  try {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    fs.appendFileSync(path.join(DIR, '_hook-errors.log'), `${new Date().toISOString()} ${message}\n`);
  } catch {}
}

type Payload = Record<string, unknown>;

function readText(file: string): string {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

// Un événement d'agent qui n'est pas écrit tel quel : il est remplacé par ceux qu'on en déduit.
// `null` quand l'événement suit le chemin ordinaire.
type Replacer = (raw: Payload, event: string | undefined) => Payload[] | null;

function antigravityPostInvocation(raw: Payload, event: string | undefined): Payload[] | null {
  if (event !== 'PostInvocation') return null;
  const { conversationId, transcriptPath } = raw;
  if (!validSessionId(conversationId) || typeof transcriptPath !== 'string') return [];
  const events = readText(path.join(DIR, `${conversationId}.jsonl`));
  const transcript = readText(transcriptPath);
  return [
    ...sessionStart(NORMALIZERS.antigravity(raw, event), events, transcript),
    ...lateFailures(events, transcript),
  ];
}

const REPLACERS: Record<HookSource, Replacer | null> = {
  claude: null,
  copilot: null,
  antigravity: antigravityPostInvocation,
  codex: null,
};

function parseSource(argv: string[]): HookSource {
  for (const a of argv) {
    if (a.startsWith('--source=')) {
      const v = a.slice('--source='.length);
      const known = HOOK_SOURCES.find(s => s === v);
      if (known) return known;
    }
  }
  return 'claude';
}

function parseEvent(argv: string[]): string | undefined {
  const a = argv.find(x => x.startsWith('--event='));
  return a ? a.slice('--event='.length) : undefined;
}

function runHook(): void {
  try { fs.mkdirSync(DIR, { recursive: true, mode: 0o700 }); } catch {}

  const source = parseSource(process.argv.slice(2));
  const event = parseEvent(process.argv.slice(2));

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
      const raw: Record<string, unknown> = JSON.parse(input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input);
      if (NEEDS_EVENT_FLAG[source] && !event) {
        logHookError(`--event missing, event dropped source=${source}`);
        process.exit(0);
      }
      const events = REPLACERS[source]?.(raw, event) ?? [NORMALIZERS[source](raw, event)];
      // Rien à écrire : le serveur n'est pas réveillé pour un fichier qui n'a pas bougé.
      const first = events[0];
      if (!first) process.exit(0);
      const sid = first.session_id;
      if (typeof sid !== 'string' || !sid) {
        logHookError(`event without session_id (${first.hook_event_name || '?'}) source=${source}`);
        process.exit(0);
      }
      // Le serveur ne lit que ces noms-là : tout autre session_id écrirait un
      // fichier que personne ne relit, ou hors du dossier d'événements.
      if (!validSessionId(sid)) {
        logHookError(`session_id refused, not a safe file name (${first.hook_event_name || '?'}) source=${source}`);
        process.exit(0);
      }
      const ts = new Date().toISOString();
      const lines = events.map(evt => JSON.stringify({ ...evt, _ts: ts, _source: source }) + '\n');
      fs.appendFileSync(path.join(DIR, `${sid}.jsonl`), lines.join(''));

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

export { runHook, parseSource, parseEvent };

if (process.argv[1] === fileURLToPath(import.meta.url)) runHook();
