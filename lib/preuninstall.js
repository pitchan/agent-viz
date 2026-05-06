'use strict';
// Invoked by npm during `npm uninstall agent-viz` via the `preuninstall`
// lifecycle script. Best-effort hook cleanup so the user doesn't end up
// with agent settings pointing at a deleted binary.
//
// Never blocks the uninstall — every error is logged and swallowed.
//
// cwd note: npm runs lifecycle scripts with cwd = the package directory
// itself (e.g. .../node_modules/agent-viz). For local installs that's the
// wrong starting point — findProjectRoot would stop at the package and
// miss the user's actual project. INIT_CWD is npm's record of where the
// user originally invoked the command, which is what we want.

try {
  const { uninstall } = require('./install-hooks');
  const cwd = process.env.INIT_CWD || process.cwd();
  const result = uninstall({ cwd });
  let total = 0;
  for (const [agent, x] of Object.entries(result)) {
    const results = x.results || [];
    const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
    for (const r of results) {
      if (r.removed > 0) {
        console.log(`agent-viz: removed ${r.removed} ${label} hook(s) from ${r.file}`);
        total += r.removed;
      }
    }
  }
  if (total === 0) console.log('agent-viz: no hooks to remove.');
} catch (e) {
  console.error(`agent-viz: hook cleanup skipped (${e.message})`);
}
