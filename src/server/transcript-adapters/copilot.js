'use strict';
// Copilot does not expose per-message token usage in its transcript JSONL
// or CLI hook payloads. Treated as unsupported — UI shows "Tokens N/A"
// rather than a silently-zero gauge.

function discoverPath() { return null; }
function parseUsageLine() { return false; }

module.exports = {
  tokensSupported: false,
  discoverPath,
  parseUsageLine,
};
