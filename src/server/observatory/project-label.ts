'use strict';
// Comment un projet se nomme devant l'utilisateur — la seule réponse du produit.
//
// Claude Code range les transcriptions sous ~/.claude/projects/<slug>, où <slug>
// est le répertoire de travail aplati (« : », « \ », « / », espaces → « - »).
// L'encodage perd de l'information : il ne se décode pas. Le chemin réel se lit
// au seul endroit qui le garde intact — le champ `cwd` que porte le transcript.
//
// Le slug reste l'identité (clé (rule_id, subject), colonne SQL) ; ce fichier ne
// produit que le libellé affiché. Module pur : ni I/O, ni horloge, et la table
// des règles arrive en paramètre plutôt que par un require (CLAUDE.md § D).

const cwdOfReport = report => {
  const cwd = report?.cwd;
  return typeof cwd === 'string' && cwd !== '' ? cwd : null;
};

const cwdOf = session => cwdOfReport(session?.report);

// Convention d'affichage : lettre de lecteur en majuscule. Windows l'écrit ainsi
// et le système ignore la casse — sans ça le libellé suivrait la casse du
// terminal qui a lancé la dernière session et changerait d'une analyse à
// l'autre. Un chemin sans lettre de lecteur ressort inchangé.
const displayPath = p => p.replace(/^([a-z]):/, (_, d) => `${d.toUpperCase()}:`);

// slug → chemin réel. Un slug inconnu se rend lui-même, ce qui rend le résolveur
// utilisable sur n'importe quel sujet de recommandation.
function projectResolver(sessions) {
  const variants = new Map();
  for (const s of sessions ?? []) {
    const cwd = cwdOf(s);
    if (!cwd) continue;
    const byFolder = variants.get(s.project) ?? new Map();
    // Clé insensible à la casse : Windows l'ignore, donc f:\DEV\x et f:\dev\x
    // sont le MÊME dossier et ne doivent pas passer pour une ambiguïté (même
    // précédent que r2-unused-mcp.js:22). La valeur d'affichage est choisie
    // par ordre lexicographique, jamais « la dernière vue » — sinon le libellé
    // dépendrait de l'ordre des sessions.
    const folder = cwd.toLowerCase();
    const shown = displayPath(cwd);
    if (!byFolder.has(folder) || shown < byFolder.get(folder)) byFolder.set(folder, shown);
    variants.set(s.project, byFolder);
  }

  const paths = new Map();
  for (const [slug, byFolder] of variants) {
    // Deux dossiers réellement différents aplatis sur le même slug (F:\a-b et
    // F:\a\b) : les règles les agrègent déjà sous une seule carte, et cette
    // fusion est gelée. En nommer un seul serait affirmer un demi-vrai — on rend
    // le slug, qui porte honnêtement son ambiguïté.
    if (byFolder.size === 1) paths.set(slug, [...byFolder.values()][0]);
  }
  return slug => paths.get(slug) ?? slug;
}

// Le seul endroit du produit qui accole un projet à un titre. Les
// recommandations dont le sujet n'est pas un projet — serveur MCP, outil — le
// nomment déjà dans leur phrase et ressortent intactes.
function nameProjects(recs, sessions, rules) {
  const kinds = new Map(rules.map(r => [r.id, r.subjectKind]));
  const pathOf = projectResolver(sessions);
  return recs.map(rec => (kinds.get(rec.ruleId) === 'project'
    ? { ...rec, title: `${rec.title} — projet ${pathOf(rec.subject)}` }
    : rec));
}

export { cwdOf, cwdOfReport, displayPath, projectResolver, nameProjects };
