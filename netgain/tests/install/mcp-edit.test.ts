import { describe, expect, test } from 'vitest';
import { InstallError } from '../../src/install/json-file.js';
import {
  applyMcpOff,
  applyMcpOn,
  buildMcpEntry,
  findProjectKeys,
  hasCanonicalMcp,
} from '../../src/install/mcp-edit.js';

const NETGAIN = 'F:\\DEV\\agent-viz\\netgain';
const REPO = 'D:\\scratch\\repo';
// clé canonique = POSIX : le format que lit/écrit Claude Code actuel (réfutation de l'hypothèse « natif » en essai réel)
const CANON = 'D:/scratch/repo';
const ENTRY = {
  type: 'stdio',
  command: 'node',
  args: ['F:/DEV/agent-viz/netgain/dist/mcp/main.js', 'D:/scratch/repo'],
};

describe('buildMcpEntry', () => {
  test('forme exacte : stdio, node, args en forward slashes (netgain puis repo)', () => {
    expect(buildMcpEntry(NETGAIN, REPO)).toEqual(ENTRY);
  });
});

describe('findProjectKeys', () => {
  test('retrouve toutes les variantes samePath (posix, backslash, casse)', () => {
    const root = {
      projects: {
        'D:/scratch/repo': {},
        'd:\\SCRATCH\\repo': {},
        'D:\\autre': {},
      },
    };
    expect(findProjectKeys(root, REPO)).toEqual(['D:/scratch/repo', 'd:\\SCRATCH\\repo']);
  });

  test('projects absent → aucune clé', () => {
    expect(findProjectKeys({}, REPO)).toEqual([]);
    expect(findProjectKeys(undefined, REPO)).toEqual([]);
  });

  test('projects non-objet → InstallError', () => {
    expect(() => findProjectKeys({ projects: 42 }, REPO)).toThrow(InstallError);
  });
});

describe('applyMcpOn', () => {
  test('depuis un fichier absent (undefined) : crée projects[clé CANONIQUE posix].mcpServers, changed', () => {
    const { value, changed } = applyMcpOn(undefined, NETGAIN, REPO);
    expect(changed).toBe(true);
    expect(value).toEqual({ projects: { [CANON]: { mcpServers: { 'netgain-map': ENTRY } } } });
  });

  test('préserve toutes les clés étrangères (top-level, projet, autres serveurs MCP)', () => {
    const root = {
      installMethod: 'native',
      projects: {
        [REPO]: {
          lastCost: 1.23,
          mcpServers: { 'mdb-explorer': { type: 'stdio', command: 'x' } },
        },
        'F:\\autre\\projet': { mcpServers: { 'netgain-map': { stale: true } } },
      },
    };
    const { value, changed } = applyMcpOn(root, NETGAIN, REPO);
    expect(changed).toBe(true);
    const projects = (value as any).projects;
    expect((value as any).installMethod).toBe('native');
    expect(projects[REPO].lastCost).toBe(1.23);
    expect(projects[REPO].mcpServers['mdb-explorer']).toEqual({ type: 'stdio', command: 'x' });
    expect(projects[CANON].mcpServers['netgain-map']).toEqual(ENTRY);
    // « F:\autre\projet » n'est PAS une variante de REPO : son netgain-map (autre repo) reste intact
    expect(projects['F:\\autre\\projet'].mcpServers['netgain-map']).toEqual({ stale: true });
  });

  test('idempotence : rejouer on ne change rien (changed:false)', () => {
    const first = applyMcpOn(undefined, NETGAIN, REPO);
    const second = applyMcpOn(first.value, NETGAIN, REPO);
    expect(second.changed).toBe(false);
    expect(second.value).toEqual(first.value);
  });

  test('upsert : des args périmés sous la clé canonique sont remplacés', () => {
    const root = {
      projects: { [CANON]: { mcpServers: { 'netgain-map': { type: 'stdio', command: 'node', args: ['C:/vieux/chemin/main.js', 'D:/scratch/repo'] } } } },
    };
    const { value, changed } = applyMcpOn(root, NETGAIN, REPO);
    expect(changed).toBe(true);
    expect((value as any).projects[CANON].mcpServers['netgain-map']).toEqual(ENTRY);
  });

  test('multi-variantes : converge vers la clé canonique et vide les variantes de NOTRE entrée seulement', () => {
    const root = {
      projects: {
        'd:\\SCRATCH\\repo': {
          mcpServers: { 'netgain-map': { stale: true }, etranger: { keep: 1 } },
        },
      },
    };
    const { value, changed } = applyMcpOn(root, NETGAIN, REPO);
    expect(changed).toBe(true);
    const projects = (value as any).projects;
    expect(projects[CANON].mcpServers['netgain-map']).toEqual(ENTRY);
    expect(projects['d:\\SCRATCH\\repo'].mcpServers['netgain-map']).toBeUndefined();
    expect(projects['d:\\SCRATCH\\repo'].mcpServers.etranger).toEqual({ keep: 1 });
  });

  test('racine non-objet → InstallError', () => {
    expect(() => applyMcpOn('pas un objet', NETGAIN, REPO)).toThrow(InstallError);
  });

  test('mcpServers non-objet → InstallError', () => {
    const root = { projects: { [REPO]: { mcpServers: 'cassé' } } };
    expect(() => applyMcpOn(root, NETGAIN, REPO)).toThrow(InstallError);
  });
});

