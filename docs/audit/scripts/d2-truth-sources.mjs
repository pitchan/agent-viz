// D2 — sources de vérité. Ne recense QUE des DÉFINITIONS VALUÉES : une clé
// métier et la valeur qu'on lui donne.
//
// La v1 de ce plan comptait des MENTIONS, ce qui ne prouve rien : trouver
// « claude-opus-5 » dans deux fichiers ne dit pas si les deux tarifs
// divergent. C'est `valeursDistinctes` qui porte le fait — 1 signifie
// « copies d'accord », 2 ou plus signifie « les deux ne disent pas la même
// chose », et c'est ce second cas qui est un défaut.
//
// HORS PORTÉE, ET C'EST VOULU : « deux noms différents pour le même rôle »
// (CLAUDE_CONFIG_DIR contre NETGAIN_CLAUDE_DIR) est invisible à D2 par
// construction, puisque les clés diffèrent. Ce constat appartient à la matrice
// de D7.
//
// LIMITE ASSUMÉE : extraction par expression rationnelle sur des littéraux
// d'objet à un niveau d'imbrication. Une table construite par calcul échappe à
// la mesure ; aucune n'existe dans ce dépôt au commit audité.
const EXTRACTEURS = [
  {
    categorie: 'tarif-de-modele',
    extraire(text) {
      const out = [];
      for (const m of text.matchAll(/['"`](claude-[a-z0-9.-]+)['"`]\s*:\s*\{([^{}]{0,400})\}/g)) {
        const taux = {};
        for (const r of m[2].matchAll(/\b(input|output|cacheCreate|cacheRead|maxInput)\s*:\s*([0-9._e+-]+)/g)) {
          taux[r[1]] = r[2];
        }
        if (Object.keys(taux).length >= 2) out.push({ cle: m[1], valeur: JSON.stringify(taux) });
      }
      return out;
    },
  },
  {
    categorie: 'seuil-de-regle',
    extraire(text) {
      const out = [];
      for (const m of text.matchAll(/\b(R[1-9])\s*:\s*(?:Object\.freeze\(\s*)?\{([^{}]{0,300})\}/g)) {
        const seuils = {};
        // Le terminateur est une virgule OU la fin du fragment capturé : le
        // dernier seuil d'un objet n'est suivi d'aucune virgule, et exiger
        // `[,}]` le faisait disparaître — donc l'objet entier avec lui.
        for (const r of m[2].matchAll(/\b([a-zA-Z]\w*)\s*:\s*([0-9._e*+ -]+?)\s*(?:,|$)/g)) {
          seuils[r[1]] = r[2].trim();
        }
        if (Object.keys(seuils).length >= 1) out.push({ cle: m[1], valeur: JSON.stringify(seuils) });
      }
      return out;
    },
  },
  {
    categorie: 'code-d-evenement',
    extraire(text) {
      const out = [];
      for (const m of text.matchAll(/(?:type|kind|event|ruleId)\s*===\s*['"]([\w.-]+)['"]|case\s+['"]([\w.-]+)['"]\s*:/g)) {
        out.push({ cle: m[1] ?? m[2], valeur: 'branche' });
      }
      return out;
    },
  },
  {
    categorie: 'chemin-litteral',
    extraire(text) {
      const out = [];
      for (const m of text.matchAll(/['"`](\.claude|\.claude\.json|\.agent-viz|\.copilot|projects|subagents)['"`]/g)) {
        out.push({ cle: m[1], valeur: 'litteral' });
      }
      return out;
    },
  },
];

export function findTruthSources(files) {
  const index = new Map();
  for (const file of files) {
    for (const { categorie, extraire } of EXTRACTEURS) {
      for (const { cle, valeur } of extraire(file.text)) {
        const k = `${categorie}\u0000${cle}`;
        if (!index.has(k)) index.set(k, new Map());
        index.get(k).set(file.path, valeur);
      }
    }
  }
  const candidats = [];
  for (const [k, parFichier] of index) {
    if (parFichier.size < 2) continue;
    const [categorie, cle] = k.split('\u0000');
    const definitions = [...parFichier].map(([path, valeur]) => ({ path, valeur })).sort((a, b) => a.path.localeCompare(b.path));
    candidats.push({
      categorie, cle, definitions,
      valeursDistinctes: new Set(definitions.map(d => d.valeur)).size,
      niveau: null,
    });
  }
  return candidats.sort((a, b) => b.valeursDistinctes - a.valeursDistinctes || b.definitions.length - a.definitions.length);
}
