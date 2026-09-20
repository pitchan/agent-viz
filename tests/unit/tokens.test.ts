// Smoke test for the cumulative + last-wins logic in src/server/tokens.ts.

import { expect, test } from 'vitest';
import { newBucket, accumulateUsage, ensureTokens, tokensSnapshot, tokensMessage } from '../../src/server/tokens.ts';

test('accumulateUsage cumulates totals AND tracks the last message values', () => {
  const b = newBucket();

  accumulateUsage(b, {
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 200,
    cache_read_input_tokens: 1000,
  }, null, null, null);
  accumulateUsage(b, {
    input_tokens: 30,
    output_tokens: 10,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 1500,
  }, null, null, null);

  // Cumulative buckets sum across all messages — used for total/cost displays.
  expect(b.in).toBe(130);
  expect(b.out).toBe(60);
  expect(b.cacheCreate).toBe(200);
  expect(b.cacheRead).toBe(2500);

  // Last-message values overwrite (last-wins) — sum of the three approximates
  // the current context window size, matching Claude Code's /context output.
  expect(b.lastIn).toBe(30);
  expect(b.lastCacheCreate).toBe(0);
  expect(b.lastCacheRead).toBe(1500);
});

test('accumulateUsage prices each message at its own timestamp, not at scan time', () => {
  // sonnet-5 changes tariff on 2026-09-01 (intro 2 $/M -> sticker 3 $/M input).
  // A September-dated message must be billed at the sticker rate even when the
  // accumulation runs during the intro window.
  const b = newBucket();
  accumulateUsage(b, { input_tokens: 1000 }, 'claude-sonnet-5', 'm1', '2026-09-15T10:00:00.000Z');
  expect(Math.abs(b.costUsd - 0.003) < 1e-12, `got ${b.costUsd}, expected 0.003 (sticker)`).toBeTruthy();
});

test('newBucket exposes pricing fields zeroed out', () => {
  const b = newBucket();
  expect(b.lastModel).toBe(null);
  expect(b.contextMax).toBe(0);
  expect(b.costUsd).toBe(0);
});

test('accumulateUsage without a model leaves pricing fields untouched', () => {
  const b = newBucket();
  accumulateUsage(b, { input_tokens: 100, output_tokens: 50 }, null, null, null);
  expect(b.lastModel).toBe(null);
  expect(b.contextMax).toBe(0);
  expect(b.costUsd).toBe(0);
});

test('accumulateUsage with a known model populates lastModel/contextMax and accumulates costUsd', () => {
  const b = newBucket();
  // claude-sonnet-4-5 is in the engine's embedded table — no network needed.
  accumulateUsage(b, {
    input_tokens: 1_000,
    output_tokens: 500,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }, 'claude-sonnet-4-5', null, null);
  expect(b.lastModel).toBe('claude-sonnet-4-5');
  expect(b.contextMax > 0, 'contextMax should be set from the model').toBeTruthy();
  // 1000 * 3e-6 + 500 * 1.5e-5 = 0.003 + 0.0075 = 0.0105
  expect(Math.abs(b.costUsd - 0.0105) < 1e-9, `got ${b.costUsd}`).toBeTruthy();

  accumulateUsage(b, {
    input_tokens: 200, output_tokens: 100,
    cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
  }, 'claude-sonnet-4-5', null, null);
  // costUsd accumulates: previous 0.0105 + 200*3e-6 + 100*1.5e-5 = 0.0105 + 0.0006 + 0.0015 = 0.0126
  expect(Math.abs(b.costUsd - 0.0126) < 1e-9, `got ${b.costUsd}`).toBeTruthy();
});

test('accumulateUsage stores the canonical id (normalized) regardless of input transport', () => {
  // Bedrock/Vertex/dated suffixes must not leak into the bucket — the UI
  // uses lastModel to derive a clean label and shouldn't have to handle
  // every transport variant.
  const cases = [
    'anthropic.claude-sonnet-4-5-v1:0',
    'bedrock/claude-sonnet-4-5',
    'claude-sonnet-4-5-20250929',
  ];
  for (const raw of cases) {
    const b = newBucket();
    accumulateUsage(b, { input_tokens: 100, output_tokens: 50 }, raw, null, null);
    expect(b.lastModel, `failed for ${raw}`).toBe('claude-sonnet-4-5');
  }
});

