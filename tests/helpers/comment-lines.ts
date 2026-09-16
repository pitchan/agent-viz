// Les deux lectures des commentaires d'un fichier source que partagent les tests
// d'hygiène du dépôt : la part commentée d'une ligne, et les blocs de lignes commentées.

// La part commentée d'une ligne : ligne de bloc (`*`, `/*`, `<!--`, `#`) prise
// entière, sinon ce qui suit un `//` qui n'est pas celui d'une URL (`://`).
export function commentPart(line: string): string {
  const trimmed = line.trim();
  if (/^(\*|\/\*|<!--|#)/.test(trimmed)) return trimmed;
  const at = line.indexOf('//');
  if (at > 0 && line[at - 1] === ':') return '';
  return at === -1 ? '' : line.slice(at + 2);
}

interface CommentBlock {
  line: number;
  length: number;
}

// Les blocs de commentaire : une suite de lignes qui commencent par `//`, ou un bloc
// étoilé ouvert sur une ligne et refermé plus bas. Seuls l'espace et la tabulation
// précèdent le marqueur. Chaque bloc rend sa première ligne (comptée depuis 1) et sa longueur.
export function commentBlocks(lines: string[]): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  let start = 0;
  let length = 0;
  let open = false;
  const close = () => {
    if (length > 0) blocks.push({ line: start, length });
    length = 0;
  };
  lines.forEach((line, i) => {
    const s = line.replace(/^[ \t]+/, '');
    if (open) {
      length++;
      if (line.includes('*/')) {
        open = false;
        close();
      }
      return;
    }
    if (s.startsWith('//')) {
      if (length === 0) start = i + 1;
      length++;
      return;
    }
    close();
    if (s.startsWith('/*') && !s.slice(2).includes('*/')) {
      start = i + 1;
      length = 1;
      open = true;
    }
  });
  close();
  return blocks;
}
