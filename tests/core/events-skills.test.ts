// Les traces de skills que normalizeEvent relève dans un événement : sans elles,
// l'observatoire ne sait pas quel skill a consommé quoi.
import { expect, test } from 'vitest';
import { normalizeEvent } from '../../src/engine/core/events.ts';

test('la ligne assistant garde attributionSkill', () => {
  // Arrange
  const raw = {
    type: 'assistant', attributionSkill: 'superpowers:brainstorming', attributionPlugin: 'superpowers',
    message: { id: 'msg_s1', role: 'assistant', content: [] },
  };
  // Act
  const [evt] = normalizeEvent(raw);
  // Assert
  expect(evt).toMatchObject({ kind: 'assistant', attributionSkill: 'superpowers:brainstorming' });
});

test('un attributionSkill non-chaîne ne produit pas de champ', () => {
  // Arrange
  const raw = { type: 'assistant', attributionSkill: 42, message: { id: 'msg_s2', role: 'assistant', content: [] } };
  // Act
  const [evt] = normalizeEvent(raw);
  // Assert
  expect(evt && 'attributionSkill' in evt).toBe(false);
});

test('une pièce jointe skill_listing devient un événement skill_listing, noms non-chaînes écartés', () => {
  // Arrange
  const raw = {
    type: 'attachment',
    attachment: { type: 'skill_listing', isInitial: true, skillCount: 3, names: ['pptx', 'superpowers:brainstorming', 7], content: '- pptx: …' },
  };
  // Act
  const events = normalizeEvent(raw);
  // Assert
  expect(events).toEqual([{ kind: 'skill_listing', names: ['pptx', 'superpowers:brainstorming'] }]);
});

test('une autre pièce jointe reste un événement other', () => {
  // Arrange
  const raw = { type: 'attachment', attachment: { type: 'total_tokens_reminder' } };
  // Act
  const events = normalizeEvent(raw);
  // Assert
  expect(events).toEqual([{ kind: 'other', topLevelType: 'attachment' }]);
});
