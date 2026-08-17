'use strict';
// Rule registry — a declarative table (CLAUDE.md § O). Adding a rule is one
// require and one array entry; no existing function is edited.
//
// A rule that throws is dropped with its error surfaced, never allowed to take
// the other six down: a broken rule must degrade the advice, not the product.

import * as r1 from './r1-prefix-change.ts';
import * as r2 from './r2-unused-mcp.ts';
import * as r3 from './r3-large-tool-output.ts';
import * as r4 from './r4-cross-agent-reads.ts';
import * as r5 from './r5-compactions.ts';
import * as r6 from './r6-short-subagents.ts';
import * as r7 from './r7-unverified-tail.ts';
import type { EvaluationContext, Recommendation, Rule } from './types.ts';

const RULES: Rule[] = [r1, r2, r3, r4, r5, r6, r7];

function evaluateAll(ctx: EvaluationContext, rules: Rule[] = RULES): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const rule of rules) {
    try {
      recs.push(...rule.evaluate(ctx));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[rules] ${rule.id} failed: ${message}`);
    }
  }
  return recs;
}

export { RULES, evaluateAll };