describe('applyMcpOff', () => {
  test('purge notre entrée de TOUTES les variantes, étrangers intacts', () => {
    const root = {
      projects: {
        [REPO]: { lastCost: 2, mcpServers: { 'netgain-map': ENTRY, etranger: { keep: 1 } } },
        'D:/scratch/repo': { mcpServers: { 'netgain-map': { stale: true } } },
      },
    };
    const { value, changed } = applyMcpOff(root, REPO);
    expect(changed).toBe(true);
    const projects = (value as any).projects;
    expect(projects[REPO].mcpServers['netgain-map']).toBeUndefined();
    expect(projects[REPO].mcpServers.etranger).toEqual({ keep: 1 });
    expect(projects[REPO].lastCost).toBe(2);
    expect(projects['D:/scratch/repo'].mcpServers['netgain-map']).toBeUndefined();
  });

  test('idempotence : off sans entrée ne change rien (changed:false)', () => {
    expect(applyMcpOff({ projects: { [REPO]: { mcpServers: {} } } }, REPO).changed).toBe(false);
    expect(applyMcpOff(undefined, REPO).changed).toBe(false);
  });
});

describe('hasCanonicalMcp', () => {
  test('absent', () => {
    expect(hasCanonicalMcp({}, NETGAIN, REPO)).toEqual({ present: false, canonical: false, keys: [] });
  });

  test('présent canonique sous la clé posix', () => {
    const { value } = applyMcpOn(undefined, NETGAIN, REPO);
    expect(hasCanonicalMcp(value, NETGAIN, REPO)).toEqual({ present: true, canonical: true, keys: [CANON] });
  });

  test('présent sous une variante non-canonique (backslash) : present mais la clé le trahit', () => {
    const root = { projects: { [REPO]: { mcpServers: { 'netgain-map': ENTRY } } } };
    expect(hasCanonicalMcp(root, NETGAIN, REPO)).toEqual({
      present: true,
      canonical: false,
      keys: [REPO],
    });
  });

  test('présent mais args périmés : present sans être canonique', () => {
    const root = {
      projects: { [CANON]: { mcpServers: { 'netgain-map': { type: 'stdio', command: 'node', args: ['C:/vieux.js', 'D:/scratch/repo'] } } } },
    };
    expect(hasCanonicalMcp(root, NETGAIN, REPO)).toEqual({ present: true, canonical: false, keys: [CANON] });
  });
});
