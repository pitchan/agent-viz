#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const DIR = path.join(os.tmpdir(), 'claude-events');
try { fs.mkdirSync(DIR, { recursive: true }); } catch {}

// Safety net: exit after 5s if stdin never closes (cleared on normal end)
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

    // Fire-and-forget notify to server
    const body = JSON.stringify({ session: sid });
    const req = http.request({
      hostname: '127.0.0.1', port: 3333, path: '/notify',
      method: 'POST', timeout: 200,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, () => {});
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.end(body);
  } catch {}
  process.exit(0);
});
