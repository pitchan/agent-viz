// SQLite store: schema, round-trips, the incremental-scan key and freshness.

import { expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openStore } from '../../src/server/observatory/store.ts';
import type { SessionRow } from '../../src/server/observatory/store.ts';
import { SCAN_VERSION } from '../../src/server/observatory/scan-version.ts';

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-store-'));
  return { store: openStore(path.join(dir, 'nested', 'observatory.db')), dir };
}
const cleanup = (h: ReturnType<typeof tmpStore>) => { h.store.close(); fs.rmSync(h.dir, { recursive: true, force: true }); };

const ROW: SessionRow = {
  id: 'sess-1', project: 'F--proj', transcriptPath: 'F:\\p\\sess-1.jsonl',
  fileMtime: 1000, fileSize: 2048, scanVersion: SCAN_VERSION,
  startedAt: '2026-07-01T10:00:00.000Z', endedAt: '2026-07-01T10:30:00.000Z',
  modelMain: 'claude-opus-4-8', netTokens: 5000, costUsd: 0.42, costComplete: true,
  reportJson: '{"sessionId":"sess-1"}',
  sessionKind: 'interactive',
};

test('openStore creates missing parent directories and a usable schema', () => {
  const h = tmpStore();
  try {
    expect(h.store.listSessions({})).toEqual([]);
    expect(h.store.listConfigItems()).toEqual([]);
    expect(h.store.listRecommendations({})).toEqual([]);
  } finally { cleanup(h); }
});

test('upsertSession round-trips every column, costComplete stays boolean', () => {
  const h = tmpStore();
  try {
    h.store.upsertSession(ROW);
    expect(h.store.getSession('sess-1')).toEqual(ROW);
  } finally { cleanup(h); }
});

test('upsertSession is idempotent — same id updates, never duplicates', () => {
  const h = tmpStore();
  try {
    h.store.upsertSession(ROW);
    h.store.upsertSession({ ...ROW, netTokens: 9999 });
    expect(h.store.listSessions({}).length).toBe(1);
    expect(h.store.getSession('sess-1')!.netTokens).toBe(9999);
  } finally { cleanup(h); }
});

test('needsScan: unchanged path+mtime+size+scanVersion means skip', () => {
  const h = tmpStore();
  try {
    const ref = { sessionId: 'sess-1', mainPath: ROW.transcriptPath!, mtime: new Date(1000), sizeBytes: 2048 };
    expect(h.store.needsScan(ref, SCAN_VERSION), 'unknown session must be scanned').toBe(true);
    h.store.upsertSession(ROW);
    expect(h.store.needsScan(ref, SCAN_VERSION), 'unchanged session must be skipped').toBe(false);
    expect(h.store.needsScan({ ...ref, mtime: new Date(2000) }, SCAN_VERSION), 'newer mtime rescans').toBe(true);
    expect(h.store.needsScan({ ...ref, sizeBytes: 4096 }, SCAN_VERSION), 'new size rescans').toBe(true);
    expect(h.store.needsScan({ ...ref, mainPath: 'F:\\other.jsonl' }, SCAN_VERSION), 'moved file rescans').toBe(true);
    expect(h.store.needsScan(ref, SCAN_VERSION + 1), 'bumped scan version rescans everything').toBe(true);
  } finally { cleanup(h); }
});

test('listSessions filters by project and by since, newest first', () => {
  const h = tmpStore();
  try {
    h.store.upsertSession(ROW);
    h.store.upsertSession({ ...ROW, id: 'sess-2', project: 'F--other', startedAt: '2026-07-10T10:00:00.000Z' });
    expect(h.store.listSessions({ project: 'F--other' }).map(s => s.id)).toEqual(['sess-2']);
    expect(h.store.listSessions({ since: '2026-07-05T00:00:00.000Z' }).map(s => s.id)).toEqual(['sess-2']);
    expect(h.store.listSessions({}).map(s => s.id)).toEqual(['sess-2', 'sess-1']);
  } finally { cleanup(h); }
});

