'use strict';
// Composition root: the only file that binds the observatory service to real
// paths, the real filesystem, the real clock and the real SSE transport.
// Everything else receives them.

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveClaudeDir, resolveClaudeJsonPath } from '../claude-dir.js';
import { openStore } from './store.js';
import { loadEngine } from './engine.js';
import { collectConfigItems } from './config-audit.js';
import { createObservatoryService } from './service.js';
import { broadcastSSE } from '../sse.js';

const DB_PATH = path.join(os.homedir(), '.agent-viz', 'observatory.db');
const DEFAULT_SINCE_DAYS = 30;
const SCAN_SINCE_DAYS = 90; // widest offered window — persistence always covers it

let _service = null;

function getObservatoryService() {
  if (_service) return _service;
  // C5 : la MÊME résolution que celle du moteur, pas une expression jumelle.
  // Les deux s'étaient déjà écartées une fois — sur la variable posée mais vide —
  // sans que rien ne le signale.
  const claudeDir = resolveClaudeDir();
  _service = createObservatoryService({
    store: openStore(DB_PATH),
    loadEngine,
    collectConfig: () => collectConfigItems(
      { readFile: fsp.readFile, readdir: fsp.readdir },
      // `.claude.json` suit la MÊME variable, mais pas de la même façon : posée,
      // Claude Code écrit le fichier DANS le dossier ; absente, à côté du home.
      // Vérifié en exécutant Claude Code 2.1.226 sur les deux branches.
      { claudeDir, claudeJsonPath: resolveClaudeJsonPath() }),
    broadcast: broadcastSSE,
    now: () => new Date(),
    claudeDir,
    sinceDays: DEFAULT_SINCE_DAYS,
    scanSinceDays: SCAN_SINCE_DAYS,
  });
  return _service;
}

export { getObservatoryService, DB_PATH, DEFAULT_SINCE_DAYS, SCAN_SINCE_DAYS };
