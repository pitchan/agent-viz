// failures-format.js — comment une panne se dit en francais, en un seul
// endroit.
//
// La phrase se compose des CHAMPS de l'alerte, jamais de son `message`
// anglais. Traduire une phrase deja faite serait la seule facon de la voir
// diverger de ce que le detecteur a mesure ; et le `message` sert la
// notification bureau, qui suit la langue du chrome. Donnee structuree d'un
// cote, texte fabrique a l'affichage de l'autre.
//
// Module pur : ni DOM, ni reseau, ni horloge implicite. Meme partage que
// public/observatory/analysis-view.js, dont la part testable est exportee nue
// et la part DOM ne l'est pas.

// Meme convention que lib/server/observatory/project-label.js : la lettre de
// lecteur en majuscule, parce que Windows ignore la casse et que le libelle ne
// doit pas suivre celle du terminal qui a lance la derniere session. Le module
// serveur n'est pas reutilisable ici — il est CommonJS et prend des sessions,
// pas un chemin nu.
export function projectLabel(cwd) {
  if (!cwd) return 'projet inconnu';
  return cwd.replace(/^([a-z]):/, (_, d) => `${d.toUpperCase()}:`);
}

// `occurrences` et `tools` sont TOUJOURS des tableaux chez le detecteur (voir
// l'en-tete de public/viz-watchdog.mjs). Mais ces alertes-ci ne viennent pas du
// detecteur : elles reviennent du journal, qui de leur forme ne connait que
// `id` et `createdAt` et laisse passer tout le reste sans le regarder. Une
// ligne abimee mais encore analysable arrive donc ici telle quelle.
//
// Le defaut n'est pas de la prudence decorative : `loadFailures` avale
// l'erreur, si bien qu'un jet ici n'abimerait pas une ligne mais afficherait le
// bloc ENTIER vide — indiscernable de « aucune panne » sur le seul panneau
// charge de dire qu'il y en a eu.
const listeDe = v => (Array.isArray(v) ? v : []);

// Ce qu'on peut honnetement dire des issues : un compte, jamais un
// quantificateur. L'alerte se leve SUR l'appel qui se repete, dont l'issue
// n'est pas encore revenue et — l'alerte etant une photographie — ne reviendra
// jamais. « Toutes en echec » affirmerait donc sur un appel qu'on n'a pas vu.
// Le denominateur est affiche : le lecteur voit sur quoi porte le compte.
// Meme regle que `failureSuffix` cote module pur, dans l'autre langue.
function failureNote(occurrences) {
  const failed = occurrences.filter(o => o.failed === true);
  if (failed.length === 0) return '';
  return `, ${failed.length} sur ${occurrences.length} en échec`;
}

const HEADLINES = {
  loop: a => `${a.toolName} · même commande ${a.count}×${failureNote(listeDe(a.occurrences))}`,
  retryStorm: a => `${a.toolName} · ${a.count} échecs consécutifs`,
  stuck: a => `Aucun événement · ${a.count} outil${a.count > 1 ? 's' : ''} encore en vol`,
};

function subjectOf(alert) {
  if (alert.type === 'stuck') {
    const first = listeDe(alert.tools)[0];
    return first ? `${first.toolName} · ${first.subject}` : '';
  }
  return alert.subject || '';
}

export function failureLine(alert) {
  const build = HEADLINES[alert.type];
  return {
    time: alert.createdAt,
    project: projectLabel(alert.cwd),
    // Un type inconnu se rend lisible plutot que vide : une ligne muette dans
    // un tableau de bord se lit comme un bug de l'outil.
    headline: build ? build(alert) : String(alert.type),
    subject: subjectOf(alert),
  };
}

// Ce que le titre du bloc a le droit de dire, et rien de plus.
//
// Ce bloc est la MEMOIRE des pannes : il rend ce qui a ete consigne sur la
// fenetre, sans aucune notion de vivacite — le journal n'en a pas. « Encore en
// cours » se decide ailleurs, a la pastille, et par une regle que ce bloc ne
// peut pas rejouer sans la dupliquer : `standing` -> `activeIds`, evenementiel
// -> fraicheur de deux minutes. Sur trente jours, une boucle non acquittee de
// la semaine derniere n'est pas un incident en cours ; l'annoncer comme tel
// rejouerait la confusion que la tache 9 a paye pour trancher.
//
// Donc un compte, et le mot exact de ce qui est compte.
export function failuresSummary(alerts) {
  const n = listeDe(alerts).filter(a => !a.acknowledged).length;
  if (n === 0) return 'aucune';
  return `${n} non acquittée${n > 1 ? 's' : ''}`;
}
