// Le vocabulaire partagé du sous-système d'installation de hooks : les types
// communs aux modules de src/server/install-hooks/, dont `Target` que
// prompt-install.ts importe aussi.

export type AgentName = 'claude' | 'copilot';
// Ce que `--target` et l'invite d'installation acceptent : un agent, ou 'both'
// pour tous les agents du registre.
export type Target = AgentName | 'both';
export type Scope = 'user' | 'project' | 'local';

export interface AgentConfigEntry {
  events: string[];
  userFile: () => string;
  projectFile: (root: string) => string;
  localFile: (root: string) => string;
  gitignoreEntry: string;
}

export interface ResolvedTarget {
  scope: Scope;
  file: string;
  projectRoot: string | null;
}

export interface ResolvedCommand {
  command: string;
  mode: 'absolute' | 'npx';
  path?: string;
  spec?: string;
}

// Le sac d'options partagé par toute l'API haut niveau (`auditClaude`,
// `installClaude`, `findInstalledScopes`, `dispatch`, `install`, …) — un seul
// type, réutilisé bien au-delà de la deuxième occurrence (précédent du dépôt),
// parce que ce sont toutes des variations du MÊME sac.
export interface AgentOpts {
  scope?: Scope;
  cwd?: string;
  packageRoot?: string;
  agent?: AgentName;
  target?: Target;
}

// L'interface du registre INSTALLERS. sweepTargets et installedIn laissent
// findInstalledScopes générique : aucun branchement sur le nom d'agent.
// Les six méthodes valent pour tout agent enregistré. Un adaptateur a le droit
// de REFUSER une opération (installCopilot refuse d'écraser un fichier qui
// porte notre nom sans avoir la forme d'un fichier de hooks Copilot).
//
// La traduction de ce refus en `{ error: string }` ne couvre que TROIS des six
// méthodes — `install`, `uninstall` et `audit`, les seules qui passent par
// `dispatch` / `uninstall` de registry.ts. Pour celles-là, le refus est rangé
// dans la case de cet agent, les autres agents gardent leur résultat, et les
// consommateurs n'ont jamais à connaître l'agent concret.
//
// `detect`, `sweepTargets` et `installedIn` sont appelées DIRECTEMENT, sans
// garde : `pickAgents` appelle `detect`, `findInstalledScopes` appelle
// `sweepTargets` et `installedIn`. Elles PEUVENT LEVER et la levée traverse
// jusqu'à l'appelant — `installedIn` lève sur un fichier de hooks illisible,
// donc `agent-viz status` casse. Ne pas écrire ici que le registre traduit
// tout.
//
// Ajouter un 3e agent = un fichier d'adaptateur + une entrée AGENT_CONFIG +
// une entrée INSTALLERS.
export interface AgentInstaller {
  install: (opts: AgentOpts) => unknown;
  uninstall: (opts: AgentOpts) => unknown;
  audit: (opts: AgentOpts) => unknown;
  detect: () => boolean;
  sweepTargets: (cwd: string | undefined, opts?: { packageRoot?: string }) => ResolvedTarget[];
  installedIn: (file: string) => boolean;
}

// Per-event timeout written into agent settings. Must stay > 1 s (Windows node
// + AV cold start) and > the in-process safety net in src/server/hook.ts so the safety
// fires *before* the agent kills us. install() also refreshes an existing
// standard-shape hook whose timeout differs from this value.
export const HOOK_TIMEOUT_SEC = 10;
