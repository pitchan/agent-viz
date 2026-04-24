#!/usr/bin/env node
'use strict';
// Installe (ou désinstalle) les hooks agent-viz dans ~/.claude/settings.json.
// Idempotent : détecte si déjà présents, n'ajoute que ce qui manque.
//
// Usage :
//   node install-hooks.js            → check + install ce qui manque
//   node install-hooks.js --check    → n'écrit rien, renvoie juste l'état
//   node install-hooks.js --uninstall→ retire les hooks agent-viz

const fs = require('fs');
const path = require('path');
const os = require('os');

const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionStart'];
const HOOK_PATH = path.join(__dirname, 'hook.js').replace(/\\/g, '/');
const HOOK_CMD = `node "${HOOK_PATH}"`;
const MARKER = 'agent-viz/hook.js';
const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');

const mode = process.argv[2] || '--install';

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`settings.json invalide : ${e.message}`);
  }
}

function isAgentVizHook(h) {
  return h && h.type === 'command' && typeof h.command === 'string'
      && h.command.replace(/\\/g, '/').includes(MARKER);
}

function hasHookForEvent(settings, event) {
  const entries = settings.hooks?.[event] || [];
  return entries.some(entry => (entry.hooks || []).some(isAgentVizHook));
}

function auditSettings(settings) {
  return EVENTS.map(ev => ({ event: ev, installed: hasHookForEvent(settings, ev) }));
}

function addHook(settings, event) {
  settings.hooks ??= {};
  settings.hooks[event] ??= [];
  settings.hooks[event].push({
    hooks: [{ type: 'command', command: HOOK_CMD, timeout: 5 }],
  });
}

function removeHook(settings, event) {
  const arr = settings.hooks?.[event];
  if (!arr) return 0;
  let removed = 0;
  const kept = [];
  for (const entry of arr) {
    const filtered = (entry.hooks || []).filter(h => !isAgentVizHook(h));
    if (filtered.length !== (entry.hooks || []).length) removed++;
    if (filtered.length > 0) kept.push({ ...entry, hooks: filtered });
  }
  if (kept.length === 0) delete settings.hooks[event];
  else settings.hooks[event] = kept;
  return removed;
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
}

function main() {
  const settings = readSettings();
  const audit = auditSettings(settings);
  const missing = audit.filter(a => !a.installed).map(a => a.event);
  const present = audit.filter(a => a.installed).map(a => a.event);

  console.log(`settings.json : ${SETTINGS}`);
  console.log(`hook.js       : ${HOOK_PATH}`);
  console.log('');
  for (const { event, installed } of audit) {
    console.log(`  [${installed ? 'x' : ' '}] ${event}`);
  }
  console.log('');

  if (mode === '--check') {
    if (missing.length === 0) console.log('✓ Tous les hooks sont installés.');
    else console.log(`✗ Manquants : ${missing.join(', ')}`);
    process.exit(missing.length === 0 ? 0 : 1);
  }

  if (mode === '--uninstall') {
    let total = 0;
    for (const ev of EVENTS) total += removeHook(settings, ev);
    if (total === 0) { console.log('Rien à retirer.'); return; }
    writeSettings(settings);
    console.log(`✓ ${total} hook(s) agent-viz retiré(s).`);
    return;
  }

  if (missing.length === 0) {
    console.log('✓ Déjà installé — rien à faire.');
    return;
  }
  for (const ev of missing) addHook(settings, ev);
  writeSettings(settings);
  console.log(`✓ Ajouté sur : ${missing.join(', ')}`);
  if (present.length > 0) console.log(`  (déjà présent sur : ${present.join(', ')})`);
  console.log('\n→ Ouvre /hooks dans Claude Code (ou relance) pour que la config soit rechargée.');
}

try { main(); }
catch (e) { console.error('Erreur :', e.message); process.exit(2); }
