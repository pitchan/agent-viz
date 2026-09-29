// L'adaptateur Antigravity ne possède qu'une clé du hooks.json, « agent-viz » : tout
// autre nom de hook doit survivre à l'installation comme au retrait.
import { expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install, uninstall, audit } from '../../src/server/install-hooks/registry.ts';

interface Resultat {
  error?: string;
  action?: string;
  target?: { file: string };
  results?: Array<{ removed: number }>;
  audit?: Array<{ event: string; installed: boolean; stale: boolean; others: number }>;
}

function projet(prefixe: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefixe));
  fs.mkdirSync(path.join(root, '.git'));
  return root;
}

// Un faux paquet : resolveHookCommand ne choisit le mode « absolute » que si bin/agent-viz.js existe.
function paquet(prefixe: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefixe));
  fs.mkdirSync(path.join(root, 'bin'));
  fs.writeFileSync(path.join(root, 'bin', 'agent-viz.js'), '');
  return root;
}

const fichier = (root: string) => path.join(root, '.agents', 'hooks.json');
const lire = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('une installation neuve écrit la clé agent-viz, une commande par événement, sans guillemets', () => {
  // Arrange
  const root = projet('avtest-agy-neuf-');
  const pkg = paquet('avpkg-agy-');
  // Act
  const r = install({ target: 'antigravity', scope: 'project', cwd: root, packageRoot: pkg }).antigravity as Resultat;
  // Assert
  expect(r.error).toBe(undefined);
  const ecrit = lire(fichier(root));
  const pre = ecrit['agent-viz'].PreToolUse[0];
  expect(pre.matcher).toBe('*');
  expect(pre.hooks[0].command).toMatch(/^node \S+agent-viz\.js hook --source=antigravity --event=PreToolUse$/);
  expect(ecrit['agent-viz'].Stop[0].command).toMatch(/--event=Stop$/);
  expect(ecrit['agent-viz'].Stop[0].timeout).toBe(10);
});

test('les autres noms de hook du fichier survivent à l’installation', () => {
  // Arrange
  const root = projet('avtest-agy-tiers-');
  const tiers = { 'lint-checker': { PostToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command: './lint.sh' }] }] } };
  fs.mkdirSync(path.dirname(fichier(root)), { recursive: true });
  fs.writeFileSync(fichier(root), JSON.stringify(tiers));
  // Act
  install({ target: 'antigravity', scope: 'project', cwd: root, packageRoot: paquet('avpkg-agy-') });
  // Assert
  expect(lire(fichier(root))['lint-checker']).toEqual(tiers['lint-checker']);
});

test('une deuxième installation identique ne réécrit rien', () => {
  // Arrange
  const root = projet('avtest-agy-noop-');
  const pkg = paquet('avpkg-agy-');
  install({ target: 'antigravity', scope: 'project', cwd: root, packageRoot: pkg });
  // Act
  const r = install({ target: 'antigravity', scope: 'project', cwd: root, packageRoot: pkg }).antigravity as Resultat;
  // Assert
  expect(r.action).toBe('noop');
});

test('une commande périmée est signalée par l’audit', () => {
  // Arrange
  const root = projet('avtest-agy-stale-');
  const perime = { type: 'command', command: 'node /ancien/agent-viz.js hook --source=antigravity --event=Stop', timeout: 10 };
  fs.mkdirSync(path.dirname(fichier(root)), { recursive: true });
  fs.writeFileSync(fichier(root), JSON.stringify({ 'agent-viz': { Stop: [perime] } }));
  // Act
  const r = audit({ target: 'antigravity', scope: 'project', cwd: root, packageRoot: paquet('avpkg-agy-') }).antigravity as Resultat;
  // Assert
  const stop = r.audit!.find(l => l.event === 'Stop')!;
  expect(stop.installed).toBe(true);
  expect(stop.stale).toBe(true);
});

test('un fichier qui n’est pas un objet JSON est refusé, pas écrasé', () => {
  // Arrange
  const root = projet('avtest-agy-refus-');
  fs.mkdirSync(path.dirname(fichier(root)), { recursive: true });
  fs.writeFileSync(fichier(root), '[1, 2]');
  // Act
  const r = install({ target: 'antigravity', scope: 'project', cwd: root, packageRoot: paquet('avpkg-agy-') }).antigravity as Resultat;
  // Assert
  expect(r.error).toMatch(/refusing to overwrite/);
  expect(fs.readFileSync(fichier(root), 'utf8')).toBe('[1, 2]');
});

test('un chemin d’agent-viz qui contient une espace est refusé, chemin cité', () => {
  // Arrange
  const root = projet('avtest-agy-espace-');
  const pkg = paquet('avpkg agy espace-');
  // Act
  const r = install({ target: 'antigravity', scope: 'project', cwd: root, packageRoot: pkg }).antigravity as Resultat;
  // Assert
  expect(r.error).toMatch(/contains a space/);
  expect(r.error).toContain('avpkg agy espace-');
});

test('le retrait enlève notre clé et garde celles des autres', () => {
  // Arrange
  const root = projet('avtest-agy-retrait-');
  const tiers = { 'lint-checker': { Stop: [{ type: 'command', command: './lint.sh' }] } };
  fs.mkdirSync(path.dirname(fichier(root)), { recursive: true });
  fs.writeFileSync(fichier(root), JSON.stringify(tiers));
  install({ target: 'antigravity', scope: 'project', cwd: root, packageRoot: paquet('avpkg-agy-') });
  // Act
  uninstall({ target: 'antigravity', scope: 'project', cwd: root });
  // Assert
  expect(lire(fichier(root))).toEqual(tiers);
});

test('le retrait supprime un fichier qui ne portait que nous', () => {
  // Arrange
  const root = projet('avtest-agy-seul-');
  install({ target: 'antigravity', scope: 'project', cwd: root, packageRoot: paquet('avpkg-agy-') });
  // Act
  uninstall({ target: 'antigravity', scope: 'project', cwd: root });
  // Assert
  expect(fs.existsSync(fichier(root))).toBe(false);
});