test('replaceConfigItems swaps the whole inventory in one shot', () => {
  const h = tmpStore();
  try {
    h.store.replaceConfigItems('2026-07-01T00:00:00.000Z', [
      { kind: 'mcp', name: 'mdb-explorer', scope: 'user', detail: { toolCount: 9 } },
    ]);
    h.store.replaceConfigItems('2026-07-02T00:00:00.000Z', [
      { kind: 'skill', name: 'pdf', scope: 'user', detail: { bytes: 1200 } },
    ]);
    expect(h.store.listConfigItems()).toEqual([{ kind: 'skill', name: 'pdf', scope: 'user', detail: { bytes: 1200 } }]);
  } finally { cleanup(h); }
});

const REC = {
  ruleId: 'R3', subject: 'Bash:npm test', title: 'Sortie volumineuse répétée',
  category: 'outils', confidence: 'fait', estimatedCostUsd: 1.25,
  costBasis: 'octets-approx-4o-par-jeton', evidence: { sessions: ['sess-1'], bytes: 900000 },
  action: 'Cibler la commande',
  periodFrom: '2026-07-04T00:00:00.000Z', periodTo: '2026-08-03T00:00:00.000Z',
};

test('upsertRecommendations keeps identity on (ruleId, subject) and preserves status', () => {
  const h = tmpStore();
  try {
    h.store.upsertRecommendations([REC], '2026-07-01T00:00:00.000Z');
    const first = h.store.listRecommendations({})[0]!;
    expect(first.status).toBe('new');
    expect(first.estimatedCostUsd).toBe(1.25);
    expect(first.costAtStatusUsd).toBe(null);
    expect(first.lastSeenAt).toBe('2026-07-01T00:00:00.000Z');

    expect(h.store.setRecommendationStatus(first.id, 'ignored', '2026-07-02T00:00:00.000Z')).toBe(true);
    expect(h.store.listRecommendations({ status: 'ignored' })[0]!.costAtStatusUsd, 'cost is frozen at decision time').toBe(1.25);

    h.store.upsertRecommendations([{ ...REC, estimatedCostUsd: 3 }], '2026-07-03T00:00:00.000Z');
    const all = h.store.listRecommendations({});
    expect(all.length, 'same rule+subject must not duplicate').toBe(1);
    expect(all[0]!.status, 'a rescan never resurrects a decision').toBe('ignored');
    expect(all[0]!.estimatedCostUsd, 'but the cost is refreshed').toBe(3);
    expect(all[0]!.costAtStatusUsd).toBe(1.25);
    expect(all[0]!.lastSeenAt, 'freshness moves forward').toBe('2026-07-03T00:00:00.000Z');
  } finally { cleanup(h); }
});

test('a recommendation the latest scan did not re-emit keeps its older lastSeenAt', () => {
  const h = tmpStore();
  try {
    h.store.upsertRecommendations([REC, { ...REC, subject: 'Bash:ls' }], '2026-07-01T00:00:00.000Z');
    h.store.upsertRecommendations([REC], '2026-07-05T00:00:00.000Z');
    const seen = Object.fromEntries(h.store.listRecommendations({}).map(r => [r.subject, r.lastSeenAt]));
    expect(seen['Bash:npm test']).toBe('2026-07-05T00:00:00.000Z');
    expect(seen['Bash:ls'], 'stale rows keep their old date, they are not deleted').toBe('2026-07-01T00:00:00.000Z');
  } finally { cleanup(h); }
});

test('setRecommendationStatus returns false for an unknown id', () => {
  const h = tmpStore();
  try {
    expect(h.store.setRecommendationStatus(999, 'accepted', '2026-07-02T00:00:00.000Z')).toBe(false);
  } finally { cleanup(h); }
});

test('scan state round-trips per claude dir', () => {
  const h = tmpStore();
  try {
    expect(h.store.getScanState('C:\\Users\\x\\.claude')).toBe(null);
    h.store.setScanState('C:\\Users\\x\\.claude', '2026-07-01T00:00:00.000Z', '0.11.0');
    expect(h.store.getScanState('C:\\Users\\x\\.claude')).toEqual({ lastScanAt: '2026-07-01T00:00:00.000Z', engineVersion: '0.11.0' });
  } finally { cleanup(h); }
});

