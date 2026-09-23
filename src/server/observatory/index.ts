'use strict';
// Composition root: the only file that binds the observatory service to real
// paths, the real filesystem, the real clock and the real SSE transport.
// Everything else receives them.

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveClaudeDir, resolveClaudeJsonPath } from '../../engine/core/claude-dir.ts';
import { openStore } from './store.ts';
import { engine } from './engine.ts';
import { collectConfigItems } from './config-audit.ts';
import { createObservatoryService } from './service.ts';
import { broadcastSSE } from '../sse.ts';
import { applyAdoptedPrices } from '../pricing-state.ts';
import { driftFor, driftSnapshot, forgetDrift, loadPricing } from '../pricing.ts';
import { createPriceAdoption } from '../price-adoption.ts';
import { adoptedPricesPath, readAdoptedPrices } from '../../engine/core/adopted-prices.ts';

const DB_PATH = path.join(os.homedir(), '.agent-viz', 'observatory.db');
const PRICES_PATH = adoptedPricesPath(os.homedir());
const DEFAULT_SINCE_DAYS = 30;
const SCAN_SINCE_DAYS = 90; // widest offered window — persistence always covers it

let _service: ReturnType<typeof createObservatoryService> | null = null;

function getObservatoryService(): ReturnType<typeof createObservatoryService> {
  if (_service) return _service;
  // La MÊME résolution que celle du moteur, pas une expression jumelle : les deux
  // s'étaient déjà écartées une fois, sur la variable posée mais vide, sans que
  // rien ne le signale.
  const claudeDir: string = resolveClaudeDir();
  _service = createObservatoryService({
    store: openStore(DB_PATH),
    engine,
    collectConfig: () => collectConfigItems(
      { readFile: fsp.readFile, readdir: fsp.readdir },
      // `.claude.json` suit la MÊME variable, mais pas de la même façon : posée,
      // Claude Code écrit le fichier DANS le dossier ; absente, à côté du home.
      // Vérifié en exécutant Claude Code 2.1.226 sur les deux branches.
      { claudeDir, claudeJsonPath: resolveClaudeJsonPath() }),
    broadcast: broadcastSSE,
    adoptPrice: createPriceAdoption({
      driftFor, forgetDrift,
      read: () => readAdoptedPrices(PRICES_PATH, fsp.readFile),
      write: async (adopted) => {
        await fsp.mkdir(path.dirname(PRICES_PATH), { recursive: true });
        await fsp.writeFile(PRICES_PATH, `${JSON.stringify(adopted, null, 2)}\n`, 'utf8');
      },
      apply: applyAdoptedPrices,
      now: () => new Date(),
    }).adopt,
    vigie: { snapshot: driftSnapshot, refresh: loadPricing },
    now: () => new Date(),
    claudeDir,
    sinceDays: DEFAULT_SINCE_DAYS,
    scanSinceDays: SCAN_SINCE_DAYS,
  });
  return _service;
}

export { getObservatoryService, DB_PATH, DEFAULT_SINCE_DAYS, SCAN_SINCE_DAYS };
