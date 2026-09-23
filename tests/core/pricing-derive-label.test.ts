// Le libellé lisible d'un id canonique : un chiffre de version pour Claude 5, deux pour 4.x.
import { expect, test } from 'vitest';
import { deriveLabel } from '../../src/engine/core/pricing.ts';

test('claude-opus-5-5 → Opus 5.5', () => expect(deriveLabel('claude-opus-5-5')).toBe('Opus 5.5'));
test('claude-fable-5 → Fable 5', () => expect(deriveLabel('claude-fable-5')).toBe('Fable 5'));
test('un id hors forme reste tel quel', () => expect(deriveLabel('gpt-x')).toBe('gpt-x'));
