// Codex lit un hooks.json de la forme du settings.json de Claude Code. Le cas de départ
// repris ici est réel : un fichier qui porte déjà la commande agent-viz, étiquetée claude.
import { expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install, uninstall, findInstalledScopes } from '../../src/server/install-hooks/registry.ts';
import { AGENT_CONFIG } from '../../src/server/install-hooks/config.ts';

interface HookLine { type: string; command: string; timeout?: number }
interface HooksFile { hooks: Record<string, Array<{ hooks: HookLine[] }>> }
interface CodexResult {
  error?: string;
  action?: string;
  backup?: string | null;
  results?: Array<{ removed: number }>;
}

const EVENEMENTS = AGENT_CONFIG.codex.events;
const MAL_ETIQUETEE = 'node "F:/DEV/agent-viz/bin/agent-viz.js" hook --source=claude';
const TIERS = 'echo hook-d-un-tiers';

function projet(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-codex-'));
  fs.mkdirSync(path.join(root, '.git'));
  return root;
}

function paquet(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-pkg-'));
}

function fichierProjet(root: string): string {
  return path.join(root, '.codex', 'hooks.json');
}

function ecrisMalEtiquete(root: string): void {
  const hooks: HooksFile['hooks'] = {};
  for (const ev of EVENEMENTS) hooks[ev] = [{ hooks: [{ type: 'command', command: MAL_ETIQUETEE, timeout: 5 }] }];
  hooks.PreToolUse!.push({ hooks: [{ type: 'command', command: TIERS }] });
  fs.mkdirSync(path.join(root, '.codex'), { recursive: true });
  fs.writeFileSync(fichierProjet(root), JSON.stringify({ hooks }, null, 2));
}

function lignes(root: string): HookLine[] {
  const contenu: HooksFile = JSON.parse(fs.readFileSync(fichierProjet(root), 'utf8'));
  return Object.values(contenu.hooks).flatMap(entrees => entrees.flatMap(e => e.hooks));
}

test('une commande agent-viz étiquetée claude dans le fichier de Codex est réécrite en codex', () => {
  // Arrange
  const root = projet();
  ecrisMalEtiquete(root);
  // Act
  const result = install({ target: 'codex', scope: 'project', cwd: root, packageRoot: paquet() }).codex as CodexResult;
  // Assert
  const notres = lignes(root).filter(l => l.command !== TIERS);
  expect(result.action).toBe('updated');
  expect(typeof result.backup, 'le fichier est copié avant d’être réécrit').toBe('string');
  expect(notres).toHaveLength(EVENEMENTS.length);
  for (const l of notres) {
    expect(l.command).toMatch(/ hook --source=codex$/);
    expect(l.timeout).toBe(10);
  }
});

test('le hook d’un tiers dans le fichier de Codex survit à l’installation', () => {
  // Arrange
  const root = projet();
  ecrisMalEtiquete(root);
  // Act
  install({ target: 'codex', scope: 'project', cwd: root, packageRoot: paquet() });
  // Assert
  expect(lignes(root).filter(l => l.command === TIERS)).toHaveLength(1);
});

test('sans fichier, l’installation crée un hook par événement de Codex', () => {
  // Arrange
  const root = projet();
  // Act
  const result = install({ target: 'codex', scope: 'project', cwd: root, packageRoot: paquet() }).codex as CodexResult;
  // Assert
  const contenu: HooksFile = JSON.parse(fs.readFileSync(fichierProjet(root), 'utf8'));
  expect(result.action).toBe('installed');
  expect(Object.keys(contenu.hooks).sort()).toEqual([...EVENEMENTS].sort());
});

test('--local demandé pour Codex est un refus nommé', () => {
  // Arrange
  const root = projet();
  // Act
  const result = install({ target: 'codex', scope: 'local', cwd: root, packageRoot: paquet() }).codex as CodexResult;
  // Assert
  expect(result.error).toMatch(/--local is not supported for codex/);
});

test('la désinstallation retire nos lignes du fichier de Codex et garde celle du tiers', () => {
  // Arrange
  const root = projet();
  const packageRoot = paquet();
  ecrisMalEtiquete(root);
  // Act
  uninstall({ target: 'codex', scope: 'project', cwd: root, packageRoot });
  // Assert
  expect(lignes(root).map(l => l.command)).toEqual([TIERS]);
});

test('le balayage des portées de Codex ne connaît pas de portée locale', () => {
  // Arrange
  const root = projet();
  const packageRoot = paquet();
  install({ target: 'codex', scope: 'project', cwd: root, packageRoot });
  // Act
  const portees = findInstalledScopes({ cwd: root, packageRoot, agent: 'codex' }).installed.map(s => s.scope);
  // Assert
  expect(portees).toContain('project');
  expect(portees).not.toContain('local');
});
