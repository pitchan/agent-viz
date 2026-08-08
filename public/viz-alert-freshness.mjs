// viz-alert-freshness.mjs — how recent an alert has to be to still be worth
// interrupting someone for.
//
// This is a DISPLAY rule and it is deliberately not in viz-watchdog.mjs. The
// watchdog's job is to record what happened, with the real time it happened;
// a detector that refused to see the last hour could not feed a journal. The
// badge's job is narrower — say what is wrong NOW — so it, and it alone,
// applies the cut.
//
// Nor is it in viz-alert-format.mjs: that module answers "how is an alert
// worded", this one answers "is it still current". Two questions, two files.

export const FRESHNESS_MS = 2 * 60_000;

export function isFresh(alert, now, freshnessMs = FRESHNESS_MS) {
  return (now - alert.createdAt) <= freshnessMs;
}
