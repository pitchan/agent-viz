// failures-format.ts — comment une panne se dit en francais, en un seul
// endroit.
//
// La phrase se compose des CHAMPS de l'alerte, jamais de son `message`
// anglais. Traduire une phrase deja faite serait la seule facon de la voir
// diverger de ce que le detecteur a mesure ; et le `message` sert la
// notification bureau, qui suit la langue du chrome. Donnee structuree d'un
// cote, texte fabrique a l'affichage de l'autre.
//
// Module pur : ni DOM, ni reseau, ni horloge implicite. Meme partage que
// src/web/observatory/analysis-view.ts, dont la part testable est exportee nue
// et la part DOM ne l'est pas.

// Les alertes arrivent vérifiées par viz-alert-shape.ts, à l'entrée du
// navigateur : ce fichier lit le type du détecteur et ne vérifie pas la forme.
import type { Alert, AlertType } from '../../engine/watchdog/detector.ts';

// Une cause (groupKey) et ses episodes, du plus recent au plus ancien.
export interface AlertGroup {
  key: string;
  episodes: Alert[];
  lastAt: number;
  unacked: number;
}

// Meme convention que src/server/observatory/project-label.ts : la lettre de
// lecteur en majuscule, parce que Windows ignore la casse et que le libelle ne
// doit pas suivre celle du terminal qui a lance la derniere session. Le module
// serveur n'est pas reutilisable ici — il prend des sessions,
// pas un chemin nu.
export function projectLabel(cwd: string | null | undefined): string {
  if (!cwd) return 'projet inconnu';
  return cwd.replace(/^([a-z]):/, (_, d) => `${d.toUpperCase()}:`);
}

// Ce qu'on peut honnetement dire des issues : un compte, jamais un
// quantificateur. L'alerte se leve SUR l'appel qui se repete, dont l'issue
// n'est pas encore revenue et — l'alerte etant une photographie — ne reviendra
// jamais. « Toutes en echec » affirmerait donc sur un appel qu'on n'a pas vu.
// Le denominateur est affiche : le lecteur voit sur quoi porte le compte.
// Meme regle que `failureSuffix` cote module pur, dans l'autre langue.
function failureNote(occurrences: Alert['occurrences']) {
  const failed = occurrences.filter(o => o.failed === true);
  if (failed.length === 0) return '';
  return `, ${failed.length} sur ${occurrences.length} en échec`;
}

// Ce que dit un identifiant de motif d'invocation, en clair.
//
// C'est ici, et nulle part ailleurs, que `inv-bash-windows-path-unquoted`
// redevient une phrase. Elle se compose du seul `patternId` — jamais du
// message d'erreur, qui n'est pas consigne (verrou watchdog-bad-invocation).
// La commande, elle, vit dans `subject`, consignee integrale, et s'affiche dans
// le depliage : la phrase du motif n'a rien d'autre a composer, et c'est voulu —
// elle nomme le reglage a poser, pas l'incident.
//
// Chaque phrase dit ce qui a ete mal ecrit, pas ce que l'outil a repondu : ce
// que le lecteur cherche ici, c'est le reglage a poser une fois.
const MOTIFS: Record<string, string> = {
  'inv-bash-windows-path-unquoted': 'un chemin Windows non protégé sous un shell POSIX',
  'inv-bash-cd-too-many-args': 'un changement de dossier vers un chemin non protégé',
  'inv-bash-trailing-backslash-in-path': 'un guillemet double non fermé — typiquement un chemin Windows terminé par un antislash',
  'inv-bash-heredoc-too-large': 'un guillemet simple non fermé — typiquement un heredoc trop gros pour la ligne de commande',
  // Un SYMPTOME sans remede, juste ici seulement : ce motif est le FILET, qui ne se
  // declenche que si aucune des deux ancres ne reconnait la forme. La cause n'etant
  // pas caracterisee, « un guillemet ouvert et jamais referme » est tout ce qu'on sait.
  'inv-bash-unbalanced-quote': 'un guillemet ouvert et jamais refermé',
  'inv-bash-syntax-error': 'une syntaxe que le shell POSIX ne sait pas lire',
  // Phrase INERTE, gardée à dessein : le motif est hors du sous-ensemble qui alerte
  // (`workstationSetting: false`, il ne distingue un cmdlet d'un binaire absent que par
  // la casse du nom). Elle reste juste, et un motif re-calibré la retrouverait.
  'inv-cross-shell-cmdlet-in-posix': 'une commande PowerShell lancée sous un shell POSIX',
  'inv-ps-command-not-found': 'une commande que PowerShell ne connaît pas',
  'inv-ps-parameter-not-found': 'un paramètre que cette commande PowerShell n’a pas',
  'inv-ps-argument-type': 'un argument PowerShell du mauvais type',
  'inv-ps-syntax': 'une syntaxe que PowerShell ne sait pas lire',
  'inv-ps-argument-exception': 'un argument que la commande PowerShell a refusé',
};

