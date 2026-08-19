// La configuration déclarative par agent : chemins, entrée .gitignore, liste
// d'événements. Un 3e agent commence ici, par une entrée de données.
import path from 'node:path';
import os from 'node:os';
import type { AgentName, AgentConfigEntry } from './types.ts';

// Per-agent paths + gitignore entry + liste d'evenements. Add a third agent
// here, then register its adapter in registry.ts.
//
// Pourquoi la liste d'evenements est PAR AGENT et non partagee : les deux
// agents n'ont pas le meme vocabulaire. PostToolUseFailure a ete releve sur
// machine cote Claude Code ; rien ne dit que Copilot CLI le connaisse, et on
// n'a aucun moyen de le verifier d'ici. Ecrire dans la configuration d'un
// tiers un nom d'evenement qu'on n'a pas mesure, c'est lui faire porter un
// risque qu'on n'a pas evalue — chaque agent ne recoit donc que ce qu'on lui
// a constate.
export const AGENT_CONFIG: Record<AgentName, AgentConfigEntry> = {
  claude: {
    // PostToolUseFailure est le SEUL endroit ou un outil en erreur se signale :
    // PostToolUse ne se declenche que sur un succes. Sans cet abonnement, une
    // commande qui echoue ne laisse qu'un PreToolUse orphelin — un trou, que
    // rien ne distingue d'un outil encore en vol.
    events: ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'SessionStart'],
    userFile: () => path.join(os.homedir(), '.claude', 'settings.json'),
    projectFile: (root) => path.join(root, '.claude', 'settings.json'),
    localFile: (root) => path.join(root, '.claude', 'settings.local.json'),
    gitignoreEntry: '.claude/settings.local.json',
  },
  copilot: {
    events: ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionStart'],
    userFile: () => path.join(os.homedir(), '.copilot', 'hooks', 'agent-viz.json'),
    projectFile: (root) => path.join(root, '.github', 'hooks', 'agent-viz.json'),
    localFile: (root) => path.join(root, '.github', 'hooks', 'agent-viz.local.json'),
    gitignoreEntry: '.github/hooks/agent-viz.local.json',
  },
};

export function eventsFor(agent: AgentName): string[] {
  return AGENT_CONFIG[agent].events;
}

// Retro-compat : l'export public `EVENTS` a toujours designe les evenements de
// Claude Code. Il continue de le faire.
export const EVENTS: string[] = AGENT_CONFIG.claude.events;

// Per-agent broader patterns that count as "already covers our local file".
export const GITIGNORE_EXTRAS: Record<AgentName, string[]> = {
  claude: ['.claude/', '.claude', '.claude/*.local.json', '*.local.json'],
  copilot: ['.github/hooks/', '.github/hooks/*.local.json'],
};
