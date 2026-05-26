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
      const evt = JSON.parse(input);
      evt._ts = new Date().toISOString();
      evt._source = source;
      const sid = evt.session_id;
      if (typeof sid !== 'string' || !sid) {
        // Don't write to stderr: some agent UIs surface non-empty stderr as a
        // "hook error" even when the process exits 0. Log to a sibling file
        // instead — the outer try/catch handles any disk write failure.
        fs.appendFileSync(
          path.join(DIR, '_hook-errors.log'),
          `${new Date().toISOString()} event without session_id (${evt.hook_event_name || '?'}) source=${source}\n`,
        );
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
    } catch {}
    process.exit(0);
  });
}

module.exports = { runHook, parseSource };

if (require.main === module) runHook();
