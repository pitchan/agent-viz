'use strict';
// Version of the (engine, rules) pair that produced a stored session row.
// Bump it whenever a scan would now yield different facts — a new netgain
// metric, or a rule that must be applied retroactively. Every stored session
// then fails needsScan() and is re-analysed. Deliberate and visible.
const SCAN_VERSION = 1;

module.exports = { SCAN_VERSION };
