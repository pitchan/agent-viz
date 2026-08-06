import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { InstallCliOptions } from '../cli-args.js';
import { readPackageVersion } from '../version.js';
import { applyHookOff, applyHookOn } from './hook-edit.js';
import { InstallError, readJsonFile, writeJsonFileAtomic } from './json-file.js';
import { applyMcpOff, applyMcpOn } from './mcp-edit.js';
import { missingDistFiles, resolveInstallPaths, resolveNetgainRoot, type InstallPaths } from './paths.js';
import { computeStatus, renderStatus } from './status.js';

function resolveRepoDir(cli: InstallCliOptions): string | undefined {
  const dir = path.resolve(cli.dir ?? process.cwd());
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return undefined;
  return dir;
}

function repoDirOrUsage(cli: InstallCliOptions, cmd: string): string | undefined {
  const repoDir = resolveRepoDir(cli);
  if (repoDir === undefined) {
    process.stderr.write(`netgain ${cmd} : répertoire introuvable : ${path.resolve(cli.dir ?? process.cwd())}\n`);
  }
  return repoDir;
}

/** Lecture d'un scope stray : tolérante, un fichier illisible = absent (lecture seule). */
function tolerantRead(filePath: string): unknown {
  try {
    return readJsonFile(filePath).value;
  } catch {
    return undefined;
  }
}

export async function runOnCli(cli: InstallCliOptions): Promise<number> {
  const repoDir = repoDirOrUsage(cli, 'on');
  if (repoDir === undefined) return 2;
  const netgainRoot = resolveNetgainRoot();
  const missing = missingDistFiles(netgainRoot);
  if (missing.length > 0) {
    process.stderr.write(`netgain on : dist incomplet (${missing.join(', ')}) — lancez npm run build\n`);
    return 1;
  }
  const paths = resolveInstallPaths(repoDir);
  try {
    // lire et VALIDER les deux fichiers avant toute écriture — un JSON invalide n'est jamais touché
    const claude = readJsonFile(paths.claudeJsonPath);
    const local = readJsonFile(paths.settingsLocalPath);
    const mcp = applyMcpOn(claude.value, netgainRoot, repoDir);
    const hook = applyHookOn(local.value, netgainRoot);
    // écritures : MCP d'abord, hook ensuite (un hook seul nudgerait vers des outils absents)
    if (mcp.changed) writeJsonFileAtomic(paths.claudeJsonPath, mcp.value, claude.indent);
    if (hook.changed) writeJsonFileAtomic(paths.settingsLocalPath, hook.value, local.indent);
    process.stdout.write(
      [
        `netgain on — ${repoDir}`,
        `  MCP netgain-map → ${paths.claudeJsonPath} ${mcp.changed ? 'posé' : 'déjà en place'} (effet au prochain démarrage de session)`,
        `  hook router → ${paths.settingsLocalPath} ${hook.changed ? 'posé' : 'déjà en place'} (rechargé à chaud)`,
        '',
      ].join('\n'),
    );
    return 0;
  } catch (err) {
    if (err instanceof InstallError) {
      process.stderr.write(`netgain on : ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

export async function runOffCli(cli: InstallCliOptions): Promise<number> {
  const repoDir = repoDirOrUsage(cli, 'off');
  if (repoDir === undefined) return 2;
  const netgainRoot = resolveNetgainRoot();
  const paths = resolveInstallPaths(repoDir);
  try {
    const claude = readJsonFile(paths.claudeJsonPath);
    const local = readJsonFile(paths.settingsLocalPath);
    const hook = applyHookOff(local.value, netgainRoot);
    const mcp = applyMcpOff(claude.value, repoDir);
    // écritures : hook d'abord, MCP ensuite (un MCP seul est inerte, l'inverse nudgerait dans le vide)
    if (hook.changed) writeJsonFileAtomic(paths.settingsLocalPath, hook.value, local.indent);
    if (mcp.changed) writeJsonFileAtomic(paths.claudeJsonPath, mcp.value, claude.indent);
    process.stdout.write(
      `netgain off — ${repoDir}\n  hook router : ${hook.changed ? 'retiré' : 'déjà absent'}\n  MCP netgain-map : ${mcp.changed ? 'retiré (toutes variantes de clé)' : 'déjà absent'}\n`,
    );
    return 0;
  } catch (err) {
    if (err instanceof InstallError) {
      process.stderr.write(`netgain off : ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

export async function runStatusCli(cli: InstallCliOptions): Promise<number> {
  const repoDir = repoDirOrUsage(cli, 'status');
  if (repoDir === undefined) return 2;
  const netgainRoot = resolveNetgainRoot();
  const paths: InstallPaths = resolveInstallPaths(repoDir);
  let claudeJson: unknown;
  let settingsLocal: unknown;
  try {
    claudeJson = readJsonFile(paths.claudeJsonPath).value;
    settingsLocal = readJsonFile(paths.settingsLocalPath).value;
  } catch (err) {
    if (err instanceof InstallError) {
      process.stderr.write(`netgain status : ${err.message}\n`);
      return 1;
    }
    throw err;
  }
  const status = computeStatus({
    netgainRoot,
    repoDir,
    claudeJson,
    settingsLocal,
    missingDist: missingDistFiles(netgainRoot),
    userSettings: tolerantRead(path.join(path.dirname(paths.claudeJsonPath), '.claude', 'settings.json')),
    projectSettings: tolerantRead(path.join(repoDir, '.claude', 'settings.json')),
    mcpJson: tolerantRead(path.join(repoDir, '.mcp.json')),
  });
  process.stdout.write(renderStatus(status, readPackageVersion()));
  return status.on ? 0 : 1;
}
