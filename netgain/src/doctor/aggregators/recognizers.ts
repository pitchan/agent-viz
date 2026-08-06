export interface OutputRecognizer {
  id: string;
  commandPattern: RegExp;
}

/**
 * Les filtres sont des DONNÉES, pas du code (spec §2.2) : table déclarative,
 * ordre spécifique → générique (le premier qui matche gagne).
 * C'est le ciblage des futurs filtres de l'output-gate : doctor mesure combien
 * d'octets chaque format pèse réellement dans les sessions de l'utilisateur.
 */
export const RECOGNIZERS: OutputRecognizer[] = [
  { id: 'vitest', commandPattern: /\bvitest\b/ },
  { id: 'jest', commandPattern: /\bjest\b/ },
  { id: 'tsc', commandPattern: /\btsc\b/ },
  { id: 'eslint', commandPattern: /\beslint\b/ },
  { id: 'ng', commandPattern: /(^|[\s&;])ng\s+(build|test|serve|lint|e2e)\b/ },
  { id: 'pytest', commandPattern: /\bpytest\b/ },
  { id: 'git-log', commandPattern: /\bgit\b[^|&;]*\blog\b/ },
  { id: 'git-diff', commandPattern: /\bgit\b[^|&;]*\bdiff\b/ },
  { id: 'git-status', commandPattern: /\bgit\b[^|&;]*\bstatus\b/ },
  { id: 'npm', commandPattern: /\bnpm\b/ },
];

export function recognizeCommand(command: string): string | null {
  for (const r of RECOGNIZERS) {
    if (r.commandPattern.test(command)) return r.id;
  }
  return null;
}

/** Outils dont le 2e token (sous-commande) fait partie de la famille. */
const SUBCOMMAND_TOOLS = new Set(['git', 'npm', 'npx', 'yarn', 'pnpm', 'node', 'python', 'cargo', 'dotnet', 'docker']);

/**
 * Normalise un tool_use en « famille » pour mesurer la répétitivité :
 * Bash → premier token de la commande (+ sous-commande pour git/npm/npx…),
 * chemins et arguments supprimés ; autres outils → nom de l'outil.
 */
export function familyOf(toolName: string, input: unknown): string {
  if (toolName !== 'Bash') return toolName;
  const rec = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const command = typeof rec['command'] === 'string' ? rec['command'].trim() : '';
  if (command === '') return toolName;
  // Le préfixe « cd X && » / « cd X ; » ne définit pas la famille.
  const stripped = command.replace(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, '');
  const tokens = stripped.split(/\s+/).filter((t) => t !== '');
  const first = tokens[0];
  if (first === undefined) return toolName;
  const second = tokens[1];
  if (SUBCOMMAND_TOOLS.has(first) && second !== undefined && !second.startsWith('-')) {
    return `${first} ${second}`;
  }
  return first;
}
