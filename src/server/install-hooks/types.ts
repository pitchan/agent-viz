// Le vocabulaire partagé du sous-système d'installation de crochets — types
// communs aux modules de src/server/install-hooks/ et à la façade. Voir
// doc/43 (dépôt privé) pour le découpage.

export type AgentName = 'claude' | 'copilot';
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
  version?: string;
  agent?: AgentName;
  target?: string;
}

// L'interface du registre INSTALLERS. Les quatre premières méthodes existaient
// déjà ; sweepTargets et installedIn comblent les deux endroits où le code
// branchait encore sur le nom d'agent (findInstalledScopes, agentDetected) au
// lieu de passer par le registre. Ajouter un 3e agent = un fichier
// d'adaptateur + une entrée AGENT_CONFIG + une entrée INSTALLERS.
export interface AgentInstaller {
  install: (opts: AgentOpts) => unknown;
  uninstall: (opts: AgentOpts) => unknown;
  audit: (opts: AgentOpts) => unknown;
  detect: () => boolean;
  sweepTargets: (cwd: string | undefined, opts?: { packageRoot?: string }) => ResolvedTarget[];
  installedIn: (file: string) => boolean;
}

// Per-event timeout written into agent settings. Must stay > 1 s (Windows node
// + AV cold start) and > the in-process safety net in src/server/hook.js so the safety
// fires *before* the agent kills us. Bumped from 5 s → 10 s when the safety
// dropped to 3 s; install() now also refreshes existing standard-shape hooks
// whose timeout drifted away from this value.
export const HOOK_TIMEOUT_SEC = 10;
