// viz-topbar-status.mjs — what the topbar's health witnesses say, in one place.
//
// Pure module: no DOM. The connection light and the watchdog bell used to be
// two identical green dots — one informational, one a button — with nothing to
// tell them apart. Each now carries its own words, and those words live here,
// where a unit test can pin them; viz-network.js and viz-ui.js only apply them.
//
// The errors chip joined them for the same reason, one version later: it read
// "1 errors" — wrong plural, no affordance, no scope — and a user asked, quite
// reasonably, "1 error, but WHERE?".

// The label is the fix for the anonymous dot: a light that says LIVE needs no
// tooltip to be understood, the tooltip only adds the "of what".
export function connectionPresentation(connected) {
  return connected
    ? { label: 'LIVE', title: 'Receiving live events from the agent-viz daemon' }
    : { label: 'OFFLINE', title: 'Lost contact with the daemon — reconnecting automatically' };
}

// The bell is a button in both states, and only the tooltip can say so when
// there is nothing to show — which is precisely when the old green dot read
// as dead weight.
export function watchdogPresentation(activeCount) {
  if (activeCount > 0) {
    const s = activeCount > 1 ? 's' : '';
    return {
      hasAlerts: true,
      countText: String(activeCount),
      title: `${activeCount} active alert${s} — click for details`,
      ariaLabel: `Watchdog: ${activeCount} active alert${s}`,
    };
  }
  return {
    hasAlerts: false,
    countText: null,
    title: 'Watchdog — no active alerts. Click to open the alerts panel.',
    ariaLabel: 'Watchdog: no active alerts',
  };
}

// The errors chip. Unlike the bell it always shows its count, including zero —
// it sits in a row of counters and a blank there would read as "not measured".
// What it owes the reader is the rest: that the number is clickable, and that
// it counts THIS session and nothing else.
//
// It takes the registry's summary, not a bare count, because one number cannot
// say the thing users actually asked about: "1 error" stayed red all session
// for a probe the agent corrected thirty seconds later. Two states now:
// - alarm: an error keeps repeating, or the very last tool call failed —
//   the two mechanical signs that the session needs eyes NOW;
// - calm: errors happened, the session has moved on since.
// The registry states facts; deciding which facts deserve red happens here,
// where a unit test can pin it.
export function errorsPresentation({ total, hasRepeat, lastFailed }) {
  const plural = total === 1 ? 'error' : 'errors';
  const alarm = total > 0 && (hasRepeat || lastFailed);
  // One explanation fits the tooltip; repetition is the more diagnostic sign
  // (an agent looping), so it wins when both are true.
  const why = hasRepeat
    ? 'the same error keeps repeating'
    : 'the last tool call failed';
  return {
    hasErrors: total > 0,
    alarm,
    countText: String(total),
    label: plural,
    title: total === 0
      ? 'No tool errors in this session. Click to open the errors panel.'
      : alarm
        ? `${total} tool ${plural} in this session — ${why}. Click to see which.`
        : `${total} tool ${plural} in this session — the session has moved on since. Click to see which.`,
    ariaLabel: total === 0
      ? 'Errors: none in this session'
      : alarm
        ? `Errors: ${total} in this session — ${why}`
        : `Errors: ${total} in this session — session has moved on`,
  };
}
