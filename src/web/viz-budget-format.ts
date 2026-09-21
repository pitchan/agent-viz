// viz-budget-format.ts — what the two budget pills of the topbar say, in one place.
//
// Pure module: no DOM. The first pill speaks for the main thread alone (model, current
// context, cost); TOTAL speaks for the whole session, subagents included (net tokens,
// cost). viz-ui.ts only applies these strings.

import {
  formatTokens, netTokens, tokenContext, modelLabel,
  formatCostBound, costCompleteness, costReasons,
  type TokenBucket,
} from './viz-state.ts';
import { countOrZero } from '../engine/core/usage.ts';

export interface BudgetTokens {
  main: TokenBucket | null;
  perAgent: Map<string, TokenBucket>;
  tokensSupported: boolean | null;
  transcriptMissing: boolean;
}

export type CtxLevel = 'ok' | 'warn' | 'crit';

export type BudgetPresentation =
  | { kind: 'hidden' }
  | { kind: 'unavailable'; text: string; title: string }
  | {
    kind: 'measured';
    main: { model: string; ctx: string; ctxLevel: CtxLevel; cost: string; title: string };
    total: { tokens: string; cost: string; title: string };
  };

type Completeness = ReturnType<typeof costCompleteness>;

// Les lignes de réserve d'un coût partiel, les mêmes pour les deux pastilles :
// chacune les tire de SA propre complétude.
function reserveLines(usd: number, cout: Completeness): string[] {
  if (cout.complete) return [];
  return [
    `${usd > 0 ? 'Coût PARTIEL' : 'Aucun message tarifé'} — ${costReasons(cout).join(' · ')}`,
    // Un `usage` inexploitable touche aussi les jetons : « les jetons sont comptés »
    // ne serait plus sûr dès qu'il y en a un.
    cout.malformedUsageMessages > 0
      ? 'Les jetons et le coût réels peuvent être plus élevés.'
      : usd > 0
        ? 'Le coût réel est supérieur.'
        : 'Les jetons sont comptés ; le coût n’est pas calculable.',
  ];
}

function ctxLevelOf(fenetreConnue: boolean, ratio: number): CtxLevel {
  if (!fenetreConnue || ratio < 0.7) return 'ok';
  return ratio < 0.9 ? 'warn' : 'crit';
}

function mainPill(main: TokenBucket & { lastModel: string }) {
  const ctxNow = tokenContext(main);
  // `contextMax` manque quand le serveur ne connait pas la fenetre du modele.
  const fenetreConnue = main.contextMax !== undefined && main.contextMax > 0;
  const ratio = fenetreConnue ? ctxNow / main.contextMax! : 0;
  const usd = main.costUsd || 0;
  const cout = costCompleteness([main]);
  return {
    model: modelLabel(main.lastModel),
    // Sans fenêtre connue, la taille absolue et RIEN d'autre : un pourcentage
    // calculé contre une fenêtre inventée serait pire que pas de pourcentage.
    ctx: fenetreConnue
      ? `${formatTokens(ctxNow)} / ${formatTokens(main.contextMax)} (${(ratio * 100).toFixed(1)}%)`
      : formatTokens(ctxNow),
    ctxLevel: ctxLevelOf(fenetreConnue, ratio),
    cost: formatCostBound(usd, cout.complete),
    title: [
      `Model: ${main.lastModel}`,
      fenetreConnue
        ? `Context: ${ctxNow.toLocaleString()} / ${main.contextMax!.toLocaleString()} tokens`
        : `Context: ${ctxNow.toLocaleString()} tokens (fenêtre inconnue pour ce modèle)`,
      `Cost (main thread only): ${formatCostBound(usd, cout.complete)}`,
      ...reserveLines(usd, cout),
    ].join('\n'),
  };
}

// Chaque seau porte son coût calculé au tarif de SON modèle côté serveur : une
// session multi-modèle s'additionne donc sans conversion.
function totalPill(main: TokenBucket, perAgent: Map<string, TokenBucket>) {
  const seaux = [main, ...perAgent.values()];
  let usd = 0, nets = 0, relus = 0;
  for (const b of seaux) {
    usd += b.costUsd || 0;
    nets += netTokens(b);
    relus += countOrZero(b.cacheRead);
  }
  const cout = costCompleteness(seaux);
  const n = perAgent.size;
  return {
    // « nets » seul : chaque pixel gagné revient à l'invite du bandeau ; l'infobulle dit la phrase entière.
    tokens: `${formatTokens(nets)} nets`,
    cost: formatCostBound(usd, cout.complete),
    title: [
      `Session entière : fil principal${n === 0 ? ', aucun sous-agent' : ` + ${n} sous-agent${n > 1 ? 's' : ''}`}`,
      `Jetons nets : ${nets.toLocaleString()} (entrée + écriture cache + sortie)`,
      `Relus depuis le cache : ${relus.toLocaleString()} (jamais additionnés aux nets)`,
      `Coût : ${formatCostBound(usd, cout.complete)}`,
      ...reserveLines(usd, cout),
    ].join('\n'),
  };
}

export function budgetPresentation(tokens: BudgetTokens): BudgetPresentation {
  if (tokens.tokensSupported === false) {
    return { kind: 'unavailable', text: 'Tokens N/A', title: 'Token usage is not exposed by this provider (e.g. Copilot Chat).' };
  }
  // Suivi des jetons actif (Claude), mais le transcript n'est pas encore sur le
  // disque : le dire plutôt que laisser la pastille vide.
  if (tokens.transcriptMissing) {
    return { kind: 'unavailable', text: 'Transcript N/A', title: 'Transcript file not located yet — token tracking starts as soon as it appears on disk.' };
  }
  const main = tokens.main;
  // Rien avant le premier message du modèle : une pastille qui clignote vide est pire
  // qu'une pastille qui n'apparaît qu'à ce moment-là.
  // La condition porte sur `lastModel`, que le serveur pose aussi pour un modèle hors
  // table, et non sur `contextMax` : le modèle et les jetons d'une telle session sont
  // connus, seule la FENÊTRE manque.
  if (!main || !main.lastModel) return { kind: 'hidden' };
  return {
    kind: 'measured',
    main: mainPill({ ...main, lastModel: main.lastModel }),
    total: totalPill(main, tokens.perAgent),
  };
}
