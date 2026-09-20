// Ce que ce fichier protege : ce que DISENT les temoins du bandeau, pour qu'une
// pastille informative (connexion) et un bouton (chien de garde) ne se confondent
// pas a l'ecran.
//
// Un module pur fixe le vocabulaire des temoins ; le DOM ne fait qu'appliquer.
// C'est ici que le vocabulaire est epingle, parce qu'aucun test unitaire de ce
// repo ne rend le DOM.

import { expect, test } from 'vitest';
import {
  connectionPresentation,
  watchdogPresentation,
  errorsPresentation,
} from '../../src/web/viz-topbar-status.ts';

// ─── Le temoin de connexion : un voyant etiquete, pas un rond anonyme ────────

test('connecte, le voyant dit LIVE', () => {
  expect(connectionPresentation(true).label).toBe('LIVE');
});

test('deconnecte, le voyant dit OFFLINE', () => {
  expect(connectionPresentation(false).label).toBe('OFFLINE');
});

test('connecte, l infobulle dit ce qui est recu et d ou', () => {
  // « Connected » seul n'explique rien : connecte a quoi ? Le mot qui
  // manque est le demon — c'est lui que le voyant surveille.
  expect(connectionPresentation(true).title).toMatch(/daemon/i);
});

test('deconnecte, l infobulle dit que la reconnexion se tente', () => {
  // Un voyant rouge sans consigne laisse l'utilisateur decider seul si c'est
  // grave. La reponse honnete : le client reessaie tout seul.
  expect(connectionPresentation(false).title).toMatch(/reconnect/i);
});

// ─── Le chien de garde : une cloche qui ne parle que si elle a a dire ────────

test('sans alerte, pas de compteur affiche', () => {
  expect(watchdogPresentation(0).countText).toBe(null);
});

test('sans alerte, la cloche est au repos', () => {
  expect(watchdogPresentation(0).hasAlerts).toBe(false);
});

test('sans alerte, l infobulle invite quand meme au clic', () => {
  // La cloche au repos reste un bouton : si l'infobulle ne le dit pas,
  // rien d'autre ne le dira.
  expect(watchdogPresentation(0).title).toMatch(/click/i);
});

test('une alerte se compte au singulier', () => {
  // Arrange
  const p = watchdogPresentation(1);
  // Act — lecture pure, l'Act est la construction ci-dessus
  // Assert
  expect(p.countText).toBe('1');
  expect(p.title).toMatch(/1 active alert — /);
  expect(p.hasAlerts).toBe(true);
});

test('plusieurs alertes se comptent au pluriel', () => {
  // Arrange
  const p = watchdogPresentation(3);
  // Act — lecture pure, l'Act est la construction ci-dessus
  // Assert
  expect(p.countText).toBe('3');
  expect(p.title).toMatch(/3 active alerts — /);
});

test('la cloche porte un nom pour les lecteurs d ecran, dans les deux etats', () => {
  // Un bouton dont le seul contenu est une icone n'a pas de nom accessible :
  // l'aria-label est le nom, il doit exister avec ou sans alerte.
  expect(watchdogPresentation(0).ariaLabel).toMatch(/watchdog/i);
  expect(watchdogPresentation(2).ariaLabel).toMatch(/2/);
});

// ─── La pastille des erreurs : un compteur qui mene quelque part ─────────────
// Troisieme temoin du bandeau : « 1 errors » seul ne dit ni OU est cette erreur,
// ni que le chiffre est cliquable.
//
// La pastille distingue deux etats a partir des faits du registre : l'alarme (un
// echec se repete, ou le tout dernier outil a echoue) et le calme (il y a eu des
// erreurs, la session a continue depuis).

// Le resume tel que le registre le rend ; chaque test ne nomme que ce qui
// l'ecarte du calme.
const resume = (total: number, extra: Record<string, any> = {}) => ({ total, hasRepeat: false, lastFailed: false, ...extra });

