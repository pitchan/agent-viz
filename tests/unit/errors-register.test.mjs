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
  recordError, recordSuccess, getErrors, getErrorsSummary,
  resetErrors, onErrorsChanged, ERRORS_MAX,
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

const succes = (extra = {}) => ({
  hook_event_name: 'PostToolUse',
  session_id: '11111111-2222-3333-4444-555555555555',
  tool_name: 'Bash',
  tool_input: { command: 'git status' },
  tool_use_id: 'toolu_ok1',
  _ts: '2026-08-18T13:21:00.000Z',
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
  // Deux SUJETS distincts : la meme erreur qui revient ne fait pas une ligne
  // de plus, elle s'empile — c'est teste plus bas.
  // Arrange
  recordError(echec({ tool_use_id: 'a', tool_input: { file_path: 'a.md' }, _ts: '2026-08-18T13:00:00.000Z' }));
  recordError(echec({ tool_use_id: 'b', tool_input: { file_path: 'b.md' }, _ts: '2026-08-18T13:05:00.000Z' }));
  // Act
  const recs = getErrors();
  // Assert
  assert.deepEqual(recs.map(r => r.nodeId), ['t:a', 't:b']);
});

test('le registre est plafonne en lignes DISTINCTES, les plus anciennes partent', () => {
  // Arrange — chaque echec a son sujet, donc sa ligne : aucun empilement ici.
  for (let i = 0; i < ERRORS_MAX + 5; i++) {
    recordError(echec({ tool_use_id: `t${i}`, tool_input: { file_path: `f${i}.md` } }));
  }
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

// ─── Vieillissement honnete : repetition, continuite, dernier verdict ───────
//
// La pastille disait « 1 error » toute la session, qu'il s'agisse d'une sonde
// rattrapee trente secondes plus tard ou d'un agent qui boucle sur le meme
// echec. Le registre apprend ici a distinguer les deux SANS interpreter :
// il compte (repetitions, succes ecoules), il ne conclut jamais.

test('une erreur neuve dit : jamais repetee, rien reussi depuis', () => {
  // Arrange / Act
  recordError(echec());
  // Assert
  const [rec] = getErrors();
  assert.equal(rec.count, 1);
  assert.equal(rec.successesSince, 0);
});

test('le fait de continuite compte les outils reussis DEPUIS l erreur, pas avant', () => {
  // Arrange — deux succes AVANT l'echec ne doivent rien prouver sur lui
  recordSuccess(succes({ tool_use_id: 'ok1' }));
  recordSuccess(succes({ tool_use_id: 'ok2' }));
  recordError(echec());
  // Act
  recordSuccess(succes({ tool_use_id: 'ok3' }));
  recordSuccess(succes({ tool_use_id: 'ok4' }));
  recordSuccess(succes({ tool_use_id: 'ok5' }));
  // Assert
  assert.equal(getErrors()[0].successesSince, 3);
});

test('la meme erreur qui revient s empile sur sa ligne au lieu d en creer une', () => {
  // Arrange
  recordError(echec({ tool_use_id: 'x1' }));
  // Act — meme outil, meme sujet, autre appel
  recordError(echec({ tool_use_id: 'x2' }));
  // Assert — une ligne, deux occurrences, et c'est la DERNIERE qu'on rejoint
  const recs = getErrors();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].count, 2);
  assert.equal(recs[0].nodeId, 't:x2');
});

test('quand l erreur revient, la continuite repart de la DERNIERE occurrence', () => {
  // Arrange
  recordError(echec({ tool_use_id: 'x1' }));
  recordSuccess(succes({ tool_use_id: 'ok1' }));
  recordSuccess(succes({ tool_use_id: 'ok2' }));
  // Act
  recordError(echec({ tool_use_id: 'x2' }));
  // Assert — « 2 reussis depuis » eut ete un mensonge : l'echec vient de revenir
  assert.equal(getErrors()[0].successesSince, 0);
});

