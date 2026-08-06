import { hasNetgainHook, type HookPresence } from './hook-edit.js';
import { InstallError } from './json-file.js';
import { hasCanonicalMcp, MCP_SERVER_NAME, type McpPresence } from './mcp-edit.js';
import { canonicalProjectKey } from './paths.js';

/** Lectures injectées (documents JSON déjà parsés) — computeStatus ne touche jamais au disque. */
export interface StatusInput {
  netgainRoot: string;
  repoDir: string;
  /** ~/.claude.json parsé (portée canonique MCP), undefined si absent. */
  claudeJson: unknown;
  /** <repo>/.claude/settings.local.json parsé (portée canonique hook), undefined si absent. */
  settingsLocal: unknown;
  missingDist: string[];
  /** Autres scopes, lecture seule (strays) : */
  userSettings?: unknown; // ~/.claude/settings.json
  projectSettings?: unknown; // <repo>/.claude/settings.json
  mcpJson?: unknown; // <repo>/.mcp.json
}

export interface InstallStatus {
  /** ON complet = MCP présent + hook présent + dist complet. */
  on: boolean;
  mcp: McpPresence;
  hook: HookPresence;
  missingDist: string[];
  /** Avertissements texte lecture seule — sans effet sur l'exit code. */
  notes: string[];
}

/** Le status ne casse jamais sur une structure difforme : difforme = absent. */
function tolerantMcp(claudeJson: unknown, netgainRoot: string, repoDir: string): McpPresence {
  try {
    return hasCanonicalMcp(claudeJson, netgainRoot, repoDir);
  } catch (err) {
    if (err instanceof InstallError) return { present: false, canonical: false, keys: [] };
    throw err;
  }
}

function hasStrayMcp(doc: unknown): boolean {
  if (typeof doc !== 'object' || doc === null) return false;
  const servers = (doc as Record<string, unknown>)['mcpServers'];
  return typeof servers === 'object' && servers !== null && MCP_SERVER_NAME in (servers as object);
}

export function computeStatus(input: StatusInput): InstallStatus {
  const mcp = tolerantMcp(input.claudeJson, input.netgainRoot, input.repoDir);
  const hook = hasNetgainHook(input.settingsLocal, input.netgainRoot);
  const notes: string[] = [];

  const canonicalKey = canonicalProjectKey(input.repoDir);
  for (const key of mcp.keys.filter((k) => k !== canonicalKey)) {
    notes.push(
      `MCP porté par une variante non-canonique de la clé projet : « ${key} » (non résolue par Claude Code actuel) — un « netgain on » convergera vers « ${canonicalKey} »`,
    );
  }
  if (hasNetgainHook(input.userSettings, input.netgainRoot).present) {
    notes.push('hook netgain aussi dans ~/.claude/settings.json (scope user) — hors portée de on/off, à retirer à la main');
  }
  if (hasNetgainHook(input.projectSettings, input.netgainRoot).present) {
    notes.push('hook netgain aussi dans .claude/settings.json (scope projet partagé) — hors portée de on/off, à retirer à la main');
  }
  if (hasStrayMcp(input.mcpJson)) {
    notes.push('MCP netgain-map aussi dans .mcp.json (scope projet partagé) — hors portée de on/off, à retirer à la main');
  }
  if (hasStrayMcp(input.claudeJson)) {
    notes.push('MCP netgain-map aussi en scope user (mcpServers racine de ~/.claude.json) — hors portée de on/off, à retirer à la main');
  }

  return {
    on: mcp.present && hook.present && input.missingDist.length === 0,
    mcp,
    hook,
    missingDist: input.missingDist,
    notes,
  };
}

export function renderStatus(status: InstallStatus, version: string): string {
  const lines: string[] = [];
  lines.push(`netgain ${version} — état de l'installation par repo`);
  lines.push(`  MCP netgain-map (~/.claude.json)          : ${status.mcp.present ? 'posé' : 'absent'} — effet au prochain démarrage de session`);
  lines.push(`  hook router (.claude/settings.local.json) : ${status.hook.present ? 'posé' : 'absent'} — rechargé à chaud (file watcher)`);
  lines.push(
    status.missingDist.length === 0
      ? '  dist                                       : complet'
      : `  dist                                       : manquant (${status.missingDist.join(', ')}) — lancez npm run build`,
  );
  for (const note of status.notes) lines.push(`  ⚠ ${note}`);
  lines.push(status.on ? 'verdict : ON' : 'verdict : OFF (ou partiel)');
  return `${lines.join('\n')}\n`;
}
