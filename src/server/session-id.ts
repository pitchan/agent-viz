'use strict';
// The one rule for what a session id may be. Pure and import-free on purpose:
// the hook runs once per event and must not pay for the server's modules.

// A session id becomes a file name (`<id>.jsonl`) under the events dir, so it
// is restricted to safe filename chars: anything else could leave that dir.
function validSessionId(sid: unknown): sid is string {
  return typeof sid === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(sid);
}

export { validSessionId };
