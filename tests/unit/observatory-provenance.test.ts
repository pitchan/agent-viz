// The provenance notice is DATA served by the server, quoting real values —
// it cannot silently drift from what the program does.

import { expect, test } from 'vitest';
import { buildProvenance } from '../../src/server/observatory/provenance.ts';
import { SCAN_VERSION } from '../../src/server/observatory/scan-version.ts';

const build = () => buildProvenance({ engineVersion: '0.13.0', priceSource: 'netgain-table-embarquee' });

test('the notice quotes the REAL scan version and the passed engine version/source', () => {
  const p = build();
  expect(p.scanVersion).toBe(SCAN_VERSION);
  expect(p.engineVersion).toBe('0.13.0');
  expect(p.priceSource).toBe('netgain-table-embarquee');
});

test('eight French sections, each with a title and a substantial body', () => {
  const p = build();
  expect(p.sections.length).toBe(8);
  for (const s of p.sections) {
    expect(s.titre.length > 0, 'titre').toBeTruthy();
    expect(s.corps.length > 40, `corps trop court : ${s.titre}`).toBeTruthy();
  }
});

test('the notice states the exact conventions the engine applies', () => {
  const all = build().sections.map(s => `${s.titre} ${s.corps}`).join('\n');
  expect(all).toMatch(/message\.id/);
  expect(all).toMatch(/relecture de cache est exclue/i);
  expect(all).toMatch(/à la date du message/);
  expect(all).toMatch(/tarif 5 minutes/);
  expect(all).toMatch(/jamais un zéro silencieux/);
  expect(all).toMatch(/pastille/);
  expect(all).toMatch(/LiteLLM/);
  expect(all).toMatch(/paliers/);
});
