import { describe, expect, test } from 'vitest';
import { detectGraphSignal, NUDGE_LINE } from '../../src/engine/router/detector.js';

/**
 * Corpus étiqueté selon la ligne de partage post-J5 (spec §2.3 corrigée) :
 * le détecteur ne tire QUE sur les signaux de graphe d'imports — « quel impact /
 * qui dépend de / qui importe / blast radius / importeurs transitifs / fichiers
 * chauds ». Les questions énumérables par motif (routes, env, où, comment) sont
 * des NÉGATIFS : c'est le geste perdant mesuré en S11 (+18/+39/+80 %).
 * Calibrage acté : précision avant rappel (faux négatif = statu quo, gratuit).
 */

// Prompts réels des tours S10 (habitat) — le régime gagnant du graphe.
const S10_GRAPH_TURNS = [
  "Je prevois de modifier le store d'auth `frontend/src/app/features/auth/store/auth.store.ts`. Donne-moi le blast radius COMPLET et TRANSITIF (pas seulement les imports directs) : tous les fichiers, guards, pages et routes impactes en cascade, avec le COMPTE TOTAL.",
  'Quels sont les 8 fichiers les plus importes du frontend (= plus haut risque de changement), et par combien de fichiers chacun est-il importe ?',
  'Compare le blast radius de `frontend/src/app/open-api/configuration.ts` avec celui de `frontend/src/app/features/auth/store/auth.store.ts`. Lequel est le plus risque a modifier ?',
];

const OTHER_GRAPH_POSITIVES = [
  "Quel est l'impact de modifier src/core/events.ts sur le reste du repo ?",
  'Qui dépend de configuration.ts dans ce projet ?',
  'Qui importe le module de pricing ?',
  'Donne-moi les importeurs transitifs de src/map/engine.ts.',
  'Montre-moi les fichiers chauds du repo avant que je touche au store.',
  'What is the blast radius of changing auth.store.ts?',
  'What depends on src/core/events.ts?',
  'Who imports the pricing module?',
  'Which files import discovery.ts, directly or transitively?',
  'Show me the hot files / most imported files of this repo.',
];

// Prompts réels des 4 tours S11 — l'audit énumérable, terrain PERDANT mesuré :
// le détecteur ne doit tirer sur AUCUN (négatifs du jeu de test, spec §2.3).
const S11_NEGATIVE_TURNS = [
  "Fais l'inventaire de la surface d'API HTTP du backend : combien d'endpoints exposes au TOTAL, repartis par methode HTTP (GET/POST/PUT/PATCH/DELETE) ? Donne aussi les 5 controllers qui portent le plus d'endpoints, avec le compte de chacun. Ne lis pas le corps des handlers.",
  "Quel est le mecanisme d'authentification qui protege ces endpoints (global ? par route ?), et quels endpoints sont accessibles SANS AUCUNE authentification ? Liste-les (methode + chemin + fichier) et explique comment tu les as distingues.",
  "Parmi les endpoints mutateurs (POST/PUT/PATCH/DELETE) : lesquels acceptent un corps de requete, et ce corps est-il valide (par quel mecanisme) ? Liste les endpoints mutateurs dont l'entree n'est PAS validee, s'il y en a.",
  "Synthese d'audit : sur la base des 3 tours precedents, donne le top 3 des endpoints les plus risques de cette surface d'API (exposition vs protection vs effet de bord), avec une justification CHIFFREE pour chacun.",
];

// Tours S10 qui ne sont PAS des questions de graphe : énumération de routes
// (tour 3), env (tour 4), synthèse (tour 6) — l'auto-routage par descriptions
// d'outils (étage §2.1) s'en charge, pas le router.
const S10_NON_GRAPH_TURNS = [
  "Liste tous les endpoints HTTP exposes par le backend lies a l'authentification (methode + chemin + fichier handler).",
  "Quelles variables d'environnement sont REQUISES (sans valeur par defaut) pour demarrer l'application ? Donne le nom et le fichier source de chacune.",
  'Sur la base de TOUT ce qui precede, donne le top 3 des fichiers a ne jamais modifier sans revue approfondie, avec la justification CHIFFREE pour chacun.',
];

