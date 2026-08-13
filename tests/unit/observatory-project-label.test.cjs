'use strict';
// Le libellé d'un projet : le vrai chemin de travail, jamais le slug encodé par
// Claude Code — sauf quand ce chemin est inconnu ou ambigu, où le slug redevient
// la réponse honnête.
//
// Deux exigences de stabilité sont testées explicitement, parce qu'un libellé
// qui change d'une analyse à l'autre réécrit les titres en base pour rien :
// le résultat ne doit dépendre ni de la casse rencontrée, ni de l'ordre des
// sessions.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  cwdOf, cwdOfReport, displayPath, projectResolver, nameProjects,
} = require('../../src/server/observatory/project-label.ts');

const session = (project, report) => ({ id: 's', project, report });
const withCwd = (project, cwd) => session(project, { cwd });

// ─── cwdOfReport / cwdOf ──────────────────────────────────────────────────

test('un cwd renseigné est rendu tel quel', () => {
  assert.equal(cwdOfReport({ cwd: 'F:\\DEV\\x' }), 'F:\\DEV\\x');
  assert.equal(cwdOf(withCwd('F--DEV-x', 'F:\\DEV\\x')), 'F:\\DEV\\x');
});

test('un cwd absent, nul ou vide vaut « inconnu », jamais une chaîne vide', () => {
  assert.equal(cwdOfReport({}), null);
  assert.equal(cwdOfReport({ cwd: null }), null);
  assert.equal(cwdOfReport({ cwd: '' }), null);
  assert.equal(cwdOfReport(undefined), null);
  assert.equal(cwdOf({ project: 'F--p' }), null);
});

// ─── displayPath ──────────────────────────────────────────────────────────

test('la lettre de lecteur est affichée en majuscule, le reste du chemin intact', () => {
  assert.equal(displayPath('f:\\DEV\\Demo IA OPTIM'), 'F:\\DEV\\Demo IA OPTIM');
  assert.equal(displayPath('F:\\DEV\\Demo IA OPTIM'), 'F:\\DEV\\Demo IA OPTIM');
  // Rien à normaliser hors Windows : le chemin ressort inchangé.
  assert.equal(displayPath('/home/vincent/projet'), '/home/vincent/projet');
});

// ─── projectResolver ──────────────────────────────────────────────────────

test('le résolveur rend le chemin réel du projet', () => {
  const pathOf = projectResolver([withCwd('F--DEV-x', 'f:\\DEV\\x')]);
  assert.equal(pathOf('F--DEV-x'), 'F:\\DEV\\x');
});

test('sans cwd connu, le résolveur rend le slug — jamais un vide', () => {
  assert.equal(projectResolver([session('F--p', {})])('F--p'), 'F--p');
  assert.equal(projectResolver([])('F--p'), 'F--p');
  assert.equal(projectResolver(undefined)('F--p'), 'F--p');
});

test('un sujet que le résolveur ne connaît pas se rend lui-même', () => {
  const pathOf = projectResolver([withCwd('F--DEV-x', 'F:\\DEV\\x')]);
  assert.equal(pathOf('mdb-explorer'), 'mdb-explorer');
});

test('une session sans cwd ne masque pas une session qui en a un', () => {
  const pathOf = projectResolver([session('F--p', {}), withCwd('F--p', 'F:\\p')]);
  assert.equal(pathOf('F--p'), 'F:\\p');
});

test('la casse de la lettre de lecteur ne crée pas deux variantes, quel que soit l’ordre', () => {
  const forward = projectResolver([withCwd('D--x', 'd:\\x'), withCwd('D--x', 'D:\\x')]);
  const backward = projectResolver([withCwd('D--x', 'D:\\x'), withCwd('D--x', 'd:\\x')]);
  assert.equal(forward('D--x'), 'D:\\x');
  assert.equal(backward('D--x'), 'D:\\x', 'le libellé ne doit pas dépendre de l’ordre des sessions');
});

test('la casse du corps du chemin non plus — Windows l’ignore, c’est le même dossier', () => {
  const forward = projectResolver([withCwd('F--DEV-x', 'f:\\DEV\\x'), withCwd('F--DEV-x', 'f:\\dev\\x')]);
  const backward = projectResolver([withCwd('F--DEV-x', 'f:\\dev\\x'), withCwd('F--DEV-x', 'f:\\DEV\\x')]);
  assert.equal(forward('F--DEV-x'), 'F:\\DEV\\x');
  assert.equal(backward('F--DEV-x'), 'F:\\DEV\\x', 'même dossier, même libellé, quel que soit l’ordre');
});

// L'aplatissement du slug est destructeur : F:\a-b et F:\a\b donnent le même
// dossier de transcriptions. Les règles agrègent déjà les deux sous une seule
// carte ; en nommer un serait affirmer un demi-vrai.
test('deux dossiers réellement différents sous un même slug rendent le slug, pas l’un des deux', () => {
  const pathOf = projectResolver([withCwd('F--a-b', 'F:\\a-b'), withCwd('F--a-b', 'F:\\a\\b')]);
  assert.equal(pathOf('F--a-b'), 'F--a-b');
});

// ─── nameProjects ─────────────────────────────────────────────────────────

const RULES = [
  { id: 'R1', subjectKind: 'project' },
  { id: 'R2', subjectKind: 'mcpServer' },
  { id: 'R3', subjectKind: 'tool' },
];
const rec = (ruleId, subject, title) => ({ ruleId, subject, title });

test('une recommandation à sujet projet reçoit le chemin réel en suffixe', () => {
  const [out] = nameProjects(
    [rec('R1', 'F--DEV-x', 'Préfixe de cache reconstruit')],
    [withCwd('F--DEV-x', 'f:\\DEV\\x')],
    RULES,
  );
  assert.equal(out.title, 'Préfixe de cache reconstruit — projet F:\\DEV\\x');
  assert.equal(out.subject, 'F--DEV-x', 'le sujet reste l’identité, il ne devient jamais le chemin');
});

test('une recommandation dont le sujet n’est pas un projet ressort intacte', () => {
  const input = [
    rec('R2', 'mdb-explorer', 'Serveur MCP « mdb-explorer » chargé mais quasiment jamais appelé'),
    rec('R3', 'npm test', 'Sorties volumineuses — commande npm test'),
  ];
  const out = nameProjects(input, [withCwd('F--DEV-x', 'F:\\DEV\\x')], RULES);
  assert.deepEqual(out.map(r => r.title), input.map(r => r.title));
});

test('sans chemin connu, le suffixe porte le slug — la carte n’est jamais anonyme', () => {
  const [out] = nameProjects([rec('R1', 'F--p', 'Titre')], [session('F--p', {})], RULES);
  assert.equal(out.title, 'Titre — projet F--p');
});

test('nameProjects ne mute pas les recommandations reçues', () => {
  const input = rec('R1', 'F--DEV-x', 'Titre');
  nameProjects([input], [withCwd('F--DEV-x', 'F:\\DEV\\x')], RULES);
  assert.equal(input.title, 'Titre');
});