test('listSessions filters by kinds; NULL kind never passes a kind filter', () => {
  const h = tmpStore();
  try {
    h.store.upsertSession({ ...ROW, id: 'k1', sessionKind: 'interactive' });
    h.store.upsertSession({ ...ROW, id: 'k2', sessionKind: 'headless' });
    h.store.upsertSession({ ...ROW, id: 'k3', sessionKind: null });
    expect(h.store.listSessions({ kinds: ['interactive'] }).map(s => s.id)).toEqual(['k1']);
    expect(h.store.listSessions({ kinds: ['interactive', 'headless'] }).map(s => s.id).sort()).toEqual(['k1', 'k2']);
    expect(h.store.listSessions({}).length, 'no filter still returns everything').toBe(3);
  } finally { cleanup(h); }
});

test('countByKind groups per kind and counts NULL as unknown', () => {
  const h = tmpStore();
  try {
    h.store.upsertSession({ ...ROW, id: 'c1', sessionKind: 'interactive' });
    h.store.upsertSession({ ...ROW, id: 'c2', sessionKind: 'headless' });
    h.store.upsertSession({ ...ROW, id: 'c3', sessionKind: 'headless' });
    h.store.upsertSession({ ...ROW, id: 'c4', sessionKind: null });
    expect(h.store.countByKind({})).toEqual({ interactive: 1, headless: 2, unknown: 1 });
    expect(h.store.countByKind({ since: '2027-01-01T00:00:00.000Z' })).toEqual({ interactive: 0, headless: 0, unknown: 0 });
  } finally { cleanup(h); }
});

test('recommendations round-trip their period and refresh it on upsert', () => {
  const h = tmpStore();
  try {
    h.store.upsertRecommendations([REC], '2026-08-03T00:00:00.000Z');
    const first = h.store.listRecommendations({})[0]!;
    expect(first.periodFrom).toBe(REC.periodFrom);
    expect(first.periodTo).toBe(REC.periodTo);

    h.store.upsertRecommendations(
      [{ ...REC, periodFrom: '2026-07-28T00:00:00.000Z', periodTo: '2026-08-04T00:00:00.000Z' }],
      '2026-08-04T00:00:00.000Z');
    const after = h.store.listRecommendations({})[0]!;
    expect(after.periodFrom, 'the period follows the latest scan').toBe('2026-07-28T00:00:00.000Z');
  } finally { cleanup(h); }
});

test('purge empties every table and the store stays usable', () => {
  const h = tmpStore();
  try {
    h.store.upsertSession(ROW);
    h.store.replaceConfigItems('2026-08-04T00:00:00.000Z',
      [{ kind: 'mcp', name: 'x', scope: 'user', detail: {} }]);
    h.store.upsertRecommendations([{
      ruleId: 'r1', subject: 's', title: 't', category: 'c', confidence: 'haute',
      estimatedCostUsd: 1, costBasis: 'b', periodFrom: 'f', periodTo: 'to',
      evidence: {}, action: 'a',
    }], '2026-08-04T00:00:00.000Z');
    h.store.setScanState('C:\\claude', '2026-08-04T00:00:00.000Z', '0.12.0');

    h.store.purge();

    expect(h.store.listSessions({})).toEqual([]);
    expect(h.store.listConfigItems()).toEqual([]);
    expect(h.store.listRecommendations({})).toEqual([]);
    expect(h.store.getScanState('C:\\claude')).toBe(null);
    h.store.upsertSession(ROW);
    expect(h.store.listSessions({}).length).toBe(1);
  } finally { cleanup(h); }
});

// ─── Statut « arbitré » : raison et date portées par le même rail ───────────

test('une recommandation neuve n’a ni raison ni date de statut', () => {
  const h = tmpStore();
  try {
    // Arrange — rien de plus que le magasin vide.
    // Act
    h.store.upsertRecommendations([REC], '2026-07-01T00:00:00.000Z');
    // Assert
    const first = h.store.listRecommendations({})[0]!;
    expect(first.statusReason).toBe(null);
    expect(first.statusAt).toBe(null);
  } finally { cleanup(h); }
});

