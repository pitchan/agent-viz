// Ce que ce fichier protege : qu'une erreur d'outil RESTE retrouvable.
//
// Le bandeau comptait les erreurs en balayant les noeuds du graphe. Trois
// consequences, toutes mesurees au navigateur avant ce correctif :
// le ramasse-miettes efface un noeud d'outil fini au bout de dix minutes, donc
// le compteur retombait a zero sans que rien ne soit resolu ; un echec arrive
// sans son noeud (`PreToolUse` manque, noeud deja ramasse) n'etait compte nulle
// part ; et le message d'erreur, pourtant present dans l'evenement, n'avait
// aucune porte d'entree.
//
// Le remede est ce registre : il capte a l'EVENEMENT, pas au noeud survivant.
// C'est la seule facon que le chiffre du bandeau dise la verite sur la session.

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  recordError, getErrors, resetErrors, onErrorsChanged, ERRORS_MAX,
} from '../../src/web/viz-errors.mjs';

const echec = (extra = {}) => ({
  hook_event_name: 'PostToolUseFailure',
  session_id: '11111111-2222-3333-4444-555555555555',
  tool_name: 'Read',
  tool_input: { file_path: 'C:\\dev\\soutenance-septembre-2026.md' },
  tool_use_id: 'toolu_001',
  error: 'File content (25711 tokens) exceeds maximum allowed tokens (25000).',
  _ts: '2026-08-18T13:20:52.000Z',
  ...extra,
});

beforeEach(resetErrors);

test('un echec enregistre porte de quoi le comprendre SANS le graphe', () => {
  // Arrange
  const evt = echec();
  // Act
  recordError(evt);
  // Assert — les quatre champs qui repondent « quoi, sur quoi, pourquoi, quand »
  const [rec] = getErrors();
  assert.equal(rec.toolName, 'Read');
  assert.equal(rec.subject, 'soutenance-septembre-2026.md');
  assert.match(rec.message, /exceeds maximum allowed tokens/);
  assert.equal(rec.ts, '2026-08-18T13:20:52.000Z');
});

test('l echec retient le noeud a rejoindre, sous l identifiant du graphe', () => {
  // Arrange / Act
  recordError(echec());
  // Assert — `t:` est le prefixe que viz-layout donne aux noeuds d'outil ;
  // sans lui le volet ne saurait pas quoi selectionner.
  assert.equal(getErrors()[0].nodeId, 't:toolu_001');
});

test('l echec retient sa session — le bandeau n en montre jamais qu une', () => {
  // Arrange / Act
  recordError(echec());
  // Assert
  assert.equal(getErrors()[0].sessionId, '11111111-2222-3333-4444-555555555555');
});

test('un echec SANS noeud correspondant est enregistre quand meme', () => {
  // C'est le coeur du correctif : avant, tout le traitement d'un echec vivait
  // sous un `if (n)`. Le registre ne connait pas les noeuds, donc la question
  // ne se pose plus — et c'est ce test qui l'interdit de revenir.
  // Arrange
  const orphelin = echec({ tool_use_id: '' });
  // Act
  recordError(orphelin);
  // Assert
  assert.equal(getErrors().length, 1);
  assert.equal(getErrors()[0].nodeId, null, 'aucun noeud a rejoindre, et c est dit');
});

test('ce qui n est pas un echec n entre pas dans le registre', () => {
  // Arrange
  const succes = echec({ hook_event_name: 'PostToolUse', error: undefined });
  // Act
  recordError(succes);
  // Assert
  assert.equal(getErrors().length, 0);
});

test('un outil inconnu du tableau des sujets ne fait pas tomber la capture', () => {
  // Le sujet est un confort ; le message d'erreur est l'essentiel. Un outil
  // sans regle de sujet doit donner une ligne vide, pas une exception.
  // Arrange
  const exotique = echec({ tool_name: 'OutilJamaisVu', tool_input: { peu_importe: 1 } });
  // Act
  recordError(exotique);
  // Assert
  assert.equal(getErrors()[0].subject, '');
  assert.match(getErrors()[0].message, /exceeds/);
});

test('les erreurs se lisent dans l ordre ou elles sont survenues', () => {
  // Arrange
  recordError(echec({ tool_use_id: 'a', _ts: '2026-08-18T13:00:00.000Z' }));
  recordError(echec({ tool_use_id: 'b', _ts: '2026-08-18T13:05:00.000Z' }));
  // Act
  const recs = getErrors();
  // Assert
  assert.deepEqual(recs.map(r => r.nodeId), ['t:a', 't:b']);
});

test('le registre est plafonne, et ce sont les PLUS ANCIENNES qui partent', () => {
  // Arrange
  for (let i = 0; i < ERRORS_MAX + 5; i++) recordError(echec({ tool_use_id: `t${i}` }));
  // Act
  const recs = getErrors();
  // Assert
  assert.equal(recs.length, ERRORS_MAX);
  assert.equal(recs[recs.length - 1].nodeId, `t:t${ERRORS_MAX + 4}`, 'la derniere erreur est gardee');
  assert.equal(recs[0].nodeId, 't:t5', 'les cinq premieres sont tombees');
});

test('getErrors rend une COPIE — l appelant ne peut pas corrompre le registre', () => {
  // Arrange
  recordError(echec());
  // Act
  getErrors().length = 0;
  // Assert
  assert.equal(getErrors().length, 1);
});

test('le changement de session vide le registre', () => {
  // Sans ca, le rejeu du journal au changement de session compterait deux fois,
  // et le volet melangerait deux sessions — or le bandeau n en montre qu une.
  // Arrange
  recordError(echec());
  // Act
  resetErrors();
  // Assert
  assert.equal(getErrors().length, 0);
});

test('l abonne est prevenu a chaque erreur, et au vidage', () => {
  // Arrange
  let appels = 0;
  onErrorsChanged(() => { appels++; });
  // Act
  recordError(echec());
  resetErrors();
  // Assert — c'est ce signal qui repeint la pastille et le point du flux
  assert.equal(appels, 2);
});

test('un evenement ignore ne reveille personne', () => {
  // Arrange
  let appels = 0;
  onErrorsChanged(() => { appels++; });
  // Act
  recordError(echec({ hook_event_name: 'PostToolUse', error: undefined }));
  // Assert
  assert.equal(appels, 0);
});
