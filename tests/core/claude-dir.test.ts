import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { CLAUDE_DIR_ENV, resolveClaudeDir, resolveClaudeJsonPath } from '../../src/engine/core/claude-dir.ts';

// Une seule resolution du dossier de configuration, importee par le serveur et par le
// moteur : un nom de variable par moitie du produit ne deplacerait que cette moitie, et
// deux vues liraient deux jeux de sessions sans avertir.
//
// Le nom retenu est CLAUDE_CONFIG_DIR, celui que Claude Code definit lui-meme.
// NETGAIN_CLAUDE_DIR n'est pas lue, meme en repli : le test « NETGAIN_CLAUDE_DIR est
// ignorée » empeche qu'elle revienne.

const HOME = path.join('C:', 'faux-home');
const AILLEURS = path.join('D:', 'ailleurs', '.claude');

describe('resolveClaudeDir', () => {
  test('sans rien de pose, c\'est <home>/.claude', () => {
    expect(resolveClaudeDir({ env: {}, home: HOME })).toBe(path.join(HOME, '.claude'));
  });

  test('la variable d\'environnement l\'emporte sur le home', () => {
    expect(resolveClaudeDir({ env: { [CLAUDE_DIR_ENV]: AILLEURS }, home: HOME })).toBe(AILLEURS);
  });

  test('un chemin explicite (--claude-dir) l\'emporte sur la variable', () => {
    const explicite = path.join('E:', 'explicite');
    expect(resolveClaudeDir({ explicit: explicite, env: { [CLAUDE_DIR_ENV]: AILLEURS }, home: HOME }))
      .toBe(explicite);
  });

  // Une variable VIDE est une variable non posee : lue avec `??`, elle faisait scanner la
  // chaine vide et annoncer « 0 session(s) decouverte(s) sous  », une cecite silencieuse.
  test('une variable VIDE vaut une variable non posee — jamais scanner la chaine vide', () => {
    expect(resolveClaudeDir({ env: { [CLAUDE_DIR_ENV]: '' }, home: HOME })).toBe(path.join(HOME, '.claude'));
  });

  test('un chemin explicite VIDE ne masque pas la variable non plus', () => {
    expect(resolveClaudeDir({ explicit: '', env: { [CLAUDE_DIR_ENV]: AILLEURS }, home: HOME })).toBe(AILLEURS);
  });

  // Temoin negatif : sans lui, une resolution qui lirait ENCORE l'ancienne
  // variable passerait tous les tests ci-dessus.
  test('NETGAIN_CLAUDE_DIR est ignorée', () => {
    expect(resolveClaudeDir({ env: { NETGAIN_CLAUDE_DIR: AILLEURS }, home: HOME }))
      .toBe(path.join(HOME, '.claude'));
  });

  test('le nom expose est bien celui de Claude Code', () => {
    expect(CLAUDE_DIR_ENV).toBe('CLAUDE_CONFIG_DIR');
  });
});

// `.claude.json` (l'inventaire MCP de la carte R2) suit la MEME variable, autrement que le
// dossier : posee, Claude Code 2.1.226 l'ecrit dedans ; absente, a cote du home. Le serveur
// le lit par cette fonction, dans `getObservatoryService` (src/server/observatory/index.ts).
describe('resolveClaudeJsonPath', () => {
  test('sans variable, le fichier est A COTE du dossier, pas dedans', () => {
    // Le piege exact : `path.join(resolveClaudeDir(), '.claude.json')` donnerait
    // <home>/.claude/.claude.json — un fichier qui n'existe nulle part.
    expect(resolveClaudeJsonPath({ env: {}, home: HOME })).toBe(path.join(HOME, '.claude.json'));
    expect(resolveClaudeJsonPath({ env: {}, home: HOME }))
      .not.toBe(path.join(resolveClaudeDir({ env: {}, home: HOME }), '.claude.json'));
  });

  test('avec la variable, le fichier est DANS le dossier de configuration', () => {
    expect(resolveClaudeJsonPath({ env: { [CLAUDE_DIR_ENV]: AILLEURS }, home: HOME }))
      .toBe(path.join(AILLEURS, '.claude.json'));
  });

  test('une variable VIDE vaut une variable non posee, ici aussi', () => {
    expect(resolveClaudeJsonPath({ env: { [CLAUDE_DIR_ENV]: '' }, home: HOME }))
      .toBe(path.join(HOME, '.claude.json'));
  });
});
