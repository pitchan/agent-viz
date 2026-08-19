// Ce que ce fichier protege : les MOTS d'une ligne d'erreur.
//
// Le volet des erreurs est la seule porte d'entree vers un echec : le graphe
// n'affiche que les dix derniers outils, et le flux n'en garde que soixante
// lignes en DOM. Ce qui n'est pas dit ici n'est dit nulle part — d'ou des
// assertions sur le vocabulaire, comme pour les alertes.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  errorRow, errorsPanelTitle, MESSAGE_MAX,
} from '../../src/web/viz-error-format.mjs';

// L'heure se lit en heure LOCALE, comme celle des alertes : c'est l'heure a
// laquelle l'utilisateur a vu passer l'echec. L'instant est donc construit en
// local, sinon l'assertion ne tiendrait que dans un seul fuseau.
const TS_LOCAL = new Date(2026, 7, 18, 13, 20, 52).toISOString();

const rec = (extra = {}) => ({
  ts: TS_LOCAL,
  toolName: 'Read',
  subject: 'soutenance-septembre-2026.md',
  message: 'File content (25711 tokens) exceeds maximum allowed tokens (25000).',
  toolUseId: 'toolu_001',
  nodeId: 't:toolu_001',
  sessionId: '11111111-2222-3333-4444-555555555555',
  ...extra,
});

test('la ligne dit l outil, le sujet, le message et l heure', () => {
  // Arrange
  const r = rec();
  // Act
  const row = errorRow(r);
  // Assert
  assert.equal(row.tool, 'Read');
  assert.equal(row.subject, 'soutenance-septembre-2026.md');
  assert.match(row.message, /exceeds maximum allowed tokens/);
  assert.equal(row.time, '13:20:52');
});

test('un message trop long est coupe VISIBLEMENT', () => {
  // Un message tronque en silence se lit comme un message complet — et c'est
  // justement sur un message d'erreur qu'on ne peut pas se le permettre.
  // Arrange
  const r = rec({ message: 'x'.repeat(MESSAGE_MAX + 50) });
  // Act
  const row = errorRow(r);
  // Assert
  assert.equal(row.message.length, MESSAGE_MAX);
  assert.ok(row.message.endsWith('…'), 'la coupe se voit');
});

test('un message court n est pas touche', () => {
  // Arrange
  const r = rec({ message: 'Permission denied' });
  // Act / Assert
  assert.equal(errorRow(r).message, 'Permission denied');
});

test('sans sujet, la ligne reste lisible', () => {
  // Arrange
  const r = rec({ subject: '' });
  // Act
  const row = errorRow(r);
  // Assert
  assert.equal(row.subject, '');
  assert.equal(row.tool, 'Read');
});

test('un noeud identifie ET present est rejoignable', () => {
  // Arrange / Act / Assert
  assert.equal(errorRow(rec(), true).reachable, true);
});

test('un identifiant de noeud NE SUFFIT PAS a promettre le recentrage', () => {
  // Defaut trouve au navigateur, pas a la lecture : un echec orphelin porte un
  // `tool_use_id` comme les autres — c'est son PreToolUse qui manque, pas son
  // identifiant. Deduire la rejoignabilite du seul identifiant annoncait donc
  // une ligne cliquable qui ne menait nulle part. Seul l'appelant sait si le
  // noeud existe encore ; ce module ne connait pas le graphe et ne doit pas
  // faire semblant.
  // Arrange / Act / Assert
  assert.equal(errorRow(rec(), false).reachable, false);
});

test('sans identifiant de noeud, rien n est rejoignable', () => {
  // Arrange / Act / Assert
  assert.equal(errorRow(rec({ nodeId: null }), true).reachable, false);
});

test('une ligne non rejoignable DIT pourquoi, au lieu de se taire', () => {
  // Une ligne morte sans explication se lit comme un bug du volet. La ligne
  // porte deja tout ce qu'il faut pour comprendre l'echec : il reste a dire
  // qu'il n'y a rien de plus a ouvrir.
  // Arrange / Act
  const row = errorRow(rec(), false);
  // Assert
  assert.match(row.goneNote, /\w/);
  assert.equal(errorRow(rec(), true).goneNote, '');
});

test('la ligne dit combien de fois l erreur est revenue', () => {
  // Une erreur qui se repete est LE signal d'alarme reel — un agent qui
  // boucle. Elle s'empile sur sa ligne au registre ; la ligne doit le dire.
  // Arrange / Act
  const row = errorRow(rec({ count: 3 }));
  // Assert
  assert.equal(row.repeat, '×3');
});

test('une erreur survenue une seule fois ne s affuble pas d un ×1', () => {
  // Arrange / Act / Assert — et une ligne d'avant le compteur non plus
  assert.equal(errorRow(rec({ count: 1 })).repeat, '');
  assert.equal(errorRow(rec()).repeat, '');
});

test('la ligne porte le fait de continuite : N outils reussis depuis', () => {
  // C'est le fait qui laisse conclure « l'agent s'est rattrape » sans que le
  // volet le pretende jamais : un compteur ne peut pas mentir.
  // Arrange / Act / Assert — pluriel et singulier
  assert.equal(errorRow(rec({ successesSince: 27 })).sinceNote, '27 tools succeeded since');
  assert.equal(errorRow(rec({ successesSince: 1 })).sinceNote, '1 tool succeeded since');
});

test('rien reussi depuis : la ligne se tait plutot que d afficher un zero', () => {
  // « 0 tools succeeded since » se lirait comme une accusation ; l'absence de
  // la note dit deja tout — l'echec est le dernier mot de la session.
  // Arrange / Act / Assert
  assert.equal(errorRow(rec({ successesSince: 0 })).sinceNote, '');
  assert.equal(errorRow(rec()).sinceNote, '');
});

test('le titre du volet NOMME la session qu il montre', () => {
  // C'est la question posee devant l'ecran : « une erreur, oui, mais de quoi ? »
  // Le bandeau ne montre qu'une session a la fois ; le volet doit le dire.
  // Arrange / Act
  const titre = errorsPanelTitle('11111111-2222-3333-4444-555555555555', 3);
  // Assert
  assert.match(titre, /11111111/);
  assert.match(titre, /3/);
});

test('le titre accorde le mot erreur au singulier', () => {
  // Arrange / Act / Assert
  assert.match(errorsPanelTitle('abcd1234-0000-0000-0000-000000000000', 1), /1 error\b/);
});

test('le titre tient sans session connue', () => {
  // Au tout premier chargement, avant le moindre evenement, l'onglet ne sait
  // pas encore quelle session il montre. Le titre ne doit pas afficher un
  // « session undefined » qui se lit comme un bug.
  // Arrange / Act
  const titre = errorsPanelTitle('', 0);
  // Assert
  assert.doesNotMatch(titre, /undefined|null/);
});
