/**
 * Forme de session : interactive (prompt humain — marqueur de saisie ou
 * blocs [{type:"text"}]), headless (au moins un prompt en chaîne brute sans
 * marqueur humain — claude -p, script) ou unknown (aucun prompt utilisateur
 * exploitable). Seuls les prompts de l'agent PRINCIPAL comptent : dans le
 * transcript d'un sous-agent, la tâche dispatchée est un prompt en chaîne —
 * la compter classerait « machine » toute session à sous-agents.
 * Les événements meta n'arrivent jamais ici (normalisés avant, events.ts).
 *
 * Une chaîne brute ne suffit pas à dire « machine » : une CLI humaine en écrit aussi,
 * et promptSource « typed » ou origin.kind « human » le disent explicitement.
 *
 * promptSource seul ne suffit pas non plus : des sessions « claude -p » portent promptSource
 * « sdk » et entrypoint « claude-vscode », comme une session VS Code humaine. D'où la forme
 * (chaîne sans marqueur humain = machine) en dernier ressort.
 *
 * Le bruit du harnais (isNoisePrompt : tags XML, commandes locales) n'ouvre jamais de tour,
 * comme dans PromptsAggregator.
 */
import type { NormalizedEvent } from '../../core/events.ts';
import { isNoisePrompt } from './prompts.ts';

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
