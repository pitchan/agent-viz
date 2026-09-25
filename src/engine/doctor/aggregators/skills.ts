import type { NormalizedEvent, SkillListingEntry, ToolUseRef } from '../../core/events.ts';

type SkillListingEvent = Extract<NormalizedEvent, { kind: 'skill_listing' }>;
type AssistantEvent = Extract<NormalizedEvent, { kind: 'assistant' }>;
type UserPromptEvent = Extract<NormalizedEvent, { kind: 'user_prompt' }>;
type SkillBodyEvent = Extract<NormalizedEvent, { kind: 'skill_body' }>;

export interface SkillBody {
  skill: string;
  lines: number;
  bytes: number;
  by: 'model' | 'user';
}

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
  /** Dernière entrée vue par nom, triée par nom : taille, description présente ou retirée. */
  listing: SkillListingEntry[];
  /** Commandes « /nom » tapées, par nom, commandes intégrées comprises. */
  typed: Record<string, number>;
  /** Textes de SKILL.md chargés, rattachés au skill qui les a chargés. */
  bodies: SkillBody[];
  /** Textes chargés qu'aucun appel ni commande tapée ne rattache : comptés, jamais devinés. */
  unattributedBodies: number;
}

function skillNameOf(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const skill = (input as Record<string, unknown>)['skill'];
  return typeof skill === 'string' && skill !== '' ? skill : null;
}

const byName = (a: SkillListingEntry, b: SkillListingEntry): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Une ligne assistant est répétée par bloc de contenu : un appel se dédoublonne par id. */
export class SkillsAggregator {
  private readonly listed = new Set<string>();
  private readonly seen = new Set<string>();
  private readonly calls: Record<string, number> = {};
  private readonly attributed = new Set<string>();
  private readonly listing = new Map<string, SkillListingEntry>();
  private readonly skillOfCall = new Map<string, string>();
  private readonly typed: Record<string, number> = {};
  private readonly bodies: SkillBody[] = [];
  private unattributedBodies = 0;
  // Un « /nom » tapé charge son texte juste après ; tout autre prompt coupe ce lien.
  private pendingTyped: string | null = null;

  addListing(evt: SkillListingEvent): void {
    for (const name of evt.names) this.listed.add(name);
    for (const entry of evt.entries) this.listing.set(entry.name, entry);
  }

  addAssistant(evt: Pick<AssistantEvent, 'attributionSkill'>): void {
    if (evt.attributionSkill !== undefined) this.attributed.add(evt.attributionSkill);
  }

  addToolUse(tu: ToolUseRef): void {
    if (tu.name !== 'Skill' || this.seen.has(tu.id)) return;
    const skill = skillNameOf(tu.input);
    if (skill === null) return;
    this.seen.add(tu.id);
    this.skillOfCall.set(tu.id, skill);
    this.calls[skill] = (this.calls[skill] ?? 0) + 1;
  }

  addPrompt(evt: Pick<UserPromptEvent, 'commandName'>): void {
    this.pendingTyped = evt.commandName ?? null;
    if (evt.commandName !== undefined) this.typed[evt.commandName] = (this.typed[evt.commandName] ?? 0) + 1;
  }

  addBody(evt: SkillBodyEvent): void {
    if (evt.sourceToolUseId !== null) {
      const skill = this.skillOfCall.get(evt.sourceToolUseId);
      if (skill === undefined) this.unattributedBodies += 1;
      else this.bodies.push({ skill, lines: evt.lines, bytes: evt.bytes, by: 'model' });
      return;
    }
    if (this.pendingTyped === null) {
      this.unattributedBodies += 1;
      return;
    }
    this.bodies.push({ skill: this.pendingTyped, lines: evt.lines, bytes: evt.bytes, by: 'user' });
    this.pendingTyped = null;
  }

  result(): SkillStats {
    return {
      listed: [...this.listed].sort(),
      calls: this.calls,
      attributed: [...this.attributed].sort(),
      listing: [...this.listing.values()].sort(byName),
      typed: this.typed,
      bodies: this.bodies,
      unattributedBodies: this.unattributedBodies,
    };
  }
}
