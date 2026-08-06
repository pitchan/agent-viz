/**
 * Forme de session : interactive (prompt humain — marqueur de saisie ou
 * blocs [{type:"text"}]), headless (au moins un prompt en chaîne brute sans
 * marqueur humain — claude -p, script) ou unknown (aucun prompt utilisateur
 * exploitable). Seuls les prompts de l'agent PRINCIPAL comptent : dans le
 * transcript d'un sous-agent, la tâche dispatchée est un prompt en chaîne —
 * la compter classerait « machine » toute session à sous-agents.
 * Les événements meta n'arrivent jamais ici (normalisés avant, events.ts).
 *
 * Révision du 2026-08-03 : l'ancien critère « chaîne = machine » (v0.9.0)
 * est réfuté par la calibration sur données réelles (0/16 sur la semaine
 * humaine). Une chaîne brute peut venir d'une CLI humaine — promptSource
 * « typed » ou origin.kind « human » le disent explicitement ; promptSource
 * seul ne suffirait pas à retourner le critère : la forensique a montré des
 * sessions « claude -p » portant promptSource « sdk » et entrypoint
 * « claude-vscode » — identiques à une session VS Code humaine sur ces deux
 * champs. C'est pourquoi la forme (chaîne sans marqueur humain = machine)
 * tranche en dernier ressort. Le bruit du harnais (isNoisePrompt : tags XML,
 * commandes locales) n'ouvre jamais de tour — cohérent avec PromptsAggregator.
 */
import type { NormalizedEvent } from '../../core/events.js';
import { isNoisePrompt } from './prompts.js';

type UserPromptEvent = Extract<NormalizedEvent, { kind: 'user_prompt' }>;

export type SessionKind = 'interactive' | 'headless' | 'unknown';

export class SessionKindAggregator {
  private sawHuman = false;
  private sawMachine = false;

  addPrompt(evt: UserPromptEvent): void {
    if (isNoisePrompt(evt.text)) return;
    if (evt.originKind === 'human' || evt.promptSource === 'typed') {
      this.sawHuman = true;
      return;
    }
    if (evt.shape === 'blocks') {
      this.sawHuman = true;
      return;
    }
    this.sawMachine = true;
  }

  result(): SessionKind {
    if (this.sawMachine) return 'headless';
    if (this.sawHuman) return 'interactive';
    return 'unknown';
  }
}
