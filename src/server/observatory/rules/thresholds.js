'use strict';
// Every rule threshold, in one place, with where its value comes from.
//
// 'spec'        — fixed by doc/12 §7. Changing it means changing the spec.
// 'calibration' — chosen from the real 90-day history by the calibration relevé
//                 of 2026-07-27 (1695 sessions, 14 projects). Changing it means
//                 redoing that measurement. That relevé lives in the private
//                 pilot repository and is not distributed with agent-viz — see
//                 docs/sources-externes.md; what it recorded for each value
//                 below, distribution and one-line reason, is recopied here.
//
// Thresholds are relative wherever possible: an absolute byte or token floor
// does not transfer between an occasional user and one burning tens of
// millions of tokens a month. The two thresholds the spec itself fixes for R2
// are already relative — the rest follows the same shape.
//
// Where the measurement changed the plan's first proposal:
//   R1.minShareOfNet 0.05 → 0.20. At 0.05 the rule fired on 9 projects out of
//   14 (64 %), past the "never more than half" exit criterion; 0.20 brings it
//   back to 7 of 14 while still covering 89 % of the prefix-change tokens
//   (against 93 %). The real discriminant of R1 is the "dominant" gate
//   (1695 sessions → 284), not this floor — it only trims the tail.

const THRESHOLDS = Object.freeze({
  R1: Object.freeze({ minShareOfNet: 0.20 }),
  R2: Object.freeze({ minLoadedShare: 0.5, maxUsedShare: 0.1 }),
  R3: Object.freeze({ minShareOfToolBytes: 0.05, minCount: 5 }),
  R4: Object.freeze({ minShareOfReadBytes: 0.05, minBytes: 100 * 1024 }),
  R5: Object.freeze({ minCompactions: 2 }),
  R6: Object.freeze({ maxDurationMs: 5 * 60 * 1000, minSubagentShare: 0.3 }),
});

const THRESHOLD_ORIGIN = Object.freeze({
  R1: Object.freeze({ minShareOfNet: 'calibration' }),
  R2: Object.freeze({ minLoadedShare: 'spec', maxUsedShare: 'spec' }),
  R3: Object.freeze({ minShareOfToolBytes: 'calibration', minCount: 'calibration' }),
  R4: Object.freeze({ minShareOfReadBytes: 'calibration', minBytes: 'calibration' }),
  R5: Object.freeze({ minCompactions: 'spec' }),
  R6: Object.freeze({ maxDurationMs: 'spec', minSubagentShare: 'spec' }),
});

module.exports = { THRESHOLDS, THRESHOLD_ORIGIN };
