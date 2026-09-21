'use strict';
// Version of the (engine, rules) pair that produced a stored session row. Bump
// it whenever a scan would now yield different facts (new report field, rule
// applied retroactively): every stored row then fails needsScan() and is re-read.
//
// The bump is the only lever: needsScan() compares path, mtime, size and this
// number — sub-agent files appear without moving the main transcript's mtime —
// so a row whose file still looks the same is re-read only when this number moves.
const SCAN_VERSION = 11;

export { SCAN_VERSION };
