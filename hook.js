#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

setTimeout(() => process.exit(0), 1500);

const DIR = path.join(os.tmpdir(), 'claude-events');
try { fs.mkdirSync(DIR, { recursive: true }); } catch {}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  try {
    const evt = JSON.parse(input);
    evt._ts = new Date().toISOString();
    const sid = evt.session_id || 'unknown';
    const file = path.join(DIR, `${sid}.jsonl`);
    fs.appendFileSync(file, JSON.stringify(evt) + '\n');
  } catch {}
  process.exit(0);
});
