import type { NormalizedEvent, ToolUseRef } from '../../core/events.ts';

type SkillListingEvent = Extract<NormalizedEvent, { kind: 'skill_listing' }>;
type AssistantEvent = Extract<NormalizedEvent, { kind: 'assistant' }>;

/** Faits bruts : ce que les listings proposaient, ce qui a été appelé, et ce que Claude Code
 *  a marqué. L'Observatoire en déduit « proposé » et « utilisé » ; le moteur n'interprète pas. */
export interface SkillStats {
  /** Noms réunis de tous les listings de la session, triés. */
  listed: string[];
  /** Appels de l'outil Skill par nom, sous-agents compris. */
  calls: Record<string, number>;
  /** Skills marqués par Claude Code (attributionSkill) sur au moins un message, triés :
   *  un skill lancé par une commande slash n'a aucun appel de l'outil Skill. */
  attributed: string[];
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
  private readonly attributed = new Set<string>();

  addListing(evt: SkillListingEvent): void {
    for (const name of evt.names) this.listed.add(name);
  }

  addAssistant(evt: Pick<AssistantEvent, 'attributionSkill'>): void {
    if (evt.attributionSkill !== undefined) this.attributed.add(evt.attributionSkill);
  }

  addToolUse(tu: ToolUseRef): void {
    if (tu.name !== 'Skill' || this.seen.has(tu.id)) return;
    const skill = skillNameOf(tu.input);
    if (skill === null) return;
    this.seen.add(tu.id);
    this.calls[skill] = (this.calls[skill] ?? 0) + 1;
  }

  result(): SkillStats {
    return { listed: [...this.listed].sort(), calls: this.calls, attributed: [...this.attributed].sort() };
  }
}
