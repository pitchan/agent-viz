// Le bloc « Mises à jour LiteLLM » du panneau Tarifs : ce que dit une ligne de dérive,
// et quand la vigie est passée pour la dernière fois.
import { expect, test } from 'vitest';
import { driftTitle, ratesPerMTok, vigieStatus } from '../../src/web/observatory/format.ts';

const P = { input: 4e-6, output: 2e-5, cacheCreate: 5e-6, cacheRead: 2e-7 };

test('les quatre prix se lisent en dollars par million, unité dite une fois ailleurs', () =>
  expect(ratesPerMTok(P)).toBe('entrée 4,00 · sortie 20,00 · écriture cache 5,00 · relecture cache 0,20'));

test('un modèle nouveau se nomme comme tel', () =>
  expect(driftTitle({ model: 'claude-opus-5-5', kind: 'modele-nouveau' })).toBe('Nouveau modèle : Opus 5.5'));

test('un tarif changé se nomme comme tel', () =>
  expect(driftTitle({ model: 'claude-opus-5', kind: 'tarif-different' })).toBe('Tarif changé : Opus 5'));

test('avant le premier passage, la vigie le dit', () =>
  expect(vigieStatus(null, 0)).toBe('LiteLLM pas encore consulté depuis le démarrage du serveur.'));

test('sans écart, le dernier passage est daté', () =>
  expect(vigieStatus('2026-09-23T14:41:30.000Z', 0)).toBe('Dernière vérification LiteLLM : 2026-09-23 14:41 UTC — barème à jour.'));

test('avec des écarts, leur nombre est dit', () =>
  expect(vigieStatus('2026-09-23T14:41:30.000Z', 2)).toBe('Dernière vérification LiteLLM : 2026-09-23 14:41 UTC — 2 mise(s) à jour disponible(s).'));
