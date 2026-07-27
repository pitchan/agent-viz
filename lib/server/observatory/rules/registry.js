'use strict';
// Rule registry — a declarative table (CLAUDE.md § O). Adding a rule is one
// require and one array entry; no existing function is edited.
//
// A rule that throws is dropped with its error surfaced, never allowed to take
// the other five down: a broken rule must degrade the advice, not the product.

const r1 = require('./r1-prefix-change');
const r3 = require('./r3-large-tool-output');
const r4 = require('./r4-cross-agent-reads');
const r5 = require('./r5-compactions');

const RULES = [r1, r3, r4, r5];

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

module.exports = { RULES, evaluateAll };