test('deux sujets differents restent deux lignes distinctes', () => {
  // Arrange / Act
  recordError(echec({ tool_input: { file_path: 'a.md' } }));
  recordError(echec({ tool_input: { file_path: 'b.md' } }));
  // Assert
  assert.equal(getErrors().length, 2);
});

test('sans sujet connu, c est le message qui identifie la repetition', () => {
  // Un outil hors du tableau des sujets donne un sujet vide ; deux echecs au
  // meme message sont pourtant la meme erreur, et deux messages differents non.
  // Arrange / Act
  recordError(echec({ tool_name: 'OutilJamaisVu', tool_use_id: 'y1' }));
  recordError(echec({ tool_name: 'OutilJamaisVu', tool_use_id: 'y2' }));
  recordError(echec({ tool_name: 'OutilJamaisVu', tool_use_id: 'y3', error: 'autre panne' }));
  // Assert
  const recs = getErrors();
  assert.equal(recs.length, 2);
  assert.equal(recs[0].count, 2);
});

test('le resume dit le TOTAL des echecs, pas le nombre de lignes', () => {
  // Arrange — trois echecs en deux lignes (x2 + 1)
  recordError(echec({ tool_use_id: 'x1' }));
  recordError(echec({ tool_use_id: 'x2' }));
  recordError(echec({ tool_use_id: 'z1', tool_input: { file_path: 'autre.md' } }));
  // Act
  const s = getErrorsSummary();
  // Assert
  assert.equal(s.total, 3);
  assert.equal(s.hasRepeat, true);
});

test('le resume sans repetition ne crie pas', () => {
  // Arrange / Act
  recordError(echec({ tool_input: { file_path: 'a.md' } }));
  recordError(echec({ tool_input: { file_path: 'b.md' } }));
  // Assert
  assert.equal(getErrorsSummary().hasRepeat, false);
});

test('le resume sait si le TOUT DERNIER outil a echoue', () => {
  // Arrange / Act / Assert — vrai juste apres l'echec…
  recordError(echec());
  assert.equal(getErrorsSummary().lastFailed, true);
  // …faux des que la session repart
  recordSuccess(succes());
  assert.equal(getErrorsSummary().lastFailed, false);
});

test('un succes sans erreur enregistree ne reveille personne', () => {
  // Le cas de tres loin le plus frequent : une session sans echec ne doit pas
  // payer une repeinture par appel d'outil.
  // Arrange
  let appels = 0;
  onErrorsChanged(() => { appels++; });
  // Act
  recordSuccess(succes());
  // Assert
  assert.equal(appels, 0);
});

test('apres une erreur, chaque succes reveille — la pastille doit vieillir a l ecran', () => {
  // Arrange
  recordError(echec());
  let appels = 0;
  onErrorsChanged(() => { appels++; });
  // Act
  recordSuccess(succes());
  // Assert
  assert.equal(appels, 1);
});

test('l abonne apprend la RAISON du reveil', () => {
  // L'abonne du bandeau reconstruit tout le flux sur une erreur — justifie
  // parce qu'elles sont rares. Un succes n'a pas ce prix : il doit pouvoir ne
  // repeindre que la pastille. D'ou la raison, transmise avec la liste.
  // Arrange
  const raisons = [];
  onErrorsChanged((_recs, raison) => { raisons.push(raison); });
  // Act
  recordError(echec());
  recordSuccess(succes());
  resetErrors();
  // Assert
  assert.deepEqual(raisons, ['error', 'success', 'reset']);
});

test('le vidage oublie aussi le dernier verdict', () => {
  // Arrange
  recordError(echec());
  // Act
  resetErrors();
  // Assert — sinon la session suivante heriterait d'un « en train d'echouer »
  assert.equal(getErrorsSummary().lastFailed, false);
  assert.equal(getErrorsSummary().total, 0);
});