// Un modèle sans tarif laisse le montant inchangé (borne inférieure exacte), mais
// le seau NOMME le modèle et marque le total incomplet ; `lastModel` retient
// l'identifiant rapporté, pour que la pastille ne disparaisse pas.
test('accumulateUsage with an unknown model names it and marks the cost incomplete', () => {
  const b = newBucket();
  accumulateUsage(b, { input_tokens: 1000, output_tokens: 500 }, 'claude-mythical-99-99', null, null);
  // Les compteurs de jetons montent toujours : ce qui manque est le TARIF,
  // pas la mesure.
  expect(b.in).toBe(1000);
  expect(b.costUsd).toBe(0);
  // Le modèle est retenu et l'incomplétude est dite.
  expect(b.lastModel).toBe('claude-mythical-99-99');
  expect(b.costComplete).toBe(false);
  expect(b.unknownModels).toEqual(['claude-mythical-99-99']);
  // Aucune fenêtre de contexte connue pour un modèle hors table.
  expect(b.contextMax).toBe(0);
});

test('tokensSnapshot exposes tokensSupported flag (default true)', () => {
  const rec: { id: string; tokens?: any } = { id: 'r1' };
  ensureTokens(rec);
  const snap = tokensSnapshot(rec)!;
  expect(snap.tokensSupported).toBe(true);
});

test('tokensSnapshot reports tokensSupported=false when rec.tokens.unsupported is set', () => {
  const rec: { id: string; tokens?: any } = { id: 'r2' };
  ensureTokens(rec);
  rec.tokens.unsupported = true;
  const snap = tokensSnapshot(rec)!;
  expect(snap.tokensSupported).toBe(false);
});

// Claude Code splits one API message into N JSONL lines (one per content
// block: thinking, text, tool_use) but every line carries the SAME `usage`.
// Without dedup the bucket sums it N times — causing 2-3× cost over-reporting.
// The msgId (message.id from the Anthropic API) is the natural dedup key.
test('accumulateUsage with the same msgId is a no-op (dedup across content blocks)', () => {
  const b = newBucket();
  const usage = {
    input_tokens: 100, output_tokens: 50,
    cache_creation_input_tokens: 200, cache_read_input_tokens: 1000,
  };
  // Three lines for the same API message — thinking + text + tool_use.
  accumulateUsage(b, usage, 'claude-sonnet-4-5', 'msg_01ABC', null);
  accumulateUsage(b, usage, 'claude-sonnet-4-5', 'msg_01ABC', null);
  accumulateUsage(b, usage, 'claude-sonnet-4-5', 'msg_01ABC', null);
  expect(b.in, 'input must not be triple-counted').toBe(100);
  expect(b.out).toBe(50);
  expect(b.cacheCreate).toBe(200);
  expect(b.cacheRead).toBe(1000);
  // Cost similarly counted exactly once.
  // 100*3e-6 + 50*1.5e-5 + 200*3.75e-6 + 1000*3e-7 = 0.0003 + 0.00075 + 0.00075 + 0.0003 = 0.00210
  expect(Math.abs(b.costUsd - 0.0021) < 1e-9, `got ${b.costUsd}`).toBeTruthy();
});

test('accumulateUsage without msgId keeps cumulating (back-compat for callers that have no id)', () => {
  // Some legacy/hook code paths may not carry a msgId. They must keep working
  // as before — dedup is opt-in via the 4th argument.
  const b = newBucket();
  accumulateUsage(b, { input_tokens: 10, output_tokens: 5 }, null, null, null);
  accumulateUsage(b, { input_tokens: 10, output_tokens: 5 }, null, null, null);
  expect(b.in).toBe(20);
  expect(b.out).toBe(10);
});

test('accumulateUsage with different msgIds cumulates normally', () => {
  const b = newBucket();
  accumulateUsage(b, { input_tokens: 10, output_tokens: 5 }, 'claude-sonnet-4-5', 'msg_A', null);
  accumulateUsage(b, { input_tokens: 20, output_tokens: 10 }, 'claude-sonnet-4-5', 'msg_B', null);
  expect(b.in).toBe(30);
  expect(b.out).toBe(15);
});

