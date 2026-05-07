'use strict';
// Print a short onboarding hint after `npm install`. Silent in CI and when
// npm runs with --silent. npm only runs postinstall after install (never
// after uninstall), so no need to guard for that path.

if (process.env.CI || process.env.npm_config_loglevel === 'silent') {
  process.exit(0);
}

const isGlobal = process.env.npm_config_global === 'true';
const cmd = isGlobal ? 'agent-viz' : 'npx agent-viz';

process.stdout.write([
  '',
  '✓ agent-viz installed.',
  '',
  '  Next steps:',
  `    1. ${cmd} install-hooks    ← configure Claude/Copilot hooks (interactive)`,
  `    2. ${cmd}                  start the dashboard at http://localhost:3333`,
  `    3. ${cmd} --help           list all commands`,
  '',
  '',
].join('\n'));
