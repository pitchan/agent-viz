'use strict';
// Version of the (engine, rules) pair that produced a stored session row.
// Bump it whenever a scan would now yield different facts — a new netgain
// metric, or a rule that must be applied retroactively. Every stored session
// then fails needsScan() and is re-analysed. Deliberate and visible.
// v3 : la table de prix couvre la famille Claude 5 (netgain ≥ 0.12.1) — les
// costUsd stockés en v2 étaient quasi nuls sur ces modèles (« coût partiel »).
const SCAN_VERSION = 3;

module.exports = { SCAN_VERSION };
