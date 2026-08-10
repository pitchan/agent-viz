// D3 — combien de chemins mènent au même geste. L'inventaire est mesurable ;
// la DIVERGENCE ne l'est pas. Le script recense les sites, la passe humaine
// compare les comportements et décide si la coexistence a une raison.
//
// Les douze familles reprennent LITTÉRALEMENT la liste de doc/34 : appel HTTP,
// lecture JSON, résolution de chemin, découpage JSONL, et les sept formes de
// formatage (monnaie, octets, durée, pourcentage, date, numérique en dur,
// locale implicite) plus les formateurs déclarés. La v1 n'en couvrait que six,
// donc ne pouvait pas soutenir l'inventaire qu'elle annonçait.
//
// LIMITE ASSUMÉE : ces motifs sont syntaxiques. Un formatage écrit autrement
// (Intl, bibliothèque tierce) passerait au travers — aucun n'existe dans ce
// dépôt au commit audité, et c'est précisément ce que dit le constat sur les
// conventions numériques.
//
// LIMITE DÉCOUVERTE À L'EXÉCUTION (2026-08-10) : formatage-monetaire sur-détecte
// fortement. Ses deux branches guillemet-dollar (`\$\s*['"`]` et `['"`]\s*\$`)
// matchent aussi l'adjacence banale d'une interpolation `${...}` — l'ouverture
// (ou une chaîne échappée) d'un template-literal fait cohabiter un guillemet
// et un `$` sans rapport avec une devise. Sur le dépôt audité au commit
// 4a4dc46 : 247 sites recensés pour cette famille, dont 218 contiennent un
// backtick (quasi tous des ouvertures de gabarit) ; moins d'une dizaine de
// pourcent des sites relèvent réellement d'un montant (mot-clé USD ou signe
// `$` isolé comme '$0', '0,00 $'). Le fichiersDistincts de cette famille est
// donc une borne haute très large, pas un décompte de formatage monétaire
// réel — la relecture humaine doit vérifier chaque site avant de conclure à
// une divergence.
export const PRIMITIVES = [
  { nom: 'appel-http-client', re: /\bfetch\s*\(|\bhttps?\.(?:get|request)\s*\(/g },
  { nom: 'lecture-json-de-fichier', re: /JSON\.parse\s*\(/g },
  { nom: 'decodage-jsonl', re: /\.split\((['"`])\\n\1\)|createInterface\s*\(/g },
  { nom: 'resolution-de-chemin-maison', re: /\bhomedir\s*\(\s*\)|process\.env\.(?:USERPROFILE|HOME)\b|join\s*\([^)]*['"`]\.(?:claude|agent-viz|copilot)['"`]/g },
  { nom: 'formatage-monetaire', re: /\$\s*['"`]|['"`]\s*\$|\bUSD\b|toFixed\s*\(\s*2\s*\)[^\n]{0,20}\$/g },
  { nom: 'formatage-octets', re: /1024\s*\*\s*1024|\b(?:Mo|Ko|Go|KB|MB|GB)\b/g },
  { nom: 'formatage-duree', re: /\/\s*60_?000|\/\s*1000\s*\)|\bms\s*[<>]|maxDurationMs/g },
  { nom: 'formatage-pourcentage', re: /\*\s*100\s*\)[^\n]{0,25}%|%\s*['"`]|['"`]\s*%/g },
  { nom: 'formatage-date', re: /getDate\s*\(\)|getMonth\s*\(\)|toISOString\s*\(\)|padStart\s*\(\s*2\s*,/g },
  { nom: 'formatage-numerique-en-dur', re: /\.toFixed\s*\(/g },
  { nom: 'formatage-a-locale-implicite', re: /\.toLocale[A-Za-z]*\s*\(\s*\)/g },
  { nom: 'declaration-de-formateur', re: /\b(?:function\s+|const\s+)(format[A-Z]\w*)\s*[=(]/g },
];

const lineOf = (text, index) => {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
};

export function findManyPaths(files) {
  const result = [];
  for (const { nom, re } of PRIMITIVES) {
    const sites = [];
    for (const file of files) {
      for (const match of file.text.matchAll(new RegExp(re.source, re.flags))) {
        sites.push({ path: file.path, zone: file.zone, line: lineOf(file.text, match.index) });
      }
    }
    if (sites.length === 0) continue;
    result.push({ primitive: nom, sites, fichiersDistincts: new Set(sites.map(s => s.path)).size });
  }
  return result.sort((a, b) => b.fichiersDistincts - a.fichiersDistincts);
}
