// viz-budget-format.ts — what the TOTAL pill of the topbar says, in one place.
//
// Pure module: no DOM. TOTAL speaks for the whole session, subagents included: the
// sum of each conversation's current size (cache included) and the cost.
// viz-ui.ts only applies these strings.

import {
  formatTokens, tokenContext, modelLabel,
  formatCostBound, costCompleteness, costReasons,
  type TokenBucket,
} from './viz-state.ts';

export interface BudgetTokens {
  main: TokenBucket | null;
  perAgent: Map<string, TokenBucket>;
  tokensSupported: boolean | null;
  transcriptMissing: boolean;
}

export type BudgetPresentation =
  | { kind: 'hidden' }
  | { kind: 'unavailable'; text: string; title: string }
  | { kind: 'measured'; tokens: string; cost: string; title: string };

type Completeness = ReturnType<typeof costCompleteness>;

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

function conversationLine(nom: string, b: TokenBucket) {
  const modele = modelLabel(b.lastModel);
  return `  ${nom}${modele ? ` (${modele})` : ''} : ${tokenContext(b).toLocaleString()}`;
}

// Jetons = somme des tailles de conversation, pas un cumul sur les appels : chaque
// appel relit toute sa conversation, un cumul compterait la même conversation N fois.
// Chaque agent a la sienne, elles s'additionnent donc sans doublon.
// Chaque seau porte son coût calculé au tarif de SON modèle côté serveur : une
// session multi-modèle s'additionne donc sans conversion.
function totalPill(main: TokenBucket, perAgent: Map<string, TokenBucket>) {
  const seaux = [main, ...perAgent.values()];
  let usd = 0, taille = 0;
  for (const b of seaux) {
    usd += b.costUsd || 0;
    taille += tokenContext(b);
  }
  const cout = costCompleteness(seaux);
  const n = perAgent.size;
  return {
    kind: 'measured' as const,
    tokens: formatTokens(taille),
    cost: formatCostBound(usd, cout.complete),
    title: [
      `Session entière : fil principal${n === 0 ? ', aucun sous-agent' : ` + ${n} sous-agent${n > 1 ? 's' : ''}`}`,
      `Jetons (taille des conversations, cache compris) : ${taille.toLocaleString()}`,
      conversationLine('fil principal', main),
      ...[...perAgent.values()].map(b => conversationLine('sous-agent', b)),
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
  // table : le modèle et les jetons d'une telle session sont connus.
  if (!main || !main.lastModel) return { kind: 'hidden' };
  return totalPill(main, tokens.perAgent);
}
