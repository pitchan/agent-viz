'use strict';
// Version of the (engine, rules) pair that produced a stored session row.
// Bump it whenever a scan would now yield different facts — a new netgain
// metric, or a rule that must be applied retroactively. Every stored session
// then fails needsScan() and is re-analysed. Deliberate and visible.
// v3 : la table de prix couvre la famille Claude 5 (netgain ≥ 0.12.1) — les
// costUsd stockés en v2 étaient quasi nuls sur ces modèles (« coût partiel »).
// v4 : tarif daté (netgain ≥ 0.12.2) — chaque message est facturé au barème en
// vigueur à SA date (sonnet-5 : lancement 2/10 jusqu'au 31/08, catalogue 3/15
// ensuite) ; les costUsd v3 tarifaient tout au catalogue.
// v5 : zéro voulu (netgain ≥ 0.12.3) — <synthetic> et les modèles locaux sont
// tarifés 0 $ délibérément ; les costComplete stockés en v4 restaient faux
// pour ces sessions (« coût partiel » sur du non-facturable connu).
const SCAN_VERSION = 5;

module.exports = { SCAN_VERSION };
