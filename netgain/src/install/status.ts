import { hasNetgainHook, type HookPresence } from './hook-edit.js';
import { InstallError } from './json-file.js';
import { hasCanonicalMcp, MCP_SERVER_NAME, type McpPresence } from './mcp-edit.js';
import { canonicalProjectKey } from './paths.js';
import { cheminsAvantFusion, crochetsAvantFusion, mcpAvantFusion } from './rupture.js';

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
  /** ON complet = MCP présent + hook présent + dist complet + aucun enregistrement d'avant la fusion. */
  on: boolean;
  mcp: McpPresence;
  hook: HookPresence;
  missingDist: string[];
  /**
   * Nos enregistrements périmés par le déplacement de l'étape 2 (forme littérale),
   * crochet puis MCP. Réparables par « netgain on » — ils font donc bouger `on`,
   * contrairement aux `notes`.
   */
  preFusion: string[];
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

/** Le conteneur `mcpServers` à la racine d'un document, s'il y en a un. */
function strayServers(doc: unknown): unknown {
  if (typeof doc !== 'object' || doc === null) return undefined;
  return (doc as Record<string, unknown>)['mcpServers'];
}

function hasStrayMcp(doc: unknown): boolean {
  const servers = strayServers(doc);
  return typeof servers === 'object' && servers !== null && MCP_SERVER_NAME in (servers as object);
}

const HORS_PORTEE = 'hors portée de on/off, à retirer à la main';

/**
 * Note d'un scope hors portée de on/off — ENRICHIE (D7) quand l'entrée y porte en plus un
 * chemin d'avant la fusion. Ces quatre-là n'entrent jamais dans `preFusion` : « netgain on »
 * ne peut pas les réparer, et lui faire dire le contraire rendrait son critère d'arrêt
 * insatisfiable. Le prix assumé : elles ne font bouger ni le verdict ni l'exit code.
 */
function noteHorsPortee(quoi: string, chemins: string[]): string {
  const chemin = chemins[0];
  return chemin === undefined
    ? `${quoi} — ${HORS_PORTEE}`
    : `${quoi} : crochet d AVANT la fusion (${chemin}) — ce chemin n existe plus ; ${HORS_PORTEE}`;
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
    notes.push(
      noteHorsPortee(
        'hook netgain aussi dans ~/.claude/settings.json (scope user)',
        crochetsAvantFusion(input.userSettings, input.netgainRoot),
      ),
    );
  }
  if (hasNetgainHook(input.projectSettings, input.netgainRoot).present) {
    notes.push(
      noteHorsPortee(
        'hook netgain aussi dans .claude/settings.json (scope projet partagé)',
        crochetsAvantFusion(input.projectSettings, input.netgainRoot),
      ),
    );
  }
  if (hasStrayMcp(input.mcpJson)) {
    notes.push(
      noteHorsPortee(
        'MCP netgain-map aussi dans .mcp.json (scope projet partagé)',
        mcpAvantFusion(strayServers(input.mcpJson), input.netgainRoot, input.repoDir),
      ),
    );
  }
  if (hasStrayMcp(input.claudeJson)) {
    notes.push(
      noteHorsPortee(
        'MCP netgain-map aussi en scope user (mcpServers racine de ~/.claude.json)',
        mcpAvantFusion(strayServers(input.claudeJson), input.netgainRoot, input.repoDir),
      ),
    );
  }

  const preFusion = cheminsAvantFusion(input);

  return {
    on: mcp.present && hook.present && input.missingDist.length === 0 && preFusion.length === 0,
    mcp,
    hook,
    missingDist: input.missingDist,
    preFusion,
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
  // ✗ et non ⚠ : ces lignes-là pèsent sur le verdict et l'exit code, et se réparent.
  for (const chemin of status.preFusion) {
    lines.push(`  ✗ enregistrement d AVANT la fusion : ${chemin} — ce chemin n existe plus ; relancez « netgain on » pour le réparer`);
  }
  for (const note of status.notes) lines.push(`  ⚠ ${note}`);
  lines.push(status.on ? 'verdict : ON' : 'verdict : OFF (ou partiel)');
  return `${lines.join('\n')}\n`;
}
