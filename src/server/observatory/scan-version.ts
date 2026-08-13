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
// v6 : coût par modèle (netgain ≥ 0.13.0) — les rapports v5 ne portaient que le
// coût total de session ; la ventilation du panneau « Jetons & tarifs » exige le
// champ costByModel, absent des rapports déjà stockés.
// v7 : sous-agents de workflow (agent-viz ≥ 0.10.0) — la découverte ignorait
// subagents/workflows/wf_*/, soit 3,4 % des jetons nets et 173 sous-agents
// absents des rapports déjà stockés. Le mtime du transcript principal ne bouge
// pas quand ces fichiers apparaissent : sans ce bump, needsScan sauterait
// éternellement les sessions déjà en base et le correctif serait sans effet.
const SCAN_VERSION = 7;

export { SCAN_VERSION };
