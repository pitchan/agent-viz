'use strict';
// UNIFICATION (2026-08-05): one price table for the whole product. The static
// FALLBACK is the offline mirror of the engine's embedded table — this file
// turns the "they are identical" guarantee from a manual check into a test
// that breaks. Requires the npm-linked engine, like the contract test.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { _FALLBACK, applyEnginePrices, getPrice, _setPricesForTest } = require('../../lib/server/pricing');
const { computeCost } = require('../../lib/server/pricing-engine');
const { loadEngine } = require('../../lib/server/observatory/engine');

test('FALLBACK mirrors the engine table: rates, labels, context windows, dated periods', async () => {
  const { priceTable } = await loadEngine();
  const table = priceTable();
  assert.equal(Object.keys(_FALLBACK).length, table.entries.length);
  for (const e of table.entries) {
    const f = _FALLBACK[e.model];
    assert.ok(f, `${e.model} missing from FALLBACK`);
    assert.equal(f.input, e.current.input, `${e.model} input`);
    assert.equal(f.output, e.current.output, `${e.model} output`);
    assert.equal(f.cacheCreate, e.current.cacheCreate, `${e.model} cacheCreate`);
    assert.equal(f.cacheRead, e.current.cacheRead, `${e.model} cacheRead`);
    assert.equal(f.label, e.label, `${e.model} label`);
    assert.equal(f.maxInput, e.maxInput, `${e.model} maxInput`);
    assert.deepEqual(JSON.parse(JSON.stringify(f.history ?? [])), e.history, `${e.model} dated periods`);
  }
});

// RÉÉCRIT LE 2026-08-11 PAR C4. L'ancien filet — « switching the price source
// to the engine table changes no amount » — est devenu VACUEUX : le montant ne
// lit plus du tout la carte de prix du serveur, il vient sans condition de la
// table du moteur. Le garder tel quel aurait laissé un test toujours vert qui
// ne prouve plus rien.
//
// Ce qu'il faut prouver à sa place est plus fort, et c'est la propriété
// architecturale que C4 installe : le montant est INDÉPENDANT de la carte du
// serveur. On la corrompt délibérément, et le montant ne bouge pas.
test('le montant vient de la table du moteur, jamais de la carte du serveur', async () => {
  const usage = {
    input_tokens: 1000, output_tokens: 2000,
    cache_creation_input_tokens: 10000, cache_read_input_tokens: 100000,
    cache_creation: { ephemeral_5m_input_tokens: 4000, ephemeral_1h_input_tokens: 6000 },
  };
  const reference = computeCost(usage, 'claude-opus-4-8').usd;
  assert.ok(Math.abs(reference - 0.19) < 1e-12, `coût de référence, obtenu ${reference}`);

  try {
    // Carte du serveur empoisonnée : un tarif absurde sur le même modèle.
    _setPricesForTest({
      'claude-opus-4-8': { input: 1, output: 1, cacheCreate: 1, cacheRead: 1, maxInput: 42, label: 'Faux' },
    });
    assert.equal(getPrice('claude-opus-4-8').input, 1, 'la carte du serveur EST bien corrompue');
    assert.equal(computeCost(usage, 'claude-opus-4-8').usd, reference,
      'et pourtant le montant ne bouge pas : il ne vient pas de là');

    // La table du moteur reste aussi la source des périodes datées.
    const { priceTable } = await loadEngine();
    applyEnginePrices(priceTable());
    const intro = computeCost({ input_tokens: 1000 }, 'claude-sonnet-5', '2026-08-15T00:00:00.000Z').usd;
    assert.ok(Math.abs(intro - 0.002) < 1e-12, `tarif de lancement, obtenu ${intro}`);
  } finally {
    _setPricesForTest({});
  }
});
