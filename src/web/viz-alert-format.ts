// viz-alert-format.ts — how an alert is worded, in one place.
//
// Pure module: no DOM. The alerts popup and the OS notification say the same
// thing about the same alert, and only one of the two can be inspected by a
// browser test — so the wording lives here, where a unit test can pin it.
//
// Formatting reads the uniform alert shape from the engine's detector:
// `occurrences` and `tools` are always arrays, so a detail-line builder can be
// looked up by alert type instead of sniffing which fields happen to be present.

import { clockTime } from '../engine/core/clock-time.ts';
import type { Alert } from '../engine/watchdog/detector.ts';

// Ce que la mise en mots lit d'une alerte, chaque champ typé par le détecteur.
// `type` reste une chaîne : la pastille met aussi en mots l'alerte de la vigie
// tarifaire, qu'aucun détecteur ne lève.
export type AlertContent = Pick<Alert, 'message' | 'subject' | 'sessionId' | 'agentId' | 'agentType' | 'occurrences' | 'tools'> & { type: string };

// A command has no natural length limit and an alert has to fit in a panel.
// Cut visibly — a silently truncated command reads as a different command.
const SUBJECT_MAX = 200;

// A list is read by scanning down the left edge, so every entry has to start
// near it. One 200-character command wrapped over four lines, times however
// many tools are in flight, is horizontally clean and unreadable — the budget
// for an item in a list is much smaller than for a lone subject.
const LIST_SUBJECT_MAX = 40;
const LIST_MAX = 5;

export function truncate(text: unknown, max = SUBJECT_MAX): string {
  const s = String(text);
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// '' is what the watchdog stores for the main thread, and that is a real
// answer, not a missing one.
export function alertActor({ agentId, agentType }: Pick<Alert, 'agentId' | 'agentType'>): string {
  if (!agentId) return 'main thread';
  return `${agentType || 'Agent'} ${agentId.slice(0, 8)}`;
}

// La ligne « qui » d'une alerte, décidée une fois pour le popup et la notification :
// vide pour un `stuck` (l'acteur est sur chaque ligne d'outil) et pour une alerte
// sans session (personne à nommer).
export function alertActorLine(alert: Pick<Alert, 'sessionId' | 'agentId' | 'agentType'> & { type: string }): string {
  if (alert.type === 'stuck' || !alert.sessionId) return '';
  return alertActor(alert);
}

// Cle dynamique (`alert.type`) : seuls `loop` et `stuck` detaillent, les
// autres types d'alerte retombent sur `alertDetailLines` -> `[]`.
const DETAIL_LINES: Record<string, ((a: AlertContent) => string[]) | undefined> = {
  loop: (a) => {
    // The alert keeps every occurrence — it is the record, and `count` has to
    // stay exact. The cap belongs here, at the display. Nothing else bounds
    // this list: only time bounds it. Repeats keep accumulating while an alert
    // is already active and deduplicated, so the next one emitted — once the
    // lock breaks, whether by an acknowledgement or by the episode's own
    // window closing — carries every repeat still inside that window.
    if (a.occurrences.length === 0) return [];
    const shown = a.occurrences.slice(0, LIST_MAX).map(o => clockTime(o.ts)).join(', ');
    // Never drop silently: a list that stops at five without saying so reads
    // as a complete list of five.
    const dropped = a.occurrences.length - LIST_MAX;
    return [`Repeats at ${shown}${dropped > 0 ? ` …and ${dropped} more` : ''}`];
  },
  stuck: (a) => {
    // Clock first: the list is read by scanning its left edge. The actor is
    // appended only for a subagent — on the main thread it would repeat on
    // every row and push the subject out of view.
    const lines = a.tools.slice(0, LIST_MAX).map((t) => {
      const row = `${clockTime(t.startedAt)} · ${t.toolName} · ${truncate(t.subject, LIST_SUBJECT_MAX)}`;
      return t.agentId ? `${row} · ${alertActor(t)}` : row;
    });
    // Never drop silently: a list that stops at five without saying so reads
    // as a complete list of five.
    const dropped = a.tools.length - LIST_MAX;
    if (dropped > 0) lines.push(`…and ${dropped} more`);
    return lines;
  },
};

export function alertDetailLines(alert: AlertContent): string[] {
  const build = DETAIL_LINES[alert.type];
  return build ? build(alert) : [];
}

// The body the OS toast shows. Playwright cannot see the bubble, so this is
// the part of the notification that gets proved by test rather than by eye.
export function notificationPayload(alert: AlertContent): { title: string; body: string } {
  const lines = [alert.message];
  if (alert.subject) lines.push(truncate(alert.subject));
  lines.push(...alertDetailLines(alert));
  const who = alertActorLine(alert);
  if (who) lines.push(who);
  return { title: `agent-viz: ${alert.type}`, body: lines.join('\n') };
}