// Les anciens motifs de la spec initiale (où / comment / quelles routes) —
// candidats au nudge avant J5, négatifs depuis (dont les 868 « routes » de J0).
const EX_CANDIDATE_NEGATIVES = [
  'Où est définie la route de login ?',
  "Comment fonctionne l'authentification dans ce projet ?",
  'Quelles routes expose le backend ?',
  'Liste les endpoints REST du backend.',
  'What routes does the backend expose?',
  'Quelles variables d’environnement sont requises au démarrage ?',
];

// Prompts de travail ordinaires (régime S2) et bruit de harnais.
const ORDINARY_NEGATIVES = [
  'Corrige le bug du formulaire de login : le bouton reste grisé après saisie valide.',
  'git status puis commite les changements en cours.',
  'Ajoute un test unitaire pour parsePositiveInt.',
  'Explique-moi ce que fait ce fichier.',
];

describe('detectGraphSignal — signaux de graphe SEULS (spec §2.3 post-J5)', () => {
  test.each(S10_GRAPH_TURNS.map((p) => [p.slice(0, 60), p]))(
    'positif S10 (graphe) : %s…',
    (_label, prompt) => {
      expect(detectGraphSignal(prompt)).not.toBeNull();
    },
  );

  test.each(OTHER_GRAPH_POSITIVES.map((p) => [p.slice(0, 60), p]))(
    'positif (graphe FR/EN) : %s…',
    (_label, prompt) => {
      expect(detectGraphSignal(prompt)).not.toBeNull();
    },
  );

  test.each(S11_NEGATIVE_TURNS.map((p) => [p.slice(0, 60), p]))(
    'négatif S11 (énumérable — le geste perdant) : %s…',
    (_label, prompt) => {
      expect(detectGraphSignal(prompt)).toBeNull();
    },
  );

  test.each(S10_NON_GRAPH_TURNS.map((p) => [p.slice(0, 60), p]))(
    'négatif S10 non-graphe (routes/env/synthèse) : %s…',
    (_label, prompt) => {
      expect(detectGraphSignal(prompt)).toBeNull();
    },
  );

  test.each(EX_CANDIDATE_NEGATIVES.map((p) => [p.slice(0, 60), p]))(
    'négatif ex-candidat (où/comment/routes — reclassés post-J5) : %s…',
    (_label, prompt) => {
      expect(detectGraphSignal(prompt)).toBeNull();
    },
  );

  test.each(ORDINARY_NEGATIVES.map((p) => [p.slice(0, 60), p]))(
    'négatif ordinaire (S2/ops) : %s…',
    (_label, prompt) => {
      expect(detectGraphSignal(prompt)).toBeNull();
    },
  );

  test('bruit de harnais : tag XML contenant un mot-signal → null (garde isNoise)', () => {
    expect(detectGraphSignal('<task-notification>impact analysis done</task-notification>')).toBeNull();
  });

  test('prompt vide ou blanc → null', () => {
    expect(detectGraphSignal('')).toBeNull();
    expect(detectGraphSignal('   ')).toBeNull();
  });

  test('le signal retourné est nommé (observabilité) : blast radius → blast-radius', () => {
    expect(detectGraphSignal('donne le blast radius de x.ts')).toBe('blast-radius');
  });
});

describe('NUDGE_LINE — la ligne injectée (spec §2.3)', () => {
  test('nudge vers map_impact et map_hot uniquement — jamais map_routes/map_orient/map_env (le piège S11)', () => {
    expect(NUDGE_LINE).toContain('map_impact');
    expect(NUDGE_LINE).toContain('map_hot');
    expect(NUDGE_LINE).not.toContain('map_routes');
    expect(NUDGE_LINE).not.toContain('map_orient');
    expect(NUDGE_LINE).not.toContain('map_env');
  });

  test('une seule ligne, courte (le coût d’un faux positif = cette ligne)', () => {
    expect(NUDGE_LINE).not.toContain('\n');
    expect(NUDGE_LINE.length).toBeLessThan(300);
  });
});