test('un arbitrage consigne la raison, la date, et fige le coût', () => {
  const h = tmpStore();
  try {
    // Arrange
    h.store.upsertRecommendations([REC], '2026-07-01T00:00:00.000Z');
    const first = h.store.listRecommendations({})[0]!;
    // Act
    const ok = h.store.setRecommendationStatus(first.id, 'arbitrated',
      '2026-07-02T00:00:00.000Z', 'tests vérifiés hors session, au terminal');
    // Assert
    expect(ok).toBe(true);
    const row = h.store.listRecommendations({ status: 'arbitrated' })[0]!;
    expect(row.status).toBe('arbitrated');
    expect(row.statusReason).toBe('tests vérifiés hors session, au terminal');
    expect(row.statusAt).toBe('2026-07-02T00:00:00.000Z');
    expect(row.costAtStatusUsd, 'le coût est figé au moment de l’arbitrage').toBe(1.25);
  } finally { cleanup(h); }
});

test('un rescan ne touche ni la raison ni la date d’arbitrage', () => {
  const h = tmpStore();
  try {
    // Arrange
    h.store.upsertRecommendations([REC], '2026-07-01T00:00:00.000Z');
    const first = h.store.listRecommendations({})[0]!;
    h.store.setRecommendationStatus(first.id, 'arbitrated',
      '2026-07-02T00:00:00.000Z', 'déjà pesé');
    // Act
    h.store.upsertRecommendations([{ ...REC, estimatedCostUsd: 3 }], '2026-07-03T00:00:00.000Z');
    // Assert
    const row = h.store.listRecommendations({})[0]!;
    expect(row.status, 'un rescan ne ressuscite pas une décision').toBe('arbitrated');
    expect(row.statusReason).toBe('déjà pesé');
    expect(row.statusAt).toBe('2026-07-02T00:00:00.000Z');
    expect(row.lastSeenAt, 'la fraîcheur, elle, avance').toBe('2026-07-03T00:00:00.000Z');
  } finally { cleanup(h); }
});

test('le retour à new efface la raison et date le geste', () => {
  const h = tmpStore();
  try {
    // Arrange
    h.store.upsertRecommendations([REC], '2026-07-01T00:00:00.000Z');
    const first = h.store.listRecommendations({})[0]!;
    h.store.setRecommendationStatus(first.id, 'arbitrated',
      '2026-07-02T00:00:00.000Z', 'déjà pesé');
    // Act
    h.store.setRecommendationStatus(first.id, 'new', '2026-07-04T00:00:00.000Z');
    // Assert
    const row = h.store.listRecommendations({})[0]!;
    expect(row.status).toBe('new');
    expect(row.statusReason, 'la raison ne survit pas à la réactivation').toBe(null);
    expect(row.statusAt).toBe('2026-07-04T00:00:00.000Z');
  } finally { cleanup(h); }
});

test('les statuts existants datent aussi statusAt, sans raison', () => {
  const h = tmpStore();
  try {
    // Arrange
    h.store.upsertRecommendations([REC], '2026-07-01T00:00:00.000Z');
    const first = h.store.listRecommendations({})[0]!;
    // Act
    h.store.setRecommendationStatus(first.id, 'ignored', '2026-07-02T00:00:00.000Z');
    // Assert
    const row = h.store.listRecommendations({})[0]!;
    expect(row.statusAt).toBe('2026-07-02T00:00:00.000Z');
    expect(row.statusReason).toBe(null);
  } finally { cleanup(h); }
});

test('a null action survives the store round-trip', () => {
  const h = tmpStore();
  try {
    h.store.upsertRecommendations([{
      ruleId: 'r1', subject: 's', title: 't', category: 'c', confidence: 'fait',
      estimatedCostUsd: 1, costBasis: 'b', periodFrom: 'f', periodTo: 'to',
      evidence: {}, action: null,
    }], '2026-08-04T00:00:00.000Z');
    expect(h.store.listRecommendations({})[0]!.action).toBe(null);
  } finally { cleanup(h); }
});
