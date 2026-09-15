'use strict';
// Take the loopback port, or say in plain words why it cannot be taken.
//
// An occupied port is never freed by force: nothing proves who listens there
// (a stale agent-viz, another program, a neighbour port matched by mistake),
// and the one graceful way out is `agent-viz stop`, which asks over HTTP.
import type { Server } from 'node:http';
import { once } from 'node:events';

type BindOutcome =
  | { bound: true }
  | { bound: false; why: 'port-in-use' };

// Resolves once the server listens on 127.0.0.1:port. Any bind error other
// than "address already in use" is rethrown unchanged.
async function bindPort(server: Server, port: number): Promise<BindOutcome> {
  server.listen(port, '127.0.0.1');
  try {
    await once(server, 'listening');
    return { bound: true };
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'EADDRINUSE') return { bound: false, why: 'port-in-use' };
    throw err;
  }
}

function portInUseMessage(port: number): string {
  return [
    `agent-viz: port ${port} is already in use. Nothing was killed.`,
    `  If an older agent-viz is still running, stop it first:   agent-viz stop`,
    `  To run on another port instead:                           agent-viz start --port <N>`,
    `  To see what listens on port ${port}:`,
    `    Windows       netstat -ano | findstr :${port}`,
    `    macOS/Linux   lsof -iTCP:${port} -sTCP:LISTEN`,
  ].join('\n');
}

export { bindPort, portInUseMessage };
export type { BindOutcome };