// ---------------------------------------------------------------------------
// L'accumulation vient de la primitive du moteur (src/engine/core/usage.ts), que
// tokens.ts importe. Ces tests tiennent ce qu'elle change pour le serveur : la
// ventilation de cache, les gardes de champ, l'identifiant vide.
//
// Une définition locale d'`emptyUsageBucket` dans `src/server/` fait rougir
// `tests/repo/no-local-engine-primitives.test.mjs`.
// ---------------------------------------------------------------------------

test('le seau porte les DEUX ventilations de cache', () => {
  // Arrange
  const b = newBucket();
  expect(b.cacheCreate1h, 'le seau neuf les expose à zéro').toBe(0);
  expect(b.cacheCreate5m).toBe(0);

  // Act
  accumulateUsage(b, {
    input_tokens: 1, cache_creation_input_tokens: 100,
    cache_creation: { ephemeral_1h_input_tokens: 60, ephemeral_5m_input_tokens: 40 },
  }, null, null, null);

  // Assert — la somme des deux fenêtres n'a PAS à valoir cache_creation : ce
  // sont trois champs bruts distincts, la primitive ne réconcilie rien.
  expect(b.cacheCreate).toBe(100);
  expect(b.cacheCreate1h).toBe(60);
  expect(b.cacheCreate5m).toBe(40);
});

// La garde commune ramène à zéro un nombre en CHAÎNE (sans elle, `0 + "100"` =
// "0100" et le seau part en texte jusque dans l'enveloppe SSE) et `Infinity`,
// qu'un JSON valide porte via `1e999`.
test('un champ qui n\'est pas un nombre fini vaut zéro, et le seau reste numérique', () => {
  // Arrange
  const b = newBucket();

  // Act
  accumulateUsage(b, { input_tokens: '100', output_tokens: 5 }, null, null, null);
  accumulateUsage(b, JSON.parse('{"input_tokens":1e999,"output_tokens":5}'), null, null, null);
  accumulateUsage(b, { input_tokens: NaN, output_tokens: 5 }, null, null, null);

  // Assert
  expect(b.in).toBe(0);
  expect(typeof b.in).toBe('number');
  expect(b.out, 'les champs valides du même message sont comptés normalement').toBe(15);
});

// La taille de contexte est la mesure d'un seul message. Un usage inexploitable
// n'en donne aucune : les champs « dernier message » gardent la dernière mesure
// saine, au lieu de tomber à zéro ou de mêler les champs de deux messages.
const USAGE_SAIN = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 500, cache_read_input_tokens: 50000 };
const USAGE_INEXPLOITABLE = [
  ['un non-objet', 'x'],
  ['input_tokens en chaîne', { input_tokens: '100', output_tokens: 5, cache_creation_input_tokens: 700, cache_read_input_tokens: 50200 }],
  ['cache_read_input_tokens en chaîne', { input_tokens: 11, output_tokens: 5, cache_creation_input_tokens: 700, cache_read_input_tokens: '50200' }],
  ['output_tokens absent', { input_tokens: 11, cache_creation_input_tokens: 700, cache_read_input_tokens: 50200 }],
];

for (const [forme, brut] of USAGE_INEXPLOITABLE) {
  test(`usage inexploitable (${forme}) : la taille de contexte garde la dernière mesure saine`, () => {
    // Arrange
    const b = newBucket();
    accumulateUsage(b, USAGE_SAIN, 'claude-opus-4-8', 'm1', null);

    // Act
    accumulateUsage(b, brut, 'claude-opus-4-8', 'm2', null);

    // Assert
    expect(b.lastIn).toBe(10);
    expect(b.lastCacheCreate).toBe(500);
    expect(b.lastCacheRead).toBe(50000);
  });
}

