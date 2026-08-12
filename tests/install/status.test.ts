import { describe, expect, test } from 'vitest';
import { applyHookOn, buildHookEntry } from '../../src/engine/install/hook-edit.js';
import { applyMcpOn, buildMcpEntry } from '../../src/engine/install/mcp-edit.js';
import { computeStatus, renderStatus, type StatusInput } from '../../src/engine/install/status.js';

const NETGAIN = 'F:\\ngroot';
const REPO = 'D:\\scratch\\repo';

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

function fullOn(): StatusInput {
  return input({
    claudeJson: applyMcpOn(undefined, NETGAIN, REPO).value,
    settingsLocal: applyHookOn(undefined, NETGAIN).value,
  });
}

describe('computeStatus', () => {
  test('ON complet : MCP canonique + hook + dist présents, aucune note', () => {
    const s = computeStatus(fullOn());
    expect(s.on).toBe(true);
    expect(s.notes).toEqual([]);
  });

  test('OFF : rien nulle part', () => {
    const s = computeStatus(input());
    expect(s.on).toBe(false);
    expect(s.mcp.present).toBe(false);
    expect(s.hook.present).toBe(false);
  });

  test('partiel : MCP sans hook → pas ON', () => {
    const s = computeStatus(input({ claudeJson: applyMcpOn(undefined, NETGAIN, REPO).value }));
    expect(s.on).toBe(false);
    expect(s.mcp.present).toBe(true);
    expect(s.hook.present).toBe(false);
  });

  test('partiel : hook sans MCP → pas ON', () => {
    const s = computeStatus(input({ settingsLocal: applyHookOn(undefined, NETGAIN).value }));
    expect(s.on).toBe(false);
  });

  test('dist manquant → pas ON même avec les 2 entrées', () => {
    const s = computeStatus({ ...fullOn(), missingDist: ['dist/mcp/main.js'] });
    expect(s.on).toBe(false);
    expect(s.missingDist).toEqual(['dist/mcp/main.js']);
  });

  test('entrée portée par une variante non-canonique (backslash) → ON + note citant la clé', () => {
    const s = computeStatus(
      input({
        claudeJson: { projects: { 'D:\\scratch\\repo': { mcpServers: { 'netgain-map': buildMcpEntry(NETGAIN, REPO) } } } },
        settingsLocal: applyHookOn(undefined, NETGAIN).value,
      }),
    );
    expect(s.on).toBe(true);
    expect(s.notes.some((n) => n.includes('D:\\scratch\\repo'))).toBe(true);
  });

  test('strays ×4 : hook user, hook projet, MCP .mcp.json, MCP user-scope → 4 notes lecture seule, sans effet sur on', () => {
    const s = computeStatus({
      ...fullOn(),
      userSettings: { hooks: { UserPromptSubmit: [{ hooks: [buildHookEntry(NETGAIN)] }] } },
      projectSettings: { hooks: { UserPromptSubmit: [{ hooks: [buildHookEntry(NETGAIN)] }] } },
      mcpJson: { mcpServers: { 'netgain-map': { type: 'stdio' } } },
      claudeJson: {
        ...(applyMcpOn(undefined, NETGAIN, REPO).value as object),
        mcpServers: { 'netgain-map': { type: 'stdio' } },
      },
    });
    expect(s.on).toBe(true);
    expect(s.notes).toHaveLength(4);
    expect(s.notes.join('\n')).toContain('settings.json');
    expect(s.notes.join('\n')).toContain('.mcp.json');
    expect(s.notes.join('\n')).toContain('user');
  });

  test('structures illisibles côté status = lecture tolérante, jamais de throw', () => {
    const s = computeStatus(input({ claudeJson: { projects: 42 }, settingsLocal: { hooks: 'cassé' } }));
    expect(s.on).toBe(false);
    expect(s.mcp.present).toBe(false);
  });
});

describe('renderStatus', () => {
  test("ON : contient la version et les notes d'effet (MCP au prochain démarrage, hook à chaud)", () => {
    const text = renderStatus(computeStatus(fullOn()), '0.3.0');
    expect(text).toContain('netgain 0.3.0');
    expect(text).toContain('prochain démarrage');
    expect(text).toContain('à chaud');
    expect(text).toContain('ON');
    expect(text).not.toContain('saved');
  });

  test('OFF/partiel : verdict OFF affiché, dist manquant listé', () => {
    const text = renderStatus(computeStatus({ ...fullOn(), missingDist: ['dist/cli.js'] }), '0.3.0');
    expect(text).toContain('OFF');
    expect(text).toContain('dist/cli.js');
    expect(text).toContain('npm run build');
  });
});
