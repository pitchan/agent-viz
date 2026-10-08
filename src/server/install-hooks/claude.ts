// L'adaptateur Claude Code : la forme settings.json de la fabrique, plus la détection
// de l'agent sur la machine. Le registre (registry.ts) n'a besoin de rien savoir de plus.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentInstaller } from './types.ts';
import { EVENTS } from './config.ts';
import type { ClaudeSettings } from './settings-io.ts';
import { auditEvents, settingsInstaller } from './settings-installer.ts';
import { inPath } from './detect.ts';

export function auditSettings(
  settings: ClaudeSettings, desiredCommand: string | undefined,
): Array<{ event: string; installed: boolean; stale: boolean; others: number }> {
  return auditEvents(settings, EVENTS, desiredCommand);
}

export const claudeInstaller: AgentInstaller = {
  ...settingsInstaller('claude'),
  detect: home => inPath('claude') || fs.existsSync(path.join(home, '.claude', 'settings.json')),
};
