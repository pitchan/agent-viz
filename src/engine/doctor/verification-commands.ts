// Classement déclaratif des commandes de vérification (doc/41).
//
// Une « vérification » est une commande dont le rouge/vert constitue une
// preuve : test, build, lint, typecheck. La table est volontairement
// conservatrice — un manque se mesure (sonde doc/41), une fausse preuve se
// paie (doc/41, D4). D'où la règle centrale : nommer un outil n'est pas
// l'exécuter. Quatre filtres l'appliquent, dans cet ordre :
//   1. les chaînes entre guillemets sont retirées — un
//      `git commit -m "npm test vert"` n'est pas une vérification ;
//   2. la commande est découpée en segments shell, et chaque motif est ancré
//      EN TÊTE de segment, aux seuls préfixes tolérés près — d'où
//      `npm install --save-dev vitest`, `rg vitest src/` et `which tsc`
//      qui ne valent rien ;
//   3. un segment qui porte `--version` ou `--help` est refusé : il n'y a pas
//      de rouge/vert à en tirer ;
//   4. le suffixe (?![\w.@-]) refuse les noms collés à un fichier
//      (`vitest.config.mts`).

export type VerificationKind = 'test' | 'build' | 'lint' | 'typecheck';

interface VerificationPattern {
  readonly kind: VerificationKind;
  readonly body: RegExp;
}

// Seuls préfixes tolérés devant le nom de l'outil, tous optionnels : les
// affectations d'environnement, répétables (`PORT=4123 npm test`), puis `npx `.
const PREFIX = '(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*(?:npx\\s+)?';

// La table : (genre, corps de motif). Chaque corps est concaténé au préfixe et
// ancré, donc il doit être autonome — toute alternation y est groupée.
// L'ordre n'arbitre qu'À L'INTÉRIEUR d'un segment ; entre segments, c'est
// l'ordre de la commande qui tranche.
const TABLE: readonly VerificationPattern[] = Object.freeze([
  { kind: 'test', body: /(?:vitest|jest|mocha|pytest|py\.test|phpunit|rspec|ctest)(?![\w.@-])/ },
  { kind: 'test', body: /(?:\.\/)?node_modules\/\.bin\/(?:vitest|jest|mocha|pytest)(?![\w.@-])/ },
  { kind: 'test', body: /python3?\s+-m\s+pytest(?![\w.@-])/ },
  { kind: 'test', body: /(?:cargo|go|dotnet|mvn|gradle)\s+test(?![\w.@-])/ },
  { kind: 'test', body: /node\s+--test(?![\w.@-])/ },
  { kind: 'test', body: /(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w-]+)?(?![\w.@-])/ },
  { kind: 'test', body: /make\s+test(?![\w.@-])/ },
  { kind: 'typecheck', body: /(?:tsc|mypy|pyright)(?![\w.@-])/ },
  { kind: 'typecheck', body: /(?:npm|pnpm|yarn|bun)\s+run\s+typecheck(?::[\w-]+)?(?![\w.@-])/ },
  { kind: 'lint', body: /(?:eslint|ruff|flake8|pylint|golangci-lint)(?![\w.@-])/ },
  { kind: 'lint', body: /cargo\s+clippy(?![\w.@-])/ },
  { kind: 'lint', body: /(?:npm|pnpm|yarn|bun)\s+run\s+lint(?::[\w-]+)?(?![\w.@-])/ },
  { kind: 'lint', body: /make\s+lint(?![\w.@-])/ },
  { kind: 'build', body: /(?:cargo|go|dotnet)\s+build(?![\w.@-])/ },
  { kind: 'build', body: /(?:npm|pnpm|yarn|bun)\s+run\s+build(?::[\w-]+)?(?![\w.@-])/ },
  { kind: 'build', body: /make\s+(?:check|build)(?![\w.@-])/ },
]);

interface VerificationMatcher {
  readonly kind: VerificationKind;
  readonly pattern: RegExp;
}

const MATCHERS: readonly VerificationMatcher[] = TABLE.map(({ kind, body }) => ({
  kind,
  pattern: new RegExp(`^${PREFIX}${body.source}`),
}));

const QUOTED = /"[^"]*"|'[^']*'/g;
const SEGMENT_SEPARATOR = /[;|&]+|\r?\n/;
const NO_VERDICT = /(?:^|\s)--(?:version|help)(?![\w-])/;

export function classifyVerification(command: string): VerificationKind | null {
  if (typeof command !== 'string') return null;
  const bare = command.replace(QUOTED, ' ');
  for (const raw of bare.split(SEGMENT_SEPARATOR)) {
    const segment = raw.trim();
    if (segment === '' || NO_VERDICT.test(segment)) continue;
    for (const { kind, pattern } of MATCHERS) {
      if (pattern.test(segment)) return kind;
    }
  }
  return null;
}