// La table des motifs (src/engine/watchdog/invocation-patterns.ts) grandit a chaque cas
// rencontre, et elle n'a aucune raison d'attendre ce fichier-ci pour le faire.
// Un motif encore inconnu doit donc dire ce qu'on sait vraiment — qu'il y a un
// reglage a poser — plutot que de laisser un trou dans la phrase : une ligne
// muette dans un tableau de bord se lit comme un bug de l'outil.
const REGLAGE_INCONNU = 'un réglage du poste de travail';

// Le detecteur compte des la premiere occurrence — c'est son role. Mais « 1
// fois dans la session » n'apprend rien et occupe la ligne : le compte ne se
// dit qu'a partir du moment ou il distingue quelque chose.
const repetitionNote = (count: number) => (count > 1 ? `, ${count} fois dans la session` : '');

const HEADLINES: Record<AlertType, (a: Alert) => string> = {
  loop: a => `${a.toolName} · même commande ${a.count}×${failureNote(a.occurrences)}`,
  retryStorm: a => `${a.toolName} · ${a.count} échecs consécutifs`,
  stuck: a => `Aucun événement · ${a.count} outil${a.count > 1 ? 's' : ''} encore en vol`,
  badInvocation: a =>
    `${a.toolName} · appel mal formé : ${MOTIFS[a.patternId] || REGLAGE_INCONNU}`
    + repetitionNote(a.count),
};

function subjectOf(alert: Alert) {
  if (alert.type === 'stuck') {
    const first = alert.tools[0];
    return first ? `${first.toolName} · ${first.subject}` : '';
  }
  return alert.subject;
}

