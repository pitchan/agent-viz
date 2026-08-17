// Classement déclaratif des commandes de vérification (doc/41).
//
// Une « vérification » est une commande dont le rouge/vert constitue une
// preuve : test, build, lint, typecheck. La table est volontairement
// conservatrice — un manque se mesure (sonde doc/41), une fausse preuve se
// paie. Les chaînes entre guillemets sont retirées avant appariement : un
// `git commit -m "npm test vert"` n'est pas une vérification. Le suffixe
// (?![\w.@-]) refuse les noms collés à un fichier (`vitest.config.mts`).

export type VerificationKind = 'test' | 'build' | 'lint' | 'typecheck';

interface VerificationPattern {
  readonly kind: VerificationKind;
  readonly pattern: RegExp;
}

// Premier motif apparié gagnant : l'ordre de la table est une priorité déclarée.
const PATTERNS: readonly VerificationPattern[] = Object.freeze([
  { kind: 'test', pattern: /(^|[\s;&|(])(npx\s+)?(vitest|jest|mocha|pytest|py\.test|phpunit|rspec|ctest)(?![\w.@-])/ },
  { kind: 'test', pattern: /(^|[\s;&|(])(cargo|go|dotnet|mvn|gradle)\s+test(?![\w.@-])/ },
  { kind: 'test', pattern: /(^|[\s;&|(])node\s+--test(?![\w.@-])/ },
  { kind: 'test', pattern: /(^|[\s;&|(])(npm|pnpm|yarn|bun)\s+(run\s+)?test(:[\w-]+)?(?![\w.@-])/ },
  { kind: 'typecheck', pattern: /(^|[\s;&|(])(npx\s+)?(tsc|mypy|pyright)(?![\w.@-])/ },
  { kind: 'typecheck', pattern: /(^|[\s;&|(])(npm|pnpm|yarn|bun)\s+run\s+typecheck(:[\w-]+)?(?![\w.@-])/ },
  { kind: 'lint', pattern: /(^|[\s;&|(])(npx\s+)?(eslint|ruff|flake8|pylint|golangci-lint)(?![\w.@-])/ },
  { kind: 'lint', pattern: /(^|[\s;&|(])cargo\s+clippy(?![\w.@-])/ },
  { kind: 'lint', pattern: /(^|[\s;&|(])(npm|pnpm|yarn|bun)\s+run\s+lint(:[\w-]+)?(?![\w.@-])/ },
  { kind: 'build', pattern: /(^|[\s;&|(])(cargo|go|dotnet)\s+build(?![\w.@-])/ },
  { kind: 'build', pattern: /(^|[\s;&|(])make\s+(test|check|build|lint)(?![\w.@-])/ },
  { kind: 'build', pattern: /(^|[\s;&|(])(npm|pnpm|yarn|bun)\s+run\s+build(:[\w-]+)?(?![\w.@-])/ },
]);

const QUOTED = /"[^"]*"|'[^']*'/g;

export function classifyVerification(command: string): VerificationKind | null {
  const bare = command.replace(QUOTED, ' ');
  for (const { kind, pattern } of PATTERNS) {
    if (pattern.test(bare)) return kind;
  }
  return null;
}