test('après un usage inexploitable, le message sain suivant redonne sa propre taille de contexte', () => {
  // Arrange
  const b = newBucket();
  accumulateUsage(b, USAGE_SAIN, 'claude-opus-4-8', 'm1', null);
  accumulateUsage(b, 'x', 'claude-opus-4-8', 'm2', null);

  // Act
  accumulateUsage(b, { input_tokens: 12, output_tokens: 5, cache_creation_input_tokens: 800, cache_read_input_tokens: 50500 }, 'claude-opus-4-8', 'm3', null);

  // Assert
  expect(b.lastIn).toBe(12);
  expect(b.lastCacheCreate).toBe(800);
  expect(b.lastCacheRead).toBe(50500);
});

// Un identifiant VIDE n'est pas un identifiant : dédupliquer sur "" fusionnerait
// des messages distincts dépourvus d'identifiant, et SOUS-COMPTERAIT.
test('un identifiant vide ne déduplique pas : deux messages, deux comptes', () => {
  // Arrange
  const b = newBucket();

  // Act
  accumulateUsage(b, { input_tokens: 10 }, null, '', null);
  accumulateUsage(b, { input_tokens: 10 }, null, '', null);

  // Assert
  expect(b.in).toBe(20);
});

// ---------------------------------------------------------------------------
// Le seau porte la COMPLÉTUDE du coût jusqu'à l'enveloppe SSE : un message sur un
// modèle sans tarif marque le coût incomplet et nomme le modèle, au lieu d'être
// ignoré en silence.
// ---------------------------------------------------------------------------

const AT = '2026-08-11T12:00:00.000Z';
const usage = () => ({ input_tokens: 40_000, output_tokens: 8_000, cache_read_input_tokens: 200_000 });

test('un modèle tarifé laisse le coût complet', () => {
  const b = newBucket();
  accumulateUsage(b, usage(), 'claude-opus-5', 'm1', AT);
  expect(b.costComplete).toBe(true);
  expect(b.unknownModels).toEqual([]);
  expect(b.costUsd > 0).toBeTruthy();
});

test('un modèle SANS TARIF marque le coût incomplet et se nomme', () => {
  const b = newBucket();
  accumulateUsage(b, usage(), 'claude-opus-5', 'm1', AT);
  const coutConnu = b.costUsd;
  accumulateUsage(b, usage(), 'claude-opus-6', 'm2', AT);

  expect(b.costComplete).toBe(false);
  expect(b.unknownModels).toEqual(['claude-opus-6']);
  // Le montant reste une BORNE INFÉRIEURE exacte : la part connue, inchangée.
  expect(b.costUsd).toBe(coutConnu);
});

test('un ZÉRO VOULU ne rend PAS le coût incomplet', () => {
  // `<synthetic>` coûte 0 $ voulu : un simple test de nullité du tarif le prendrait
  // pour un tarif inconnu, et signalerait « partiel » sur des sessions justes.
  const b = newBucket();
  accumulateUsage(b, usage(), '<synthetic>', 'm1', AT);
  accumulateUsage(b, usage(), 'claude-opus-5', 'm2', AT);
  expect(b.costComplete).toBe(true);
  expect(b.unknownModels).toEqual([]);
});

test('un modèle inconnu est nommé UNE fois, pas une par message', () => {
  const b = newBucket();
  accumulateUsage(b, usage(), 'claude-opus-6', 'm1', AT);
  accumulateUsage(b, usage(), 'claude-opus-6', 'm2', AT);
  accumulateUsage(b, usage(), 'zzz-autre-modele', 'm3', AT);
  expect(b.unknownModels).toEqual(['claude-opus-6', 'zzz-autre-modele']);
});

test('lastModel retient le DERNIER modèle rapporté, tarifé ou non', () => {
  // Un lastModel posé seulement par un modèle tarifé masquerait la pastille d'une
  // session n'utilisant QUE des modèles inconnus : ni coût, ni contexte, ni modèle.
  const b = newBucket();
  accumulateUsage(b, usage(), 'claude-opus-6', 'm1', AT);
  expect(b.lastModel).toBe('claude-opus-6');
  expect(b.contextMax, 'aucune fenêtre connue pour un modèle sans tarif').toBe(0);
  expect(b.costComplete).toBe(false);
});

