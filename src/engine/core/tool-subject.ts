// viz-tool-subject.mjs — "what does this tool call act on?", in one place.
//
// Pure module: no DOM, no fs. A declarative table maps a tool name to the
// input field that identifies the call, so adding a tool is one entry rather
// than one more branch (Open/Closed).
//
// The subject is returned *untruncated* on purpose. Two consumers want the
// same rule at two lengths — the feed shows a short label, a watchdog alert
// has to show the command the agent actually ran — so the cut belongs to the
// caller, not here.

function basename(p) {
  return String(p).split(/[/\\]/).pop();
}

const TOOL_SUBJECT = {
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

export function toolSubject(evt) {
  const ti = evt.tool_input;
  if (!ti) return '';
  const pick = TOOL_SUBJECT[evt.tool_name];
  if (!pick) return '';
  return pick(ti) || '';
}
