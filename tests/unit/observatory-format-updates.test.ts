// Le bloc « Tarifs Anthropic » du panneau Tarifs : ce que dit une ligne en attente,
// quand la vigie est passée pour la dernière fois, et ce qu'une vérification a rencontré.
import { expect, test } from 'vitest';
import { checkOutcome, driftTitle, pendingReason, ratesPerMTok, vigieStatus } from '../../src/web/observatory/format.ts';

const P = { input: 4e-6, output: 2e-5, cacheCreate: 5e-6, cacheRead: 2e-7 };

test('les quatre prix se lisent en dollars par million, unité dite une fois ailleurs', () =>
  expect(ratesPerMTok(P)).toBe('entrée 4,00 · sortie 20,00 · écriture cache 5,00 · relecture cache 0,20'));

test('un modèle nouveau se nomme comme tel', () =>
  expect(driftTitle({ model: 'claude-opus-5-5', kind: 'modele-nouveau' })).toBe('Nouveau modèle : Opus 5.5'));

test('un tarif changé se nomme comme tel', () =>
  expect(driftTitle({ model: 'claude-opus-5', kind: 'tarif-different' })).toBe('Tarif changé : Opus 5'));

test('avant le premier passage, la vigie le dit', () =>
  expect(vigieStatus(null, 0)).toBe('Tarifs Anthropic pas encore vérifiés depuis le démarrage du serveur.'));

test('sans tarif en attente, le dernier passage est daté', () =>
  expect(vigieStatus('2026-09-23T14:41:30.000Z', 0)).toBe('Tarifs Anthropic vérifiés le 2026-09-23 14:41 UTC — barème à jour.'));

test('avec des tarifs en attente, leur nombre est dit', () =>
  expect(vigieStatus('2026-09-23T14:41:30.000Z', 2)).toBe('Tarifs Anthropic vérifiés le 2026-09-23 14:41 UTC — 2 tarif(s) en attente.'));

test('un tarif sans fenêtre de contexte dit qu’il attend la page des modèles', () =>
  expect(pendingReason({ maxInput: null })).toMatch(/page des modèles/));

test('une vérification impossible donne sa cause', () =>
  expect(checkOutcome({ failure: 'page injoignable', errors: [] })).toBe('Vérification impossible : page injoignable'));

test('une adoption échouée nomme le modèle et la cause', () =>
  expect(checkOutcome({ failure: null, errors: [{ model: 'claude-opus-6', message: 'disque plein' }] })).toBe('Opus 6 non appliqué : disque plein'));

test('une vérification sans incident ne dit rien', () =>
  expect(checkOutcome({ failure: null, errors: [] })).toBeNull());