test('un identifiant régional est tarifé comme sa forme canonique', () => {
  const b = newBucket();
  accumulateUsage(b, usage(), 'us.anthropic.claude-opus-4-7', 'm1', AT);
  const c = newBucket();
  accumulateUsage(c, usage(), 'claude-opus-4-7', 'm2', AT);
  expect(b.costComplete).toBe(true);
  expect(b.costUsd).toBe(c.costUsd);
  expect(b.lastModel).toBe('claude-opus-4-7');
});

test('la complétude traverse l\'enveloppe SSE', () => {
  const rec: { tokens?: any } = {};
  ensureTokens(rec);
  accumulateUsage(rec.tokens.main, usage(), 'claude-opus-6', 'm1', AT);
  const msg = tokensMessage('s1', rec)!;
  expect(msg.main.costComplete).toBe(false);
  expect(msg.main.unknownModels).toEqual(['claude-opus-6']);
});

// Un message malformé sur un modèle tarifé ne doit pas empoisonner
// bucket.costUsd pour le reste de la session : costUsd reste fini et vaut le coût
// des messages sains, et costComplete devient faux (ce message n'est pas tarifé).
test('un message malformé (input_tokens: 1e999) entre deux messages sains ne poisonne pas costUsd', () => {
  const b = newBucket();
  const sain = { input_tokens: 1000, output_tokens: 500 };
  accumulateUsage(b, sain, 'claude-sonnet-4-5', 'm1', null);
  const coutUnSain = b.costUsd;
  accumulateUsage(b, { input_tokens: 1e999 }, 'claude-sonnet-4-5', 'm2', null);
  accumulateUsage(b, sain, 'claude-sonnet-4-5', 'm3', null);

  expect(Number.isFinite(b.costUsd), `costUsd devrait être fini, obtenu ${b.costUsd}`).toBeTruthy();
  expect(Math.abs(b.costUsd - coutUnSain * 2) < 1e-9, `costUsd devrait valoir le coût des deux messages sains (${coutUnSain * 2}), obtenu ${b.costUsd}`).toBeTruthy();
  expect(b.costComplete).toBe(false);
});

// Un usage inexploitable rend la session partielle : ses champs inexploitables valent zéro, si bien que le
// total de jetons et le coût ne sont plus que des bornes inférieures.
const USAGE_MALFORME = [
  ['un non-objet', 0],
  ['une chaîne', 'x'],
  ['output_tokens absent', { input_tokens: 1000 }],
];

for (const [forme, brut] of USAGE_MALFORME) {
  test(`usage inexploitable (${forme}) : le coût devient partiel et le message est compté à part`, () => {
    // Arrange
    const b = newBucket();

    // Act
    accumulateUsage(b, brut, 'claude-sonnet-4-5', 'm1', AT);

    // Assert
    expect(b.costComplete).toBe(false);
    expect(b.malformedUsageMessages).toBe(1);
    expect(b.unknownModels).toEqual([]);
  });
}

test('un message inexploitable écrit sur plusieurs lignes n’est compté qu’une fois', () => {
  // Arrange
  const b = newBucket();
  accumulateUsage(b, 0, 'claude-sonnet-4-5', 'm1', AT);

  // Act
  accumulateUsage(b, 0, 'claude-sonnet-4-5', 'm1', AT);

  // Assert
  expect(b.malformedUsageMessages).toBe(1);
});

test('une ligne sans usage est ignorée : ni marqueur, ni modèle sans tarif', () => {
  // Arrange
  const b = newBucket();

  // Act
  accumulateUsage(b, undefined, 'claude-opus-6', 'm1', AT);

  // Assert
  expect(b.costComplete).toBe(true);
  expect(b.malformedUsageMessages).toBe(0);
  expect(b.unknownModels).toEqual([]);
});

test('le compte des messages inexploitables traverse l’enveloppe SSE', () => {
  // Arrange
  const rec: { tokens?: any } = {};
  ensureTokens(rec);
  accumulateUsage(rec.tokens.main, 'x', 'claude-opus-5', 'm1', AT);

  // Act
  const msg = tokensMessage('s1', rec)!;

  // Assert
  expect(msg.main.malformedUsageMessages).toBe(1);
  expect(msg.main.costComplete).toBe(false);
});
