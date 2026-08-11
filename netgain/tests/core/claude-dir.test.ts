import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { CLAUDE_DIR_ENV, resolveClaudeDir, resolveClaudeJsonPath } from '../../src/core/claude-dir.js';

// C5 (docs/audit-qualite-code.md) : DEUX variables d'environnement designaient le
// meme dossier dans un SEUL paquet npm — CLAUDE_CONFIG_DIR cote produit
// (lib/server/observatory/index.js), NETGAIN_CLAUDE_DIR cote moteur (ici). Poser
// l'une ne changeait que la moitie correspondante : deux vues du meme produit sur
// deux jeux de sessions, sans qu'aucun message n'avertisse de l'ecart.
//
// Prouve par execution avant d'ecrire une ligne, les quatre croisements :
//   NETGAIN_CLAUDE_DIR pose -> moteur 1 session / serveur ~/.claude
//   CLAUDE_CONFIG_DIR  pose -> moteur 0 session / serveur dossier pose
//
// C'est CLAUDE_CONFIG_DIR qui survit, et pas par gout : c'est le nom que Claude
// Code definit LUI-MEME (31 occurrences dans le binaire 2.1.226 installe, 0 pour
// NETGAIN_CLAUDE_DIR — temoin negatif). Le moteur observe ce produit ; il adopte
// donc son vocabulaire au lieu d'en inventer un second.
//
// L'ancienne variable est SUPPRIMEE, pas repliee (arbitrage de Vincent) : le
// produit n'est installe que chez lui et la variable n'etait annoncee qu'au
// `netgain --help`. Le dernier test de ce fichier est le filet qui empeche
// qu'elle revienne par megarde.

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

  // La SECONDE divergence, invisible dans le rapport d'audit et trouvee en
  // executant : le moteur employait `??` (nullish) la ou le serveur employait
  // `||` (falsy). Avec la variable posee mais VIDE, le moteur scannait la chaine
  // vide et annoncait « 0 session(s) decouverte(s) sous  » — une cecite totale,
  // en silence, alors que le serveur retombait correctement sur ~/.claude.
  // Une variable vide EST une variable non posee : c'est le sens du serveur qui
  // est retenu, sur les deux moities.
  test('une variable VIDE vaut une variable non posee — jamais scanner la chaine vide', () => {
    expect(resolveClaudeDir({ env: { [CLAUDE_DIR_ENV]: '' }, home: HOME })).toBe(path.join(HOME, '.claude'));
  });

  test('un chemin explicite VIDE ne masque pas la variable non plus', () => {
    expect(resolveClaudeDir({ explicit: '', env: { [CLAUDE_DIR_ENV]: AILLEURS }, home: HOME })).toBe(AILLEURS);
  });

  // Temoin negatif : sans lui, une resolution qui lirait ENCORE l'ancienne
  // variable passerait tous les tests ci-dessus.
  test('NETGAIN_CLAUDE_DIR n\'est plus lue — l\'ancienne variable est morte', () => {
    expect(resolveClaudeDir({ env: { NETGAIN_CLAUDE_DIR: AILLEURS }, home: HOME }))
      .toBe(path.join(HOME, '.claude'));
  });

  test('le nom expose est bien celui de Claude Code', () => {
    expect(CLAUDE_DIR_ENV).toBe('CLAUDE_CONFIG_DIR');
  });
});

// `~/.claude.json` porte l'inventaire MCP que lit la carte R2 de l'Observatoire.
// La MEME variable le deplace — etabli PAR EXECUTION sur Claude Code 2.1.226,
// les deux branches, dans un home entierement jetable :
//   CLAUDE_CONFIG_DIR posee     -> ecrit $CLAUDE_CONFIG_DIR/.claude.json
//   CLAUDE_CONFIG_DIR non posee -> ecrit ~/.claude.json
// Recoupe sur la machine reelle : C:/Users/Vincent/.claude.json existe,
// C:/Users/Vincent/.claude/.claude.json n'existe pas.
//
// Le produit, lui, cherchait ce fichier au home DANS TOUS LES CAS
// (lib/server/observatory/index.js:34). Ce n'est pas une hypothese : c'est ce
// qui fait disparaitre la carte R2 du protocole de controle de Vincent, ou
// USERPROFILE est jetable et CLAUDE_CONFIG_DIR reel — cout note comme « assume »
// dans sa recette, alors que c'etait ce defaut-ci.
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
