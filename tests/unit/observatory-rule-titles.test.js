'use strict';
// Le verrou : aucune règle ne nomme elle-même son projet.
//
// Quatre règles recollaient chacune « — projet <slug> » dans leur titre. Le
// libellé est désormais posé en un seul endroit (project-label.js, appelé par
// service.scan). Ce fichier empêche la duplication de revenir — y compris par
// une règle écrite plus tard.
//
// Une fixture unique fait tirer TOUTES les règles à sujet projet. C'est
// délibéré : un invariant qui se contente d'itérer sur les règles qu'il sait
// faire tirer ne verrouille rien, puisqu'une règle sans fixture serait sautée en
// silence. Le test échoue donc aussi quand une règle 'project' ne produit rien.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { RULES } = require('../../lib/server/observatory/rules/registry');
const { nameProjects } = require('../../lib/server/observatory/project-label');

const KB = 1024;
const stat = (events, tokens) => ({ events, tokens });

// Une session qui déclenche R1, R4, R5 et R6 à la fois — chaque règle lit une
// partie différente du rapport, elles ne s'excluent pas. Les valeurs sont
// cohérentes entre elles : le churn de préfixe (40 000) domine bien celui des
// compactions (1 000), et main + sous-agent = les jetons nets annoncés.
const ALL_FIRING_SESSION = {
  id: 's1',
  project: 'F--DEV-x',
  startedAt: '2026-07-01T10:00:00.000Z',
  endedAt: '2026-07-01T10:02:00.000Z',
  netTokens: 100000,
  costUsd: 10,
  costComplete: true,
  report: {
    cwd: 'f:\\DEV\\x',
    context: {
      churnCauses: {
        prefixChange: stat(1, 40000), compaction: stat(1, 1000), expiration: stat(0, 0),
        growth: stat(0, 0), unknown: stat(0, 0),
      },
      prefixBreakdown: {
        markers: { modelSwitch: stat(1, 40000), toolsAppeared: stat(0, 0), noMarker: stat(0, 0) },
        noMarkerDetail: { earlyMcp: stat(0, 0), other: stat(0, 0) },
        depth: {
          facade: stat(0, 0), d10to50: stat(1, 40000), d50to90: stat(0, 0), tail: stat(0, 0),
        },
      },
      compactions: [
        { trigger: 'auto', preTokens: 120000 },
        { trigger: 'auto', preTokens: 130000 },
      ],
    },
    reads: {
      totalBytes: 2000 * KB,
      cases: { crossAgentDuplicate: { count: 12, bytes: 500 * KB } },
    },
    toolResults: { byTool: {}, totalBytes: 0, candidateFilters: [] },
    subagents: { sidecarCount: 1, spawnToolUses: 2, byType: {} },
    tokens: {
      main: { in: 60000, out: 0, cacheCreate: 0, cacheRead: 5000 },
      perAgent: { 'agent-aaa': { in: 40000, out: 0, cacheCreate: 0, cacheRead: 3000 } },
      perModel: {},
      costUsd: 10,
      costComplete: true,
    },
  },
};

const ctx = { sessions: [ALL_FIRING_SESSION], configItems: [] };
const projectRules = () => RULES.filter(r => r.subjectKind === 'project');

test('chaque règle déclare la nature de son sujet — contrat identique pour toutes', () => {
  const kinds = new Set(['project', 'mcpServer', 'tool']);
  for (const rule of RULES) {
    assert.ok(kinds.has(rule.subjectKind), `${rule.id} : subjectKind manquant ou inconnu`);
  }
});

test('la fixture fait bien tirer toutes les règles à sujet projet', () => {
  assert.ok(projectRules().length >= 4, 'R1, R4, R5 et R6 ont un projet pour sujet');
  for (const rule of projectRules()) {
    assert.ok(rule.evaluate(ctx).length > 0,
      `${rule.id} ne produit rien : l'invariant ci-dessous la sauterait en silence`);
  }
});

test('aucune règle à sujet projet ne nomme le projet dans son titre', () => {
  for (const rule of projectRules()) {
    for (const rec of rule.evaluate(ctx)) {
      assert.ok(!rec.title.includes('projet'),
        `${rule.id} nomme encore son projet : « ${rec.title} »`);
      assert.equal(rec.subject, 'F--DEV-x', `${rule.id} : le sujet reste le slug`);
    }
  }
});

test('c’est nameProjects qui pose le projet, une seule fois, avec le vrai chemin', () => {
  const recs = projectRules().flatMap(rule => rule.evaluate(ctx));
  for (const named of nameProjects(recs, [ALL_FIRING_SESSION], RULES)) {
    assert.match(named.title, /— projet F:\\DEV\\x$/);
    // Une seule occurrence : un suffixe resté dans une règle produirait un titre
    // à double mention, exactement le défaut que ce fichier verrouille.
    assert.equal(named.title.split('— projet').length - 1, 1);
  }
});
