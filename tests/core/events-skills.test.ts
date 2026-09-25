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
  expect(events).toEqual([{
    kind: 'skill_listing',
    names: ['pptx', 'superpowers:brainstorming'],
    entries: [{ name: 'pptx', chars: 9, hasDescription: true }],
  }]);
});

test("une entrée sans « : description » est une description retirée par le plafond", () => {
  // Arrange
  const content = '- docx: Crée des documents Word.\n- anthropic-skills:pptx\n- init';
  const raw = { type: 'attachment', attachment: { type: 'skill_listing', names: ['docx', 'anthropic-skills:pptx', 'init'], content } };
  // Act
  const [evt] = normalizeEvent(raw);
  // Assert
  expect(evt).toEqual({
    kind: 'skill_listing',
    names: ['docx', 'anthropic-skills:pptx', 'init'],
    entries: [
      { name: 'docx', chars: 32, hasDescription: true },
      { name: 'anthropic-skills:pptx', chars: 23, hasDescription: false },
      { name: 'init', chars: 6, hasDescription: false },
    ],
  });
});

test("une ligne qui ne commence pas par un nom listé prolonge l'entrée précédente", () => {
  // Arrange
  const content = '- find-docs: Lit la doc.\nAlways use for: API.\n- xlsx: Tableurs.';
  const raw = { type: 'attachment', attachment: { type: 'skill_listing', names: ['find-docs', 'xlsx'], content } };
  // Act
  const [evt] = normalizeEvent(raw);
  // Assert
  expect(evt).toMatchObject({ entries: [
    { name: 'find-docs', chars: 24 + 1 + 20, hasDescription: true },
    { name: 'xlsx', chars: 17, hasDescription: true },
  ] });
});

test('une liste sans content rend des entrées vides', () => {
  // Arrange
  const raw = { type: 'attachment', attachment: { type: 'skill_listing', names: ['pptx'] } };
  // Act
  const [evt] = normalizeEvent(raw);
  // Assert
  expect(evt).toEqual({ kind: 'skill_listing', names: ['pptx'], entries: [] });
});

test('une autre pièce jointe reste un événement other', () => {
  // Arrange
  const raw = { type: 'attachment', attachment: { type: 'total_tokens_reminder' } };
  // Act
  const events = normalizeEvent(raw);
  // Assert
  expect(events).toEqual([{ kind: 'other', topLevelType: 'attachment' }]);
});
