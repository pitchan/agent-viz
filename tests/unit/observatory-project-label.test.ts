// Le libellé d'un projet : le vrai chemin de travail, jamais le slug encodé par
// Claude Code — sauf quand ce chemin est inconnu ou ambigu, où le slug redevient
// la réponse honnête.
//
// Deux exigences de stabilité sont testées explicitement, parce qu'un libellé
// qui change d'une analyse à l'autre réécrit les titres en base pour rien :
// le résultat ne doit dépendre ni de la casse rencontrée, ni de l'ordre des
// sessions.

import { expect, test } from 'vitest';
import {
  cwdOf, cwdOfReport, displayPath, projectResolver, nameProjects,
} from '../../src/server/observatory/project-label.ts';
import type { Session, SessionReport, Recommendation, Rule } from '../../src/server/observatory/rules/types.ts';

const session = (project: string, report: Partial<SessionReport>) =>
  ({ id: 's', project, report }) as unknown as Session;
const withCwd = (project: string, cwd: string) => session(project, { cwd });

// ─── cwdOfReport / cwdOf ──────────────────────────────────────────────────

test('un cwd renseigné est rendu tel quel', () => {
  expect(cwdOfReport({ cwd: 'F:\\DEV\\x' } as SessionReport)).toBe('F:\\DEV\\x');
  expect(cwdOf(withCwd('F--DEV-x', 'F:\\DEV\\x'))).toBe('F:\\DEV\\x');
});

test('un cwd absent, nul ou vide vaut « inconnu », jamais une chaîne vide', () => {
  expect(cwdOfReport({} as SessionReport)).toBe(null);
  expect(cwdOfReport({ cwd: null } as SessionReport)).toBe(null);
  expect(cwdOfReport({ cwd: '' } as SessionReport)).toBe(null);
  expect(cwdOfReport(undefined)).toBe(null);
  expect(cwdOf({ project: 'F--p' } as unknown as Session)).toBe(null);
});

// ─── displayPath ──────────────────────────────────────────────────────────

test('la lettre de lecteur est affichée en majuscule, le reste du chemin intact', () => {
  expect(displayPath('f:\\DEV\\Demo IA OPTIM')).toBe('F:\\DEV\\Demo IA OPTIM');
  expect(displayPath('F:\\DEV\\Demo IA OPTIM')).toBe('F:\\DEV\\Demo IA OPTIM');
  // Rien à normaliser hors Windows : le chemin ressort inchangé.
  expect(displayPath('/home/vincent/projet')).toBe('/home/vincent/projet');
});

// ─── projectResolver ──────────────────────────────────────────────────────

test('le résolveur rend le chemin réel du projet', () => {
  const pathOf = projectResolver([withCwd('F--DEV-x', 'f:\\DEV\\x')]);
  expect(pathOf('F--DEV-x')).toBe('F:\\DEV\\x');
});

test('sans cwd connu, le résolveur rend le slug — jamais un vide', () => {
  expect(projectResolver([session('F--p', {})])('F--p')).toBe('F--p');
  expect(projectResolver([])('F--p')).toBe('F--p');
  expect(projectResolver(undefined)('F--p')).toBe('F--p');
});

test('un sujet que le résolveur ne connaît pas se rend lui-même', () => {
  const pathOf = projectResolver([withCwd('F--DEV-x', 'F:\\DEV\\x')]);
  expect(pathOf('mdb-explorer')).toBe('mdb-explorer');
});

test('une session sans cwd ne masque pas une session qui en a un', () => {
  const pathOf = projectResolver([session('F--p', {}), withCwd('F--p', 'F:\\p')]);
  expect(pathOf('F--p')).toBe('F:\\p');
});

test('la casse de la lettre de lecteur ne crée pas deux variantes, quel que soit l’ordre', () => {
  const forward = projectResolver([withCwd('D--x', 'd:\\x'), withCwd('D--x', 'D:\\x')]);
  const backward = projectResolver([withCwd('D--x', 'D:\\x'), withCwd('D--x', 'd:\\x')]);
  expect(forward('D--x')).toBe('D:\\x');
  expect(backward('D--x'), 'le libellé ne doit pas dépendre de l’ordre des sessions').toBe('D:\\x');
});

test('la casse du corps du chemin non plus — Windows l’ignore, c’est le même dossier', () => {
  const forward = projectResolver([withCwd('F--DEV-x', 'f:\\DEV\\x'), withCwd('F--DEV-x', 'f:\\dev\\x')]);
  const backward = projectResolver([withCwd('F--DEV-x', 'f:\\dev\\x'), withCwd('F--DEV-x', 'f:\\DEV\\x')]);
  expect(forward('F--DEV-x')).toBe('F:\\DEV\\x');
  expect(backward('F--DEV-x'), 'même dossier, même libellé, quel que soit l’ordre').toBe('F:\\DEV\\x');
});

// L'aplatissement du slug est destructeur : F:\a-b et F:\a\b donnent le même
// dossier de transcriptions. Les règles agrègent déjà les deux sous une seule
// carte ; en nommer un serait affirmer un demi-vrai.
test('deux dossiers réellement différents sous un même slug rendent le slug, pas l’un des deux', () => {
  const pathOf = projectResolver([withCwd('F--a-b', 'F:\\a-b'), withCwd('F--a-b', 'F:\\a\\b')]);
  expect(pathOf('F--a-b')).toBe('F--a-b');
});

// ─── nameProjects ─────────────────────────────────────────────────────────

const RULES = [
  { id: 'R1', subjectKind: 'project' },
  { id: 'R2', subjectKind: 'mcpServer' },
  { id: 'R3', subjectKind: 'tool' },
] as unknown as Rule[];
const rec = (ruleId: string, subject: string, title: string) =>
  ({ ruleId, subject, title }) as unknown as Recommendation;

test('une recommandation à sujet projet reçoit le chemin réel en suffixe', () => {
  const [out] = nameProjects(
    [rec('R1', 'F--DEV-x', 'Préfixe de cache reconstruit')],
    [withCwd('F--DEV-x', 'f:\\DEV\\x')],
    RULES,
  );
  expect(out!.title).toBe('Préfixe de cache reconstruit — projet F:\\DEV\\x');
  expect(out!.subject, 'le sujet reste l’identité, il ne devient jamais le chemin').toBe('F--DEV-x');
});

test('une recommandation dont le sujet n’est pas un projet ressort intacte', () => {
  const input = [
    rec('R2', 'mdb-explorer', 'Serveur MCP « mdb-explorer » chargé mais quasiment jamais appelé'),
    rec('R3', 'npm test', 'Sorties volumineuses — commande npm test'),
  ];
  const out = nameProjects(input, [withCwd('F--DEV-x', 'F:\\DEV\\x')], RULES);
  expect(out.map(r => r.title)).toEqual(input.map(r => r.title));
});

test('sans chemin connu, le suffixe porte le slug — la carte n’est jamais anonyme', () => {
  const [out] = nameProjects([rec('R1', 'F--p', 'Titre')], [session('F--p', {})], RULES);
  expect(out!.title).toBe('Titre — projet F--p');
});

test('nameProjects ne mute pas les recommandations reçues', () => {
  const input = rec('R1', 'F--DEV-x', 'Titre');
  nameProjects([input], [withCwd('F--DEV-x', 'F:\\DEV\\x')], RULES);
  expect(input.title).toBe('Titre');
});
