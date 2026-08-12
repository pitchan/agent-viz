import { describe, expect, test } from 'vitest';
import { classifyPrompt, isNoisePrompt, PromptsAggregator } from '../../src/engine/doctor/aggregators/prompts.js';

describe('isNoisePrompt — bruit injecté, pas un prompt humain', () => {
  test('contenu XML injecté par le harnais exclu', () => {
    expect(isNoisePrompt('<command-name>/bench</command-name>')).toBe(true);
    expect(isNoisePrompt('<local-command-stdout>...</local-command-stdout>')).toBe(true);
    expect(isNoisePrompt('<ide_selection>lignes 1-3</ide_selection>')).toBe(true);
    expect(isNoisePrompt('<system-reminder>rappel</system-reminder>')).toBe(true);
    expect(isNoisePrompt('   ')).toBe(true);
  });

  test('vrai prompt humain conservé', () => {
    expect(isNoisePrompt('Analyse le document 09 et dis-moi ce que tu en penses')).toBe(false);
  });
});

describe('classifyPrompt — détecteur déterministe FR/EN', () => {
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
});

describe('PromptsAggregator', () => {
  test('compte les prompts, la part forme-carte, et garde le corpus tronqué à 200 caractères', () => {
    const agg = new PromptsAggregator(10);
    agg.addPrompt({ kind: 'user_prompt', text: 'Où est définie la route des communes ?', shape: 'string' });
    agg.addPrompt({ kind: 'user_prompt', text: 'Corrige le bug', shape: 'string' });
    agg.addPrompt({ kind: 'user_prompt', text: `Quel impact si je change ${'x'.repeat(300)}`, shape: 'string' });
    agg.addPrompt({ kind: 'user_prompt', text: '<command-name>/foo</command-name>', shape: 'string' }); // bruit : ignoré
    const r = agg.result();
    expect(r.totalPrompts).toBe(3);
    expect(r.mapShapedCount).toBe(2);
    expect(r.corpus).toHaveLength(2);
    expect(r.corpus[0]).toEqual({ text: 'Où est définie la route des communes ?', category: 'where' });
    expect(r.corpus[1]?.text.length).toBe(200);
    expect(r.corpus[1]?.category).toBe('impact');
  });

  test('le corpus est plafonné par maxPrompts, les compteurs continuent', () => {
    const agg = new PromptsAggregator(2);
    agg.addPrompt({ kind: 'user_prompt', text: 'Où est le guard ?', shape: 'string' });
    agg.addPrompt({ kind: 'user_prompt', text: 'Où est la config ?', shape: 'string' });
    agg.addPrompt({ kind: 'user_prompt', text: 'Où est le module ?', shape: 'string' });
    const r = agg.result();
    expect(r.mapShapedCount).toBe(3);
    expect(r.corpus).toHaveLength(2);
  });
});
