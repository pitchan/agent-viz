import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface InstallPaths {
  repoDir: string;
  claudeJsonPath: string;
  settingsLocalPath: string;
}

/** Racine du depot — valable depuis src/engine/ (tsx) comme depuis dist/engine/ (3 niveaux au-dessus). */
export function resolveNetgainRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/**
 * Clé `projects` de ~/.claude.json au format POSIX (forward slashes) :
 * c'est le format que lit et écrit Claude Code actuel — vérifié en essai réel
 * (claude mcp add écrit une clé posix ; une clé backslash n'est PAS résolue),
 * contrairement à l'exemple backslash de la doc MCP.
 */
export function canonicalProjectKey(dir: string): string {
  return path.resolve(dir).replace(/\\/g, '/');
}

/** Même chemin au sens win32 : séparateurs normalisés par resolve(), casse ignorée. */
export function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

export function resolveInstallPaths(repoDir: string, env: NodeJS.ProcessEnv = process.env): InstallPaths {
  const homeRoot = env['NETGAIN_HOME'] ?? homedir();
  const repo = path.resolve(repoDir);
  return {
    repoDir: repo,
    claudeJsonPath: path.join(homeRoot, '.claude.json'),
    settingsLocalPath: path.join(repo, '.claude', 'settings.local.json'),
  };
}

const REQUIRED_DIST = ['dist/engine/cli.js', 'dist/engine/mcp/main.js', 'dist/engine/package.json'];

export function missingDistFiles(netgainRoot: string): string[] {
  return REQUIRED_DIST.filter((rel) => !existsSync(path.join(netgainRoot, rel)));
}
