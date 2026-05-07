'use strict';
// Interactive dialog for `agent-viz install-hooks` (zero flags + TTY).
// Pure dialog: takes detection + projectRoot + io streams, returns
// { target, scope }. No filesystem I/O, no install logic.

function pickTargetDefault(detected) {
  if (detected.claude && detected.copilot) return 2;     // Both
  if (detected.claude) return 0;                          // Claude only
  if (detected.copilot) return 1;                         // Copilot only
  return 2;                                               // nothing detected → default to Both
}

module.exports = { pickTargetDefault };
