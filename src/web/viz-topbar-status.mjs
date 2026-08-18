// viz-topbar-status.mjs — what the topbar's two health witnesses say, in one place.
//
// Pure module: no DOM. The connection light and the watchdog bell used to be
// two identical green dots — one informational, one a button — with nothing to
// tell them apart. Each now carries its own words, and those words live here,
// where a unit test can pin them; viz-network.js and viz-ui.js only apply them.

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
