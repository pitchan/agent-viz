#!/usr/bin/env node
'use strict';
// Façade du sous-système d'installation de crochets — le corps vit dans
// src/server/install-hooks/ (doc/43 du dépôt privé). Chemin et exports FIGÉS :
// bin/agent-viz.js importe dist/server/install-hooks.js par chemin écrit en
// dur, et les tests consomment _internals / EVENTS. Le bloc main garde le
// module exécutable en direct :
//   node dist/server/install-hooks.js [--user|--project|--local] [--check|--uninstall]
import { fileURLToPath } from 'node:url';
import { EVENTS, eventsFor } from './install-hooks/config.ts';
import {
  isAgentVizHook, isStandardShape, readSettings, writeSettings, addHook,
  removeHook, hasHookForEvent, inspectEvent, refreshStaleCommand,
} from './install-hooks/settings-io.ts';
import { resolveScope, resolveHookCommand, findProjectRoot, ensureGitignore } from './install-hooks/scopes.ts';
import { auditSettings } from './install-hooks/claude.ts';
import {
  detectAgents, install, uninstall, audit, installedScopes, findInstalledScopes,
} from './install-hooks/registry.ts';
import { cliMain } from './install-hooks/cli.ts';

// Couture de test — mêmes 9 clés, mêmes fonctions qu'avant le découpage.
const _internals = {
  readSettings, writeSettings, auditSettings, addHook, removeHook,
  hasHookForEvent, inspectEvent, refreshStaleCommand, eventsFor,
};

export {
  EVENTS,
  isAgentVizHook,
  isStandardShape,
  detectAgents,
  install,
  uninstall,
  audit,
  installedScopes,
  findInstalledScopes,
  resolveScope,
  resolveHookCommand,
  findProjectRoot,
  ensureGitignore,
  _internals,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { cliMain(process.argv.slice(2)); }
  catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('Erreur :', message);
    process.exit(2);
  }
}
