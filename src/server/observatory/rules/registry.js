'use strict';
// Rule registry — a declarative table (CLAUDE.md § O). Adding a rule is one
// require and one array entry; no existing function is edited.
//
// A rule that throws is dropped with its error surfaced, never allowed to take
// the other five down: a broken rule must degrade the advice, not the product.

import * as r1 from './r1-prefix-change.js';
import * as r2 from './r2-unused-mcp.js';
import * as r3 from './r3-large-tool-output.js';
import * as r4 from './r4-cross-agent-reads.js';
import * as r5 from './r5-compactions.js';
import * as r6 from './r6-short-subagents.js';

const RULES = [r1, r2, r3, r4, r5, r6];

function evaluateAll(ctx, rules = RULES) {
  const recs = [];
  for (const rule of rules) {
    try {
      recs.push(...rule.evaluate(ctx));
    } catch (err) {
      console.error(`[rules] ${rule.id} failed: ${err.message}`);
    }
  }
  return recs;
}

export { RULES, evaluateAll };
