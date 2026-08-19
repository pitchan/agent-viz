// Décider OÙ installer (portée → fichier cible), QUELLE commande écrire dans
// les settings, tenir le .gitignore de la portée locale, et balayer les cibles
// qui portent réellement notre crochet.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AgentOpts, ResolvedTarget, ResolvedCommand, Scope } from './types.ts';
import { AGENT_CONFIG } from './config.ts';

// Un objet exploitable par accès de champ — même garde locale que les autres
// fichiers du serveur : `JSON.parse` ne promet qu'un JSON valide, pas un objet.
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Walk up from `cwd` looking for a project root marker (.git or package.json).
// Stop at homedir or filesystem root. Returns absolute path or null.
//
// Two skip rules: the home directory itself never counts as a project (a .git
// in ~ is a dotfiles repo, not a project we want to install hooks into), and
// the agent-viz package root never counts either (auto-install ran from
// inside the agent-viz checkout would otherwise scope hooks to the repo
// itself, useful to nobody). Both skips fall through to user scope.
export function findProjectRoot(
  cwd: string, { packageRoot, homedir = os.homedir() }: { packageRoot?: string; homedir?: string } = {},
): string | null {
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  while (dir && dir !== root && dir !== path.dirname(homedir)) {
    if (dir === homedir) { dir = path.dirname(dir); continue; }
    if (packageRoot && dir === packageRoot) { dir = path.dirname(dir); continue; }
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Decide where to write hooks.
//   resolveScope({ scope: 'user'|'project'|'local'|undefined, cwd, agent })
//     → { scope, file, projectRoot }
// Defaults: explicit scope respected; no scope → 'user' (global), for every
// agent. A user-scope hook fires from any directory, so an agent session
// launched outside the install directory is still captured. The previous
// default ('local' when a project was detected) only registered the hook for
// that one project — sessions run from anywhere else silently produced no
// events. This mirrors how agent-viz itself is installed: globally.
export function resolveScope({ scope, cwd, agent = 'claude', packageRoot }: AgentOpts = {}): ResolvedTarget {
  const cfg = AGENT_CONFIG[agent];
  cwd = cwd || process.cwd();
  if (!scope || scope === 'user') {
    return { scope: 'user', file: cfg.userFile(), projectRoot: null };
  }
  const projectRoot = findProjectRoot(cwd, { packageRoot });
  if (scope === 'project') {
    if (!projectRoot) throw new Error('--project requested but no .git/ or package.json found from cwd');
    return { scope: 'project', file: cfg.projectFile(projectRoot), projectRoot };
  }
  // scope === 'local'
  if (!projectRoot) throw new Error('--local requested but no .git/ or package.json found from cwd');
  return { scope: 'local', file: cfg.localFile(projectRoot), projectRoot };
}

// Decide what command string to embed in agent settings.
// If the binary is on a stable absolute path (not in an /_npx/ cache), embed
// `node "<abs>/bin/agent-viz.js" hook --source=<agent>` (fast). Otherwise use
// `npx --yes @vcueto/agent-viz@<version> hook --source=<agent>` pinned to the
// currently-running version (~300-800ms cold start).
export function resolveHookCommand({ packageRoot, version, agent = 'claude' }: AgentOpts = {}): ResolvedCommand {
  // Émis en dist/server/install-hooks/scopes.js : la racine du paquet est
  // TROIS crans au-dessus (l'original, un cran moins profond, en comptait deux).
  packageRoot = packageRoot || path.resolve(import.meta.dirname, '..', '..', '..');
  const binPath = path.join(packageRoot, 'bin', 'agent-viz.js');
  // npx caches always live under "/_npx/" on every platform.
  const isEphemeral = packageRoot.includes(`${path.sep}_npx${path.sep}`)
                   || packageRoot.includes('/_npx/');
  if (!isEphemeral && fs.existsSync(binPath)) {
    const norm = binPath.replace(/\\/g, '/');
    return { command: `node "${norm}" hook --source=${agent}`, mode: 'absolute', path: norm };
  }
  let v = version;
  if (!v) {
    // BOM retire avant l analyse (constat C1, idiome de hook.js:64) : sans lui,
    // un package.json prefixe rendrait un spec npx SANS version, en silence.
    try {
      const brut = fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8');
      const pkg: unknown = JSON.parse(brut.charCodeAt(0) === 0xFEFF ? brut.slice(1) : brut);
      if (isRecord(pkg) && typeof pkg.version === 'string') v = pkg.version;
    } catch {}
  }
  const spec = v ? `@vcueto/agent-viz@${v}` : '@vcueto/agent-viz';
  return { command: `npx --yes ${spec} hook --source=${agent}`, mode: 'npx', spec };
}

// Append the local-scope file to .gitignore if not already covered. No-op when
// .gitignore doesn't exist (we don't create one). Idempotent. `extraPatterns`
// holds historical broader patterns we accept as "already ignored".
export function ensureGitignore(
  projectRoot: string, target: string, extraPatterns: string[] = [],
): { changed: boolean; reason?: string } {
  const gi = path.join(projectRoot, '.gitignore');
  if (!fs.existsSync(gi)) return { changed: false, reason: 'no .gitignore (skipped)' };
  const content = fs.readFileSync(gi, 'utf8');
  const lines = content.split('\n').map(l => l.trim());
  const accepted = new Set([target, ...extraPatterns]);
  if (lines.some(l => accepted.has(l))) return { changed: false, reason: 'already ignored' };
  const sep = content.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(gi, `${sep}${target}\n`);
  return { changed: true };
}

// La boucle « quelles cibles portent réellement notre crochet », écrite une
// fois : les adaptateurs s'en servent pour leur avertissement inter-portées
// (crossScope) et le registre pour findInstalledScopes.
export function scanInstalled(
  targets: ResolvedTarget[], installedIn: (file: string) => boolean,
): Array<{ scope: Scope; file: string }> {
  const installed: Array<{ scope: Scope; file: string }> = [];
  for (const t of targets) {
    if (!fs.existsSync(t.file)) continue;
    if (installedIn(t.file)) installed.push({ scope: t.scope, file: t.file });
  }
  return installed;
}
