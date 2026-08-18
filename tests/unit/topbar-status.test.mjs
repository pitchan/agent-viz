// Ce que ce fichier protege : ce que DISENT les deux temoins du bandeau.
// Deux pastilles vertes identiques et muettes — l'une informative (connexion),
// l'autre un bouton (chien de garde) — etaient indistinguables a l'ecran.
// Le remede est un module pur qui fixe le vocabulaire des deux temoins ;
// le DOM ne fait qu'appliquer. C'est ici que le vocabulaire est epingle,
// parce qu'aucun test unitaire de ce repo ne rend le DOM.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  connectionPresentation,
  watchdogPresentation,
  errorsPresentation,
} from '../../src/web/viz-topbar-status.mjs';

// ─── Le temoin de connexion : un voyant etiquete, pas un rond anonyme ────────

test('connecte, le voyant dit LIVE', () => {
  assert.equal(connectionPresentation(true).label, 'LIVE');
});

test('deconnecte, le voyant dit OFFLINE', () => {
  assert.equal(connectionPresentation(false).label, 'OFFLINE');
});

test('connecte, l infobulle dit ce qui est recu et d ou', () => {
  // « Connected » seul n'expliquait rien : connecte a quoi ? Le mot qui
  // manque est le demon — c'est lui que le voyant surveille.
  assert.match(connectionPresentation(true).title, /daemon/i);
});

test('deconnecte, l infobulle dit que la reconnexion se tente', () => {
  // Un voyant rouge sans consigne laisse l'utilisateur decider seul si c'est
  // grave. La reponse honnete : le client reessaie tout seul.
  assert.match(connectionPresentation(false).title, /reconnect/i);
});

// ─── Le chien de garde : une cloche qui ne parle que si elle a a dire ────────

test('sans alerte, pas de compteur affiche', () => {
  assert.equal(watchdogPresentation(0).countText, null);
});

test('sans alerte, la cloche est au repos', () => {
  assert.equal(watchdogPresentation(0).hasAlerts, false);
});

test('sans alerte, l infobulle invite quand meme au clic', () => {
  // La cloche au repos reste un bouton : si l'infobulle ne le dit pas,
  // rien d'autre ne le dira — c'etait exactement le defaut d'origine.
  assert.match(watchdogPresentation(0).title, /click/i);
});

test('une alerte se compte au singulier', () => {
  // Arrange
  const p = watchdogPresentation(1);
  // Act — lecture pure, l'Act est la construction ci-dessus
  // Assert
  assert.equal(p.countText, '1');
  assert.match(p.title, /1 active alert — /);
  assert.equal(p.hasAlerts, true);
});

test('plusieurs alertes se comptent au pluriel', () => {
  // Arrange
  const p = watchdogPresentation(3);
  // Act — lecture pure, l'Act est la construction ci-dessus
  // Assert
  assert.equal(p.countText, '3');
  assert.match(p.title, /3 active alerts — /);
});

test('la cloche porte un nom pour les lecteurs d ecran, dans les deux etats', () => {
  // Un bouton dont le seul contenu est une icone n'a pas de nom accessible :
  // l'aria-label est le nom, il doit exister avec ou sans alerte.
  assert.match(watchdogPresentation(0).ariaLabel, /watchdog/i);
  assert.match(watchdogPresentation(2).ariaLabel, /2/);
});

// ─── La pastille des erreurs : un compteur qui mene quelque part ─────────────
// Troisieme temoin du bandeau, et le meme defaut que les deux premiers avant
// leur correction : « 1 errors » se lisait sans savoir OU etait cette erreur,
// ni meme que le chiffre etait cliquable.

test('une erreur s accorde au singulier', () => {
  // Le bandeau affichait litteralement « 1 errors ». La faute est visible a
  // l'oeil nu sur la capture d'ecran d'un utilisateur — elle se corrige ici.
  // Arrange
  const p = errorsPresentation(1);
  // Act — lecture pure, l'Act est la construction ci-dessus
  // Assert
  assert.equal(p.countText, '1');
  assert.equal(p.label, 'error');
});

test('plusieurs erreurs s accordent au pluriel', () => {
  // Arrange
  const p = errorsPresentation(4);
  // Act — lecture pure
  // Assert
  assert.equal(p.countText, '4');
  assert.equal(p.label, 'errors');
});

test('zero erreur garde le pluriel et le calme', () => {
  // Arrange
  const p = errorsPresentation(0);
  // Act — lecture pure
  // Assert
  assert.equal(p.countText, '0');
  assert.equal(p.label, 'errors');
  assert.equal(p.hasErrors, false);
});

test('des qu il y a une erreur, la pastille le signale', () => {
  assert.equal(errorsPresentation(1).hasErrors, true);
});

test('l infobulle dit qu on peut cliquer, meme a zero', () => {
  // Exactement la lecon de la cloche : une pastille qui est un bouton dans les
  // deux etats doit le dire dans les deux etats, sinon elle se lit comme un
  // simple chiffre mort — le reproche d'origine.
  assert.match(errorsPresentation(0).title, /click/i);
  assert.match(errorsPresentation(3).title, /click/i);
});

test('l infobulle borne la portee du chiffre a la session', () => {
  // « 1 error » sans plus rend le chiffre inutilisable : une erreur de quoi,
  // depuis quand ? La reponse est : de la session affichee.
  assert.match(errorsPresentation(2).title, /session/i);
});

test('la pastille porte un nom pour les lecteurs d ecran, dans les deux etats', () => {
  assert.match(errorsPresentation(0).ariaLabel, /error/i);
  assert.match(errorsPresentation(5).ariaLabel, /5/);
});
