import { describe, expect, test } from 'vitest';
import { applyHookOn } from '../../src/install/hook-edit.js';
import { applyMcpOn } from '../../src/install/mcp-edit.js';
import { computeStatus, renderStatus, type StatusInput } from '../../src/install/status.js';

// Racine SANS le mot « netgain » : la commande souhaitée ne porte donc PAS la queue
// d'avant la fusion — c'est l'état d'après la tâche 3, celui qui arme le prédicat.
const NETGAIN = 'F:\\ngroot';
const REPO = 'D:\\scratch\\repo';
const CLE_CANONIQUE = 'D:/scratch/repo';

// Les deux enregistrements d'AVANT la fusion, sous leur forme littérale.
const HOOK_PERIME = 'node C:/vieux/netgain/dist/cli.js router-hook';
const MCP_PERIME = 'C:/vieux/netgain/dist/mcp/main.js';
// Leurs jumeaux d'APRÈS la fusion : même racine, sortie de build déplacée. La racine
// garde le mot « netgain », de sorte que ces deux-là restent nôtres même sans la queue
// d'après-fusion ajoutée à isNetgainRouterHook (T10 ne doit pas dépendre de T7).
const HOOK_APRES = 'node C:/vieux/netgain/dist/engine/cli.js router-hook';
const MCP_APRES = 'C:/vieux/netgain/dist/engine/mcp/main.js';

function settingsAvec(command: string): unknown {
  return { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command, timeout: 10 }] }] } };
}

function serveursAvec(arg0: string): unknown {
  return { 'netgain-map': { type: 'stdio', command: 'node', args: [arg0, CLE_CANONIQUE] } };
}

function input(over: Partial<StatusInput> = {}): StatusInput {
  return {
    netgainRoot: NETGAIN,
    repoDir: REPO,
    claudeJson: undefined,
    settingsLocal: undefined,
    missingDist: [],
    ...over,
  };
}

/** Installation canonique et saine : MCP + hook posés par le produit lui-même. */
function sain(): StatusInput {
  return input({
    claudeJson: applyMcpOn(undefined, NETGAIN, REPO).value,
    settingsLocal: applyHookOn(undefined, NETGAIN).value,
  });
}

/** Les QUATRE scopes hors portée de on/off (D7), chacun avec sa façon de semer une entrée. */
const HORS_PORTEE: {
  nom: string;
  avant: string;
  apres: string;
  pose: (chemin: string) => Partial<StatusInput>;
}[] = [
  {
    nom: 'hook user (~/.claude/settings.json)',
    avant: HOOK_PERIME,
    apres: HOOK_APRES,
    pose: (c) => ({ userSettings: settingsAvec(c) }),
  },
  {
    nom: 'hook projet (.claude/settings.json)',
    avant: HOOK_PERIME,
    apres: HOOK_APRES,
    pose: (c) => ({ projectSettings: settingsAvec(c) }),
  },
  {
    nom: 'MCP projet (.mcp.json)',
    avant: MCP_PERIME,
    apres: MCP_APRES,
    pose: (c) => ({ mcpJson: { mcpServers: serveursAvec(c) } }),
  },
  {
    nom: 'MCP user (mcpServers racine de ~/.claude.json)',
    avant: MCP_PERIME,
    apres: MCP_APRES,
    pose: (c) => ({ claudeJson: { ...(sain().claudeJson as object), mcpServers: serveursAvec(c) } }),
  },
];

describe('computeStatus face à un enregistrement d avant la fusion', () => {
  test('T5 — hook ET MCP présents mais périmés : on:false, et preFusion porte les DEUX entrées', () => {
    // Arrange
    const entree = input({
      settingsLocal: settingsAvec(HOOK_PERIME),
      claudeJson: { projects: { [CLE_CANONIQUE]: { mcpServers: serveursAvec(MCP_PERIME) } } },
    });

    // Act
    const status = computeStatus(entree);

    // Assert
    expect(status.hook.present).toBe(true);
    expect(status.mcp.present).toBe(true);
    expect(status.preFusion).toEqual([HOOK_PERIME, MCP_PERIME]);
    expect(status.on).toBe(false);
  });

  test('T6 — renderStatus nomme l enregistrement périmé ET la commande de réparation, préfixés ✗', () => {
    // Arrange
    const entree = input({ settingsLocal: settingsAvec(HOOK_PERIME) });

    // Act
    const texte = renderStatus(computeStatus(entree), '0.3.0');

    // Assert
    const ligne = texte.split('\n').find((l) => l.includes(HOOK_PERIME));
    expect(ligne).toContain('✗');
    expect(ligne).not.toContain('⚠');
    expect(ligne).toContain('netgain on');
  });
});

describe('les quatre scopes hors portée de on/off (D7)', () => {
  test('T9 — une entrée d avant la fusion dans CHACUN des quatre : on reste true, preFusion vide, et la note ⚠ la nomme', () => {
    // Arrange
    const entrees = HORS_PORTEE.map((scope) => ({ ...sain(), ...scope.pose(scope.avant) }));

    // Act
    const resultats = entrees.map((entree) => computeStatus(entree));

    // Assert
    resultats.forEach((status, i) => {
      const scope = HORS_PORTEE[i]!;
      expect(status.on, scope.nom).toBe(true); // on:true ⇔ exit 0 (index.ts:125)
      expect(status.preFusion, scope.nom).toEqual([]);
      expect(status.notes, scope.nom).toHaveLength(1);
      expect(status.notes[0], scope.nom).toContain('d AVANT la fusion');
      expect(status.notes[0], scope.nom).toContain(scope.avant);
      expect(status.notes[0], scope.nom).toContain('hors portée de on/off');
    });
  });

  test('T10 — contrôle négatif : un chemin d APRÈS la fusion dans les quatre produit la note ORDINAIRE', () => {
    // Arrange
    const entrees = HORS_PORTEE.map((scope) => ({ ...sain(), ...scope.pose(scope.apres) }));

    // Act
    const resultats = entrees.map((entree) => computeStatus(entree));

    // Assert
    resultats.forEach((status, i) => {
      const scope = HORS_PORTEE[i]!;
      expect(status.on, scope.nom).toBe(true);
      expect(status.notes, scope.nom).toHaveLength(1);
      expect(status.notes[0], scope.nom).not.toContain('AVANT la fusion');
      expect(status.notes[0], scope.nom).toContain('hors portée de on/off');
    });
  });
});
