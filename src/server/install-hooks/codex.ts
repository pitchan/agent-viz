// L'adaptateur Codex : son hooks.json a la forme du settings.json de Claude Code, la
// fabrique s'y applique telle quelle. Reste ici la détection de l'agent sur la machine.
import path from 'node:path';
import type { AgentInstaller } from './types.ts';
import { settingsInstaller } from './settings-installer.ts';
import { inPath, dirHasFiles } from './detect.ts';

export const codexInstaller: AgentInstaller = {
  ...settingsInstaller('codex'),
  // Codex Desktop ne pose aucun exécutable dans le PATH : son dossier de configuration compte aussi.
  detect: home => inPath('codex') || dirHasFiles(path.join(home, '.codex')),
};
