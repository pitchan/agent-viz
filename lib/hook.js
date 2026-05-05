#!/usr/bin/env node
'use strict';
// Claude Code hook: read JSON event from stdin, append to a per-session JSONL
// file in os.tmpdir()/claude-events/, and fire-and-forget POST /notify to the
// running agent-viz server (default 127.0.0.1:3333).

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const DIR = path.join(os.tmpdir(), 'claude-events');
const PORT = parseInt(process.env.AGENT_VIZ_PORT || process.env.PORT || '3333', 10);

function runHook() {
  try { fs.mkdirSync(DIR, { recursive: true }); } catch {}

  // Safety net: if stdin never closes, exit after 5 s so we never wedge a hook.
  const safety = setTimeout(() => process.exit(0), 5000);

  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { input += c; });
  process.stdin.on('end', () => {
    clearTimeout(safety);
    try {
      const evt = JSON.parse(input);
      evt._ts = new Date().toISOString();
      const sid = evt.session_id || 'unknown';
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

module.exports = { runHook };

if (require.main === module) runHook();
