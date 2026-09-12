// tool-subject.ts — "what does this tool call act on?", in one place.
//
// Pure module: no DOM, no fs. A declarative table maps a tool name to the
// input field that identifies the call, so adding a tool is one entry rather
// than one more branch (Open/Closed).
//
// The subject is returned *untruncated* on purpose. Two consumers want the
// same rule at two lengths — the feed shows a short label, a watchdog alert
// has to show the command the agent actually ran — so the cut belongs to the
// caller, not here.

// La forme du champ hook que ce fichier lit reellement : chaque outil ne
// porte qu'un sous-ensemble de ces champs a la fois, jamais tous. Exportee :
// le detecteur du moteur en a besoin pour typer `tool_input` sur son propre
// evenement, sans redefinir la meme forme une seconde fois.
export interface ToolInput {
  command?: string;
  file_path?: string;
  pattern?: string;
  description?: string;
  skill?: string;
}

export interface ToolCallEvent {
  tool_name?: string;
  tool_input?: ToolInput;
}

function basename(p: unknown): string {
  // `String(p)` d'abord : `p` est un champ de hook, pas une valeur que ce
  // module construit — absent, vide ou hors-string sont des entrees reelles,
  // jamais une raison de lever (meme contrat que `classify` du voisin).
  const s = String(p);
  return s.split(/[/\\]/).pop() ?? s;
}

type SubjectPicker = (ti: ToolInput) => string | undefined;

const TOOL_SUBJECT: Record<string, SubjectPicker> = {
  Bash:  ti => ti.command,
  // Same field as Bash, and its absence here cost real information: every
  // PowerShell alert (retryStorm, stuck, badInvocation) rendered without its
  // command while the ps-* motifs and their remedies already existed.
  PowerShell: ti => ti.command,
  Read:  ti => ti.file_path && basename(ti.file_path),
  Write: ti => ti.file_path && basename(ti.file_path),
  Edit:  ti => ti.file_path && basename(ti.file_path),
  Grep:  ti => ti.pattern,
  Glob:  ti => ti.pattern,
  Agent: ti => ti.description,
  Skill: ti => ti.skill,
};

export function toolSubject(evt: ToolCallEvent): string {
  const ti = evt.tool_input;
  if (!ti) return '';
  const pick = evt.tool_name ? TOOL_SUBJECT[evt.tool_name] : undefined;
  if (!pick) return '';
  return pick(ti) || '';
}
