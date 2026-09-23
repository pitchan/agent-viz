// classifyPrompt est déterministe et bilingue : la même phrase rend toujours la même classe.
import { expect, test } from 'vitest';
import { classifyPrompt } from '../../src/engine/doctor/aggregators/prompts.ts';

test('questions de localisation (où / where)', () => {
  expect(classifyPrompt('Où est définie la route des communes ?')).toBe('where');
  expect(classifyPrompt('where is the auth guard applied?')).toBe('where');
});

test('questions de fonctionnement (comment marche / how does X work)', () => {
  expect(classifyPrompt('Comment fonctionne le pipeline DVF ?')).toBe('how-works');
  expect(classifyPrompt('How does the ingestion job work?')).toBe('how-works');
});

test('questions de routes / endpoints', () => {
  expect(classifyPrompt('Quelles routes écrivent sans validation ?')).toBe('routes');
  expect(classifyPrompt('Liste les endpoints publics du backend')).toBe('routes');
  expect(classifyPrompt('Which routes are missing an auth guard?')).toBe('routes');
});

test("questions d'impact / blast radius", () => {
  expect(classifyPrompt('Quel impact si je change la signature de geocode() ?')).toBe('impact');
  expect(classifyPrompt('What is the blast radius of renaming this DTO?')).toBe('impact');
});

test('questions de dépendances (qui dépend / who calls)', () => {
  expect(classifyPrompt('Qui dépend du service AuthService ?')).toBe('dependents');
  expect(classifyPrompt('what depends on the pricing module?')).toBe('dependents');
});

test("questions d'environnement requis", () => {
  expect(classifyPrompt('Quelles variables d’environnement sont requises au boot ?')).toBe('env');
  expect(classifyPrompt('Which env vars are required to start the backend?')).toBe('env');
});

test('prompts hors carte → null', () => {
  expect(classifyPrompt('Corrige le bug dans le test des communes')).toBeNull();
  expect(classifyPrompt('Ajoute une colonne au fichier Excel')).toBeNull();
  expect(classifyPrompt('Refactore la fonction pour la lisibilité')).toBeNull();
});
