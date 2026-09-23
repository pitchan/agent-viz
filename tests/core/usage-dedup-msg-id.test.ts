// isDedupableMsgId dit quels identifiants permettent d'écarter une ligne répétée :
// la règle vit à un seul endroit, sinon deux appelants dédoublonnent différemment.
import { expect, test } from 'vitest';
import { isDedupableMsgId } from '../../src/engine/core/usage.ts';

test('un identifiant reel deduplique', () => {
  expect(isDedupableMsgId('msg_01')).toBe(true);
});

test('absent ou null : rien a dedupliquer, on accumule', () => {
  expect(isDedupableMsgId(null)).toBe(false);
  expect(isDedupableMsgId(undefined)).toBe(false);
});

// Un identifiant vide n'est pas un identifiant : dedupliquer sur "" fusionnerait des
// messages DISTINCTS sans identifiant en un seul, donc SOUS-COMPTERAIT.
test('une chaine VIDE n\'est pas un identifiant — sinon on sous-compte', () => {
  expect(isDedupableMsgId('')).toBe(false);
});

test('ce qui n\'est pas une chaine n\'est pas un identifiant', () => {
  expect(isDedupableMsgId(42)).toBe(false);
  expect(isDedupableMsgId({})).toBe(false);
});