export function failureLine(alert: Alert) {
  return {
    time: alert.createdAt,
    project: projectLabel(alert.cwd),
    headline: HEADLINES[alert.type](alert),
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
// confondrait la memoire des pannes avec l'etat present.
//
// Donc un compte, et le mot exact de ce qui est compte.
export function failuresSummary(alerts: Alert[]) {
  const n = alerts.filter(a => !a.acknowledged).length;
  if (n === 0) return 'aucune';
  return `${n} non acquittée${n > 1 ? 's' : ''}`;
}

// ── Ce que le panneau accepte de montrer ───────────────────────────────────
//
// Des FAUTES, pas des etats passagers. `stuck` decrit un etat qui se resout
// tout seul : en vivant il a sa pastille et sa notification bureau, qui
// nomment chaque commande en vol (DETAIL_LINES.stuck, viz-alert-format.ts) ;
// en memoire, declenche des 3 minutes de silence, il noierait les vraies fautes
// sous des commandes simplement longues. Un etat qui se resout seul n'est pas une
// dette du lecteur : il n'a pas a reclamer d'acquittement.
//
// Le filtre est NOMME : seul `stuck` est ecarte, et un detecteur ajoute demain
// s'affiche sans toucher a ce filtre. Les formulations stuck restent dans les
// tables du fichier, et montrer `stuck` ici ne demande que de retirer ce filtre.
export function panelAlerts(alerts: Alert[]) {
  return alerts.filter(a => a.type !== 'stuck');
}

// ── Regroupement par cause ─────────────────────────────────────────────────
//
// Une ligne par CAUSE, jamais une ligne par episode. La clef dit
// ce qui se corrige d'un seul geste : le motif pour un appel mal forme (le meme
// reglage traverse les outils), type+outil pour les repetitions et les orages
// (une boucle sur Bash et une sur Grep sont deux histoires), le type seul pour
// les silences.

export function groupKey(alert: Alert): string {
  if (alert.type === 'badInvocation') return `badInvocation:${alert.patternId}`;
  if (alert.type === 'stuck') return 'stuck';
  return `${alert.type}:${alert.toolName}`;
}

export function groupAlerts(alerts: Alert[]): AlertGroup[] {
  const parClef = new Map<string, Alert[]>();
  for (const a of alerts) {
    const key = groupKey(a);
    if (!parClef.has(key)) parClef.set(key, []);
    parClef.get(key)!.push(a);
  }
  const groupes = [...parClef.entries()].map(([key, episodes]) => {
    episodes.sort((x, y) => y.createdAt - x.createdAt);
    return {
      key,
      episodes,
      // `episodes` vient toujours d'au moins un push ci-dessus : l'index 0
      // existe reellement, noUncheckedIndexedAccess ne le sait pas.
      lastAt: episodes[0]!.createdAt,
      unacked: episodes.filter(e => !e.acknowledged).length,
    };
  });
  // « À traiter » d'abord — c'est la question que la page pose — puis le plus
  // recent : une panne d'hier soir se cherche avant celle du mois dernier.
  // Comparateur numerique : TypeScript refuse l'arithmetique sur des booleens,
  // `Number` les convertit en 0/1.
  groupes.sort((a, b) => Number(b.unacked > 0) - Number(a.unacked > 0) || b.lastAt - a.lastAt);
  return groupes;
}

// La cause se nomme SANS les chiffres d'un episode : « meme commande 4× » est
// un fait d'episode, pas un nom de cause. L'outil ne se dit que
// s'il est uniforme — jamais celui d'un episode arbitraire.
function outilUniforme(episodes: Alert[]) {
  const outils = new Set(episodes.map(e => e.toolName));
  return outils.size === 1 ? [...outils][0] : '';
}

const CAUSES: Record<AlertType, (first: Alert, prefix: string) => string> = {
  badInvocation: (first, prefix) =>
    `${prefix}appel mal formé : ${MOTIFS[first.patternId] || REGLAGE_INCONNU}`,
  loop: (_first, prefix) => `${prefix}même commande répétée`,
  retryStorm: (_first, prefix) => `${prefix}échecs consécutifs`,
  stuck: () => 'Aucun événement · outils encore en vol',
};

export function causeLabel(group: AlertGroup) {
  // Meme invariant qu'a la construction du groupe (groupAlerts) : au moins
  // un episode.
  const first = group.episodes[0]!;
  const outil = outilUniforme(group.episodes);
  return CAUSES[first.type](first, outil ? `${outil} · ` : '');
}

// Les faits d'UN episode, l'outil en moins (il est dit par la cause).
const EPISODES: Record<AlertType, (a: Alert) => string> = {
  loop: a => `même commande ${a.count}×${failureNote(a.occurrences)}`,
  retryStorm: a => `${a.count} échecs consécutifs`,
  stuck: a => `${a.count} outil${a.count > 1 ? 's' : ''} encore en vol`,
  badInvocation: a => (a.count > 1 ? `${a.count} fois dans la session` : ''),
};

export function episodeLabel(alert: Alert) {
  return EPISODES[alert.type](alert);
}
