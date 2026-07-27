'use strict';
// Composition root: the only file that binds the observatory service to real
// paths, the real filesystem, the real clock and the real SSE transport.
// Everything else receives them.

const fsp = require('fs').promises;
const os = require('os');
const path = require('path');

const { openStore } = require('./store');
const { loadEngine } = require('./engine');
const { collectConfigItems } = require('./config-audit');
const { createObservatoryService } = require('./service');
const { broadcastSSE } = require('../sse');

const DB_PATH = path.join(os.homedir(), '.agent-viz', 'observatory.db');
const DEFAULT_SINCE_DAYS = 30;

let _service = null;

function getObservatoryService() {
  if (_service) return _service;
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  _service = createObservatoryService({
    store: openStore(DB_PATH),
    loadEngine,
    collectConfig: () => collectConfigItems(
      { readFile: fsp.readFile, readdir: fsp.readdir },
      { claudeDir, claudeJsonPath: path.join(os.homedir(), '.claude.json') }),
    broadcast: broadcastSSE,
    now: () => new Date(),
    claudeDir,
    sinceDays: DEFAULT_SINCE_DAYS,
  });
  return _service;
}

module.exports = { getObservatoryService, DB_PATH, DEFAULT_SINCE_DAYS };
