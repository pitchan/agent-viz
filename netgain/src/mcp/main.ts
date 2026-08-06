#!/usr/bin/env node
/**
 * netgain-map — serveur MCP stdio (JSON-RPC 2.0, une ligne par message).
 * Usage : netgain-map [racineDuRepo]   (défaut : cwd)
 * Local-only, lecture seule : ne scanne que le repo donné, n'écrit jamais dedans.
 */
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createMapServer, type JsonRpcMessage } from './server.js';

const root = path.resolve(process.argv[2] ?? process.cwd());
const server = createMapServer({ defaultRoot: root });

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  let message: JsonRpcMessage;
  try {
    message = JSON.parse(trimmed) as JsonRpcMessage;
  } catch {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`);
    return;
  }
  void server.handle(message).then((response) => {
    if (response !== null) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
});
