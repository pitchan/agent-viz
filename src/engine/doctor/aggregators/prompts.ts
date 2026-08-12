import type { NormalizedEvent } from '../../core/events.js';

type UserPromptEvent = Extract<NormalizedEvent, { kind: 'user_prompt' }>;

export type PromptCategory = 'where' | 'how-works' | 'impact' | 'dependents' | 'env' | 'routes';

/**
 * Détecteur DÉTERMINISTE (0 appel modèle) des « questions de forme carte » —
 * celles que le futur router nudgera vers map_orient/map_routes.
 * L'ordre compte : le premier qui matche gagne ('where' avant 'routes' pour
 * que « où est définie la route X » soit une question de localisation).
 */
const CLASSIFIERS: { category: PromptCategory; patterns: RegExp[] }[] = [
  // NB : \b est ASCII en regex JS — inutilisable après un caractère accentué (« où »).
  { category: 'where', patterns: [/^\s*où(?=[\s?.!,;:]|$)/i, /\bwhere\s+(is|are|does|do)\b/i] },
  { category: 'how-works', patterns: [/\bcomment\s+(marche|fonctionne)\b/i, /\bhow\s+does\b.{0,80}\bwork/i] },
  { category: 'impact', patterns: [/\bimpact\b/i, /\bblast\s+radius\b/i] },
  {
    category: 'dependents',
    patterns: [/\bqui\s+(dépend|dépendent|appelle|utilise)\b/i, /\bwho\s+(calls|depends|uses)\b/i, /\bwhat\s+depends\s+on\b/i],
  },
  { category: 'env', patterns: [/variables?\s+d[’']environnement/i, /\benv(ironment)?\s+var(iable)?s?\b/i] },
  { category: 'routes', patterns: [/\b(routes?|endpoints?)\b/i] },
];

export function classifyPrompt(text: string): PromptCategory | null {
  for (const { category, patterns } of CLASSIFIERS) {
    if (patterns.some((p) => p.test(text))) return category;
  }
  return null;
}

/** Bruit injecté par le harnais (tags XML, commandes locales) — pas un prompt humain. */
export function isNoisePrompt(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return true;
  return /^<[a-z][a-z0-9_-]*>/i.test(trimmed);
}

export interface PromptsStats {
  totalPrompts: number;
  mapShapedCount: number;
  corpus: { text: string; category: PromptCategory }[];
}

/** Métrique 5 : part des prompts de forme carte + corpus réel pour le futur router. */
export class PromptsAggregator {
  private totalPrompts = 0;
  private mapShapedCount = 0;
  private readonly corpus: PromptsStats['corpus'] = [];

  constructor(private readonly maxPrompts: number) {}

  addPrompt(evt: UserPromptEvent): void {
    if (isNoisePrompt(evt.text)) return;
    this.totalPrompts += 1;
    const category = classifyPrompt(evt.text);
    if (category === null) return;
    this.mapShapedCount += 1;
    if (this.corpus.length < this.maxPrompts) {
      this.corpus.push({ text: evt.text.slice(0, 200), category });
    }
  }

  result(): PromptsStats {
    return { totalPrompts: this.totalPrompts, mapShapedCount: this.mapShapedCount, corpus: this.corpus };
  }
}
