// Découpage en jetons : commentaires retirés, chaînes et nombres neutralisés.
//
// LIMITES ASSUMÉES (doc/34) : découpage par expression rationnelle, pas par
// analyseur syntaxique. Deux conséquences écrites d'avance :
//   1. les identifiants sont conservés tels quels, donc un clone dont les
//      variables ont été renommées n'est PAS détecté ;
//   2. une division suivie d'une expression rationnelle littérale peut être
//      mal découpée. Aucun cas connu dans ce dépôt, mais le risque existe.
const PATTERN =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|`(?:\\[\s\S]|[^`\\])*`|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|[A-Za-z_$][\w$]*|\d[\d_]*(?:\.\d[\d_]*)?|\S/g;

export function tokenize(text) {
  const out = [];
  let line = 1;
  let cursor = 0;
  for (const match of text.matchAll(PATTERN)) {
    for (let i = cursor; i < match.index; i++) if (text[i] === '\n') line++;
    const raw = match[0];
    const isComment = raw.startsWith('//') || raw.startsWith('/*');
    if (!isComment) {
      const first = raw[0];
      const v = (first === '"' || first === "'" || first === '`') ? 'STR'
        : /^\d/.test(raw) ? 'NUM'
        : raw;
      out.push({ v, line });
    }
    for (const ch of raw) if (ch === '\n') line++;
    cursor = match.index + raw.length;
  }
  return out;
}
