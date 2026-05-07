// viz-narrator.js — Live narrator: heuristic + dirty/render driver.
//
// Pure decision module. Given state + vis + now, returns the one-line caption
// to display under the topbar. No DOM, no fetch — render is plugged in via
// setRenderFn() by viz-ui.js. Tests can import composeNarrator/commonPathPrefix
// without triggering any side effect (no setInterval at import time).

// ─── commonPathPrefix ─────────────────────────────────────────────────────
// Returns the common directory prefix of the given paths (e.g. "auth/" for
// ["auth/x.js", "auth/y.js"]). Returns null if fewer than 2 paths or if no
// common directory boundary exists.
export function commonPathPrefix(paths) {
  if (!paths || paths.length < 2) return null;
  const dirSegs = paths.map(p => {
    const segs = String(p).split(/[\\/]/);
    segs.pop(); // drop the filename
    return segs;
  });
  let i = 0;
  outer: while (true) {
    const seg = dirSegs[0][i];
    if (seg === undefined) break;
    for (let k = 1; k < dirSegs.length; k++) {
      if (dirSegs[k][i] !== seg) break outer;
    }
    i++;
  }
  if (i === 0) return null;
  return dirSegs[0].slice(0, i).join('/') + '/';
}
