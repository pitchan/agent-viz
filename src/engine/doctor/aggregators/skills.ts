import type { NormalizedEvent, ToolUseRef } from '../../core/events.ts';

type SkillListingEvent = Extract<NormalizedEvent, { kind: 'skill_listing' }>;

/** Faits bruts : ce que les listings proposaient, et ce qui a été appelé. L'Observatoire
 *  en déduit « proposé » et « utilisé » ; le moteur n'interprète pas. */
export interface SkillStats {
  /** Noms réunis de tous les listings de la session, triés. */
  listed: string[];
  /** Appels de l'outil Skill par nom, sous-agents compris. */
  calls: Record<string, number>;
}

function skillNameOf(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const skill = (input as Record<string, unknown>)['skill'];
  return typeof skill === 'string' && skill !== '' ? skill : null;
}

/** Une ligne assistant est répétée par bloc de contenu : un appel se dédoublonne par id. */
export class SkillsAggregator {
  private readonly listed = new Set<string>();
  private readonly seen = new Set<string>();
  private readonly calls: Record<string, number> = {};

  addListing(evt: SkillListingEvent): void {
    for (const name of evt.names) this.listed.add(name);
  }

  addToolUse(tu: ToolUseRef): void {
    if (tu.name !== 'Skill' || this.seen.has(tu.id)) return;
    const skill = skillNameOf(tu.input);
    if (skill === null) return;
    this.seen.add(tu.id);
    this.calls[skill] = (this.calls[skill] ?? 0) + 1;
  }

  result(): SkillStats {
    return { listed: [...this.listed].sort(), calls: this.calls };
  }
}
