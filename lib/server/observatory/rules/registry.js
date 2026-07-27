'use strict';
// Rule registry — a declarative table (CLAUDE.md § O). Adding a rule is one
// require and one array entry; no existing function is edited.
//
// A rule that throws is dropped with its error surfaced, never allowed to take
// the other five down: a broken rule must degrade the advice, not the product.

const r1 = require('./r1-prefix-change');

const RULES = [r1];

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
