'use strict';
// The provenance notice is DATA served by the server, quoting real values —
// it cannot silently drift from what the program does.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildProvenance } = require('../../src/server/observatory/provenance');
const { SCAN_VERSION } = require('../../src/server/observatory/scan-version');

const build = () => buildProvenance({ engineVersion: '0.13.0', priceSource: 'netgain-table-embarquee' });

test('the notice quotes the REAL scan version and the passed engine version/source', () => {
  const p = build();
  assert.equal(p.scanVersion, SCAN_VERSION);
  assert.equal(p.engineVersion, '0.13.0');
  assert.equal(p.priceSource, 'netgain-table-embarquee');
});

test('eight French sections, each with a title and a substantial body', () => {
  const p = build();
  assert.equal(p.sections.length, 8);
  for (const s of p.sections) {
    assert.ok(s.titre.length > 0, 'titre');
    assert.ok(s.corps.length > 40, `corps trop court : ${s.titre}`);
  }
});

test('the notice states the exact conventions the engine applies', () => {
  const all = build().sections.map(s => `${s.titre} ${s.corps}`).join('\n');
  assert.match(all, /message\.id/);
  assert.match(all, /relecture de cache est exclue/i);
  assert.match(all, /à la date du message/);
  assert.match(all, /tarif 5 minutes/);
  assert.match(all, /jamais un zéro silencieux/);
  assert.match(all, /pastille/);
  assert.match(all, /LiteLLM/);
  assert.match(all, /paliers/);
});
