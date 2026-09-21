// api.ts — the observatory's HTTP client. These tests stub the global fetch
// so the query strings it builds (project, days, includeMachine) are checked
// without a real server.
import { expect, test } from 'vitest';
import { fetchSummary, fetchSessions, requestScan, requestPurge, fetchModelCosts, fetchSkillUsage, fetchPricing, acknowledgeAlert, setRecommendationStatus } from '../../src/web/observatory/api.ts';

// Chaque appel capturé garde url + opts tels que passés à fetch — `opts` reste
// `any` : c'est un stub de test, pas une implémentation de RequestInit.
interface FetchCall { url: string; opts: any; }

function stubFetch(body: unknown = {}) {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, opts: any) => {
    calls.push({ url, opts });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('fetchSummary with no window omits the query string', async () => {
  const { calls, restore } = stubFetch();
  try {
    await fetchSummary();
    expect(calls[0]!.url).toBe('/analysis/summary');
  } finally {
    restore();
  }
});

test('fetchSummary forwards days and includeMachine', async () => {
  const { calls, restore } = stubFetch();
  try {
    await fetchSummary({ days: 7, includeMachine: true });
    expect(calls[0]!.url).toBe('/analysis/summary?days=7&includeMachine=1');
  } finally {
    restore();
  }
});

test('fetchSessions forwards project together with the window', async () => {
  const { calls, restore } = stubFetch([]);
  try {
    await fetchSessions({ project: 'F--proj', days: 90, includeMachine: false });
    expect(calls[0]!.url).toBe('/analysis/sessions?days=90&project=F--proj');
  } finally {
    restore();
  }
});

test('requestScan forwards only days, as a POST', async () => {
  const { calls, restore } = stubFetch({ started: true });
  try {
    await requestScan({ days: 7 });
    expect(calls[0]!.url).toBe('/analysis/scan?days=7');
    expect(calls[0]!.opts.method).toBe('POST');
  } finally {
    restore();
  }
});

test('requestScan with no window omits the query string', async () => {
  const { calls, restore } = stubFetch({ started: true });
  try {
    await requestScan();
    expect(calls[0]!.url).toBe('/analysis/scan');
  } finally {
    restore();
  }
});

test('requestPurge posts to /analysis/purge with only days', async () => {
  const { calls, restore } = stubFetch({ purged: true, started: true });
  try {
    await requestPurge({ days: 30 });
    expect(calls[0]!.url).toBe('/analysis/purge?days=30');
    expect(calls[0]!.opts.method).toBe('POST');
  } finally {
    restore();
  }
});

test('fetchModelCosts forwards the window; no window means no query string', async () => {
  const { calls, restore } = stubFetch({ models: [] });
  try {
    await fetchModelCosts({ days: 30, includeMachine: true });
    await fetchModelCosts();
    expect(calls[0]!.url).toBe('/analysis/models?days=30&includeMachine=1');
    expect(calls[1]!.url).toBe('/analysis/models');
  } finally {
    restore();
  }
});

test('fetchPricing is window-independent', async () => {
  const { calls, restore } = stubFetch({ priceTable: { entries: [] } });
  try {
    await fetchPricing();
    expect(calls[0]!.url).toBe('/pricing');
  } finally {
    restore();
  }
});

test('acknowledgeAlert poste id et createdAt en corps JSON', async () => {
  const { calls, restore } = stubFetch({ ok: true });
  try {
    await acknowledgeAlert({ id: 'badInvocation:sid1:inv-x', createdAt: 1754700000000 });
    expect(calls[0]!.url).toBe('/alerts/ack');
    expect(calls[0]!.opts.method).toBe('POST');
    expect(calls[0]!.opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0]!.opts.body)).toEqual({ id: 'badInvocation:sid1:inv-x', createdAt: 1754700000000 });
  } finally {
    restore();
  }
});

test('setRecommendationStatus encode la raison d’arbitrage dans l’URL', async () => {
  // Arrange
  const { calls, restore } = stubFetch({ id: 3, status: 'arbitrated' });
  try {
    // Act
    await setRecommendationStatus(3, 'arbitrated', 'déjà pesé');
    // Assert
    expect(calls[0]!.url).toBe('/recommendations/3?status=arbitrated&reason=d%C3%A9j%C3%A0%20pes%C3%A9');
    expect(calls[0]!.opts.method).toBe('POST');
  } finally {
    restore();
  }
});

test('sans raison, l’URL de statut ne porte que le statut', async () => {
  // Arrange
  const { calls, restore } = stubFetch({ id: 3, status: 'new' });
  try {
    // Act
    await setRecommendationStatus(3, 'new');
    // Assert
    expect(calls[0]!.url).toBe('/recommendations/3?status=new');
  } finally {
    restore();
  }
});

// Non-regression : donner un corps a postJson ne doit pas en
// donner un aux POST existants — la route de scan n'en attend aucun.
test('requestScan et requestPurge continuent de poster SANS corps', async () => {
  const { calls, restore } = stubFetch({ started: true });
  try {
    await requestScan({ days: 7 });
    await requestPurge({ days: 7 });
    for (const { opts } of calls) {
      expect(opts.body).toBe(undefined);
      expect(opts.headers).toBe(undefined);
    }
  } finally {
    restore();
  }
});

test('fetchSkillUsage forwards the window; no window means no query string', async () => {
  // Arrange
  const { calls, restore } = stubFetch({ skills: [] });
  try {
    // Act
    await fetchSkillUsage({ days: 7, includeMachine: true });
    await fetchSkillUsage();
    // Assert
    expect(calls[0]!.url).toBe('/analysis/skills?days=7&includeMachine=1');
    expect(calls[1]!.url).toBe('/analysis/skills');
  } finally {
    restore();
  }
});
