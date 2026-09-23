// usageVerdict juge la forme de l'objet `usage` écrit par Claude Code : sain, malformé,
// ou absent. Ce verdict décide ensuite ce qui est compté et ce qui est écarté.
import { expect, test } from 'vitest';
import { usageVerdict } from '../../src/engine/core/usage.ts';
import { PAS_DES_COMPTES } from '../helpers/token-counts.ts';

// La forme que Claude Code ecrit : les deux comptes que le type `Usage` du SDK
// rend obligatoires, et les champs de cache qu'il declare facultatifs.
const USAGE_SAIN = {
  input_tokens: 100,
  output_tokens: 5,
  cache_creation_input_tokens: 40,
  cache_read_input_tokens: 2000,
  cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 10 },
};

function sansChamp(champ: string): Record<string, unknown> {
  const u: Record<string, unknown> = { ...USAGE_SAIN };
  delete u[champ];
  return u;
}

test.each([['absent', undefined], ['null', null]])('usage %s : absent, il n\'y a pas de mesure', (_label, raw) => {
  expect(usageVerdict(raw)).toBe('absent');
});

test.each([['une chaine', 'x'], ['un tableau', []], ['un nombre', 42], ['un booleen', true]])(
  'usage qui est %s : malforme',
  (_label, raw) => {
    expect(usageVerdict(raw)).toBe('malforme');
  },
);

test('usage objet vide : malforme, les deux comptes obligatoires manquent', () => {
  expect(usageVerdict({})).toBe('malforme');
});

test.each([['une chaine', 'x'], ['un tableau', []]])('cache_creation qui est %s : malforme', (_label, detail) => {
  expect(usageVerdict({ ...USAGE_SAIN, cache_creation: detail })).toBe('malforme');
});

test('usage aux comptes entiers : sain', () => {
  expect(usageVerdict(USAGE_SAIN)).toBe('sain');
});

test('les cles en plus sont ignorees : l\'usage reel d\'un message <synthetic> est sain', () => {
  // Arrange — releve tel quel dans un transcript : des zeros, et des cles que le type ne connait pas.
  const synthetic = {
    input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 }, service_tier: null,
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    inference_geo: null, iterations: null, speed: null,
  };

  // Act
  const verdict = usageVerdict(synthetic);

  // Assert
  expect(verdict).toBe('sain');
});

test.each(PAS_DES_COMPTES)('input_tokens qui est %s : malforme', (_label, valeur) => {
  expect(usageVerdict({ ...USAGE_SAIN, input_tokens: valeur })).toBe('malforme');
});

test.each([
  ['output_tokens', { ...USAGE_SAIN, output_tokens: -10 }],
  ['cache_creation_input_tokens', { ...USAGE_SAIN, cache_creation_input_tokens: -10 }],
  ['cache_read_input_tokens', { ...USAGE_SAIN, cache_read_input_tokens: -10 }],
  ['cache_creation.ephemeral_5m_input_tokens', { ...USAGE_SAIN, cache_creation: { ephemeral_5m_input_tokens: -10 } }],
  ['cache_creation.ephemeral_1h_input_tokens', { ...USAGE_SAIN, cache_creation: { ephemeral_1h_input_tokens: -10 } }],
])('%s negatif : malforme, chaque champ de compte est lu', (_champ, usage) => {
  expect(usageVerdict(usage)).toBe('malforme');
});

test('cache_creation.ephemeral_5m_input_tokens en chaine : malforme', () => {
  expect(usageVerdict({ ...USAGE_SAIN, cache_creation: { ephemeral_5m_input_tokens: '1' } })).toBe('malforme');
});

test.each([
  ['input_tokens absent', sansChamp('input_tokens')],
  ['input_tokens null', { ...USAGE_SAIN, input_tokens: null }],
  ['output_tokens absent', sansChamp('output_tokens')],
  ['output_tokens null', { ...USAGE_SAIN, output_tokens: null }],
])('%s : malforme, le type du SDK rend ce compte obligatoire', (_label, usage) => {
  expect(usageVerdict(usage)).toBe('malforme');
});

test.each([
  ['cache_creation_input_tokens absent', sansChamp('cache_creation_input_tokens')],
  ['cache_creation_input_tokens null', { ...USAGE_SAIN, cache_creation_input_tokens: null }],
  ['cache_read_input_tokens absent', sansChamp('cache_read_input_tokens')],
  ['cache_read_input_tokens null', { ...USAGE_SAIN, cache_read_input_tokens: null }],
  ['cache_creation absent', sansChamp('cache_creation')],
  ['cache_creation null', { ...USAGE_SAIN, cache_creation: null }],
  ['cache_creation vide', { ...USAGE_SAIN, cache_creation: {} }],
  ['cache_creation.ephemeral_5m_input_tokens null', { ...USAGE_SAIN, cache_creation: { ephemeral_5m_input_tokens: null } }],
  ['cache_creation.ephemeral_1h_input_tokens null', { ...USAGE_SAIN, cache_creation: { ephemeral_1h_input_tokens: null } }],
])('%s : sain, un champ de cache facultatif vaut zero', (_label, usage) => {
  expect(usageVerdict(usage)).toBe('sain');
});