test('une erreur s accorde au singulier', () => {
  // « 1 errors » est une faute visible a l'oeil nu : l'accord se fixe ici.
  // Arrange
  const p = errorsPresentation(resume(1));
  // Act — lecture pure, l'Act est la construction ci-dessus
  // Assert
  expect(p.countText).toBe('1');
  expect(p.label).toBe('error');
});

test('plusieurs erreurs s accordent au pluriel', () => {
  // Arrange
  const p = errorsPresentation(resume(4));
  // Act — lecture pure
  // Assert
  expect(p.countText).toBe('4');
  expect(p.label).toBe('errors');
});

test('zero erreur garde le pluriel et le calme', () => {
  // Arrange
  const p = errorsPresentation(resume(0));
  // Act — lecture pure
  // Assert
  expect(p.countText).toBe('0');
  expect(p.label).toBe('errors');
  expect(p.hasErrors).toBe(false);
  expect(p.alarm).toBe(false);
});

test('des qu il y a une erreur, la pastille le signale', () => {
  expect(errorsPresentation(resume(1)).hasErrors).toBe(true);
});

test('l infobulle dit qu on peut cliquer, meme a zero', () => {
  // Exactement la lecon de la cloche : une pastille qui est un bouton dans les
  // deux etats doit le dire dans les deux etats, sinon elle se lit comme un
  // simple chiffre mort.
  expect(errorsPresentation(resume(0)).title).toMatch(/click/i);
  expect(errorsPresentation(resume(3)).title).toMatch(/click/i);
});

test('l infobulle borne la portee du chiffre a la session', () => {
  // « 1 error » sans plus rend le chiffre inutilisable : une erreur de quoi,
  // depuis quand ? La reponse est : de la session affichee.
  expect(errorsPresentation(resume(2)).title).toMatch(/session/i);
});

test('la pastille porte un nom pour les lecteurs d ecran, dans les deux etats', () => {
  expect(errorsPresentation(resume(0)).ariaLabel).toMatch(/error/i);
  expect(errorsPresentation(resume(5)).ariaLabel).toMatch(/5/);
});

test('des erreurs passees SANS signe d insistance restent calmes', () => {
  // Le cas type : une sonde `ls` ratee, corrigee au coup suivant, ne laisse pas un
  // « 1 error » rouge qui se lirait comme un probleme ouvert toute la session.
  // Arrange
  const p = errorsPresentation(resume(2));
  // Act — lecture pure
  // Assert — l'infobulle dit que la session a continue depuis
  expect(p.alarm).toBe(false);
  expect(p.title).toMatch(/moved on/i);
});

test('un echec qui se repete met la pastille en alarme, et l infobulle le dit', () => {
  // Arrange
  const p = errorsPresentation(resume(4, { hasRepeat: true }));
  // Act — lecture pure
  // Assert
  expect(p.alarm).toBe(true);
  expect(p.title).toMatch(/repeat/i);
});

test('un dernier outil en echec met la pastille en alarme, et l infobulle le dit', () => {
  // « En train d'echouer, maintenant » — c'est le seul moment ou la pastille
  // doit appeler le regard sans attendre.
  // Arrange
  const p = errorsPresentation(resume(2, { lastFailed: true }));
  // Act — lecture pure
  // Assert
  expect(p.alarm).toBe(true);
  expect(p.title).toMatch(/last tool call failed/i);
});

test('quand tout va mal a la fois, la repetition a le dernier mot', () => {
  // La repetition est le signe le plus diagnostique : un agent qui boucle.
  // L'infobulle n'a la place que d'une explication ; c'est celle-la.
  // Arrange
  const p = errorsPresentation(resume(6, { hasRepeat: true, lastFailed: true }));
  // Act — lecture pure
  // Assert
  expect(p.alarm).toBe(true);
  expect(p.title).toMatch(/repeat/i);
});

test('l alarme se dit aussi aux lecteurs d ecran', () => {
  // Le rouge du chiffre est invisible a qui ne le voit pas : l'etat doit
  // passer par les mots.
  expect(errorsPresentation(resume(4, { hasRepeat: true })).ariaLabel).toMatch(/repeat/i);
  expect(errorsPresentation(resume(2, { lastFailed: true })).ariaLabel).toMatch(/fail/i);
});
