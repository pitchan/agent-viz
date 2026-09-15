// invocation-patterns.ts — recognising, from the shape of its message, an
// error that comes from HOW something was called rather than from what it did.
//
// Pure module: a string in, a category or null out; no DOM, fs, clock, state or dependency.
// A file of its own because this table grows with every pattern met, the alerting logic does not.
//
// The table comes from a survey of real failures that measured, for every pattern, both its
// occurrences AND its false positives (docs/sources-externes.md). Four rules are easy to undo:
//
//   1. THE ORDER IS LAYERED, first match wins. Whatever explains a failure by something other
//      than the way it was written comes first: a program's report QUOTES a system message, it
//      does not emit it. `vrd-exit-code-bare` stays dead last, or it takes everything.
//   2. POWERSHELL ANCHORS ON `FullyQualifiedErrorId`, a .NET identifier never translated nor
//      accented, never on the sentence before it, which is localised and can arrive mangled.
//      `CategoryInfo` is excluded by name. Both French-prose anchors stay outside the alerts.
//   3. EVERY POSIX-SHELL PATTERN REQUIRES BASH'S `line N:` STAMP, which a quotation lacks and a
//      container running bash also prints. The anchors name the invocation path, not the cause:
//      the French sentences state the established fact first and the likely gesture second.
//   4. `workstationSetting` marks what the user can fix ONCE and never see again, the only
//      subset that alerts. Tool-protocol patterns fail that test: the tool descriptions the
//      agent re-reads every turn already carry their instruction.
//
// A limit written rather than hidden: bash is translatable through LANG/LC_ALL, so under a
// non-English locale the `inv-bash-*` patterns fall silent; no stable POSIX identifier exists.
// Each rule has its tests in tests/unit/invocation-patterns.test.mjs.

/**
 * The patterns are DATA, not code: adding one is a line in this table, never
 * another `if` inside `classify` (Open/Closed).
 *
 * Every entry carries the same four fields, always:
 *   id                 — what the alert will carry, and nothing else
 *   class              — 'invocation' | 'verdict' | 'environment' | 'harness'
 *   workstationSetting — does this pattern point at a workstation setting,
 *                        i.e. something the user can fix once and never see
 *                        again? The detector uses this as its only filter.
 *   re                 — the pattern itself
 *
 * Frozen, table and entries alike. It is exported so that the detector can
 * read `workstationSetting` off it instead of restating the list; exported
 * mutable, it also handed `PATTERNS.unshift(…)` to any importer, and the order
 * of this table is half of what the module guarantees.
 */
export type PatternClass = 'invocation' | 'verdict' | 'environment' | 'harness';

export interface InvocationPattern {
  id: string;
  class: PatternClass;
  workstationSetting: boolean;
  re: RegExp;
}

export const PATTERNS: readonly Readonly<InvocationPattern>[] = Object.freeze(([
  // ── LAYER 1 — the harness refused the call. Nothing to advise, and nothing
  // a program's report ever quotes: these are the harness talking about
  // itself, in messages no tool output contains.
  { id: 'harness-tool-disabled', class: 'harness', workstationSetting: false,
    re: /No such tool available: \S+\.[^]{0,40}not enabled in this context/ },
  { id: 'harness-classifier-denied', class: 'harness', workstationSetting: false,
    re: /denied by the Claude Code auto mode classifier/ },
  { id: 'harness-model-unavailable', class: 'harness', workstationSetting: false,
    re: /is temporarily unavailable, so auto mode cannot determine the safety/ },
  { id: 'harness-user-rejected', class: 'harness', workstationSetting: false,
    re: /The user doesn't want to proceed with this tool use|Request interrupted/ },

  // ── LAYER 2 — the environment: network, permission, service, missing
  // binary, browser. Nothing to advise either. It comes before the program
  // report because a browser that never settled or a socket that was refused
  // is an environment failure that happens to print a stack, not a verdict —
  // which is the precedence the survey measured, and moving the program
  // report above it would have reclassified three of its failures.
  { id: 'env-ssh-host-key-changed', class: 'environment', workstationSetting: false,
    re: /REMOTE HOST IDENTIFICATION HAS CHANGED/ },
  // `est introuvable`: one of the table's two French anchors. `command not
  // found` is deliberately NOT in here — adding it would swallow the one real
  // `inv-bash-syntax-error` of the survey, whose text also carries a
  // `command not found` line. Measured, not assumed.
  { id: 'env-binary-missing', class: 'environment', workstationSetting: false,
    re: /is not installed\.|not found on PATH|Binary '[^']+' not found|est introuvable/ },
  { id: 'env-browser-timeout', class: 'environment', workstationSetting: false,
    re: /Script injection timed out|Timeout \d+ms exceeded|page is busy or mid-navigation/ },
  { id: 'env-network', class: 'environment', workstationSetting: false,
    re: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo|socket hang up/ },
  { id: 'env-permission-denied', class: 'environment', workstationSetting: false,
    re: /Permission denied|EACCES|EPERM/ },

  // ── LAYER 3 — a program ran and reported. That is normal work, and it is
  // also the proof that any system message further down the text is QUOTED
  // rather than emitted: a runner's glyphs, an execution stack, a Python
  // traceback, an npm script's log, a compiler diagnostic. This layer is what
  // keeps the alerting subset below it out of reach of a red test.
  //
  // Both anchored patterns use `^[ \t]*` and not `^\s*`. Under the `m` flag
  // `\s` covers `\n`, so at every line start the engine swallowed the whole
  // run of blank lines and backtracked out of it — a quadratic cost (exponent
  // 2.00 measured: 1 MB took 409 s) inside a `classify` that runs SYNCHRONOUS
  // in the daemon's event loop, blocking the HTTP server and the SSE stream.
  // `[ \t]` cannot cross a line and the cost becomes linear (1 MB, 0.45 ms).
  // Boolean-equivalent, and provably so: if `\s*` had crossed blank lines
  // before matching, the start of the line it reached is itself a `^` anchor.
  { id: 'vrd-test-runner', class: 'verdict', workstationSetting: false,
    re: /^[ \t]*(?:RUN|DEV)\s+v\d|Test Files\s+\d|ℹ tests \d|Tests:\s+\d|✔ |✓ |× |✗ /m },
  { id: 'vrd-node-stacktrace', class: 'verdict', workstationSetting: false,
    re: /node:internal\/|Cannot find module|^[ \t]*at .+:\d+:\d+$/m },
  { id: 'vrd-python-traceback', class: 'verdict', workstationSetting: false,
    re: /Traceback \(most recent call last\)/ },
  { id: 'vrd-npm-script', class: 'verdict', workstationSetting: false,
    re: /npm (?:ERR!|error)|^> \S+@\d/m },
  { id: 'vrd-compiler-diagnostic', class: 'verdict', workstationSetting: false,
    re: /error TS\d+|SyntaxError|ReferenceError|TypeError|AssertionError/ },

  // ── LAYER 4 — invocation, workstation setting: shell, quoting, paths,
  // separators. The only subset that will ever raise an alert, and the reason
  // everything above it is consulted first.
  //
  // All seven POSIX-shell patterns require bash's own `line N:` stamp — see
  // point 3 of the header. It is what a quotation does not have.
  //
  // The SHAPE of a Windows path whose backslashes were eaten by the POSIX
  // shell, never one particular path: `cd F:\DEV\… && …` without quotes.
  { id: 'inv-bash-windows-path-unquoted', class: 'invocation', workstationSetting: true,
    re: /line \d+: cd: [A-Za-z]:[^\s/\\][^\s:]*: No such file or directory/ },
  { id: 'inv-bash-cd-too-many-args', class: 'invocation', workstationSetting: true,
    re: /line \d+: cd: too many arguments/ },
  // Two disjoint causes under one message. Read from the command that produced
  // it rather than from the failure text, it hides no typo: two workstation
  // settings, one per entry below.
  //
  // A. A DIRECTORY path ending in a backslash, the way Windows displays one:
  // `ls "D:\folder\"`. Under a POSIX shell `\` escapes, so `\"` stops being a
  // closing quote and the string never closes. Same root as
  // `inv-bash-windows-path-unquoted`. Verified live: backslashes break
  // nothing by themselves inside double quotes — `"F:\DEV\public"` runs —
  // ONLY the trailing one does.
  { id: 'inv-bash-trailing-backslash-in-path', class: 'invocation', workstationSetting: true,
    re: /eval: line \d+: unexpected EOF while looking for matching `"/ },
  // B. A `cat >> f <<'EOF'` carrying 8 to 15 KB. The command is
  // SYNTACTICALLY VALID — `bash -n` green all 8 times — it simply does not
  // reach the shell whole. Measured over the entire history: 9 heredoc
  // commands of 8 KB or more, 9 failures, zero exceptions. The transport
  // mechanism is NOT explained: truncation of the command text and a naive
  // `eval '<cmd>'` envelope were both tested and refuted. This pattern names
  // a reproducible fact, not an explanation, and must not be read as one.
  { id: 'inv-bash-heredoc-too-large', class: 'invocation', workstationSetting: true,
    re: /-c: line \d+: unexpected EOF while looking for matching `'/ },
  // The net, and it ALERTS. It matches both forms above, so it must stay
  // BEHIND them, and it must not be silent.
  //
  // A non-alerting pattern is not counted either: `badInvocation` drops it before
  // its counter. Marked `workstationSetting: false`, the net would silence a third
  // shape, `script.sh: line N:` from `bash script.sh`, that neither form above matches.
  //
  // Alerting, it cannot silence anything, and its vague sentence — « un
  // guillemet ouvert et jamais refermé » — becomes the honest one: it states
  // the symptom in exactly the case where the cause is not yet characterised.
  { id: 'inv-bash-unbalanced-quote', class: 'invocation', workstationSetting: true,
    re: /line \d+: unexpected EOF while looking for matching/ },
  { id: 'inv-bash-syntax-error', class: 'invocation', workstationSetting: true,
    re: /line \d+: syntax error near unexpected token/ },
  // Recognised in order to be EXCLUDED, never to be said — and it is NOT
  // counted either: the detector's filter returns before its counter.
  //
  // It tells a PowerShell cmdlet from a missing binary by the CASE of the name alone, which
  // is no criterion: alerting, `Docker-Compose: command not found` would ring while
  // `docker-compose: command not found` stays silent, and a missing binary has no setting to post.
  //
  // Silence is right here and wrong for the net above, which would hide a shape nobody has
  // characterised yet. It sits after `env-binary-missing`, so a message both match is taken as
  // an environment failure first.
  { id: 'inv-cross-shell-cmdlet-in-posix', class: 'invocation', workstationSetting: false,
    re: /line \d+: [A-Z][a-z]+-[A-Z][A-Za-z]+: command not found/ },
  // The five PowerShell patterns, together. The anchor is the .NET identifier,
  // never the sentence in front of it — see point 2 of the header, the rule of
  // this table easiest to undo by accident.
  { id: 'inv-ps-command-not-found', class: 'invocation', workstationSetting: true,
    re: /FullyQualifiedErrorId\s*:\s*CommandNotFoundException/ },
  { id: 'inv-ps-parameter-not-found', class: 'invocation', workstationSetting: true,
    re: /FullyQualifiedErrorId\s*:\s*NamedParameterNotFound/ },
  { id: 'inv-ps-argument-type', class: 'invocation', workstationSetting: true,
    re: /FullyQualifiedErrorId\s*:\s*CannotConvertArgument/ },
  { id: 'inv-ps-syntax', class: 'invocation', workstationSetting: true,
    re: /FullyQualifiedErrorId\s*:\s*(?:ExpectedValueExpression|TerminatorExpectedAtEndOfString|MissingEndParenthesisInMethodCall|InvalidVariableReferenceWithDrive)/ },
  { id: 'inv-ps-argument-exception', class: 'invocation', workstationSetting: true,
    re: /FullyQualifiedErrorId\s*:\s*System\.ArgumentException/ },

  // ── LAYER 5 — invocation, tool protocol: recognised in order to be
  // EXCLUDED from advice. The instruction already exists and is read every
  // turn.
  { id: 'inv-tool-schema-rejected', class: 'invocation', workstationSetting: false,
    re: /InputValidationError/ },
  { id: 'inv-write-before-read', class: 'invocation', workstationSetting: false,
    re: /File has not been read yet\. Read it first before writing to it/ },
  { id: 'inv-read-without-pagination', class: 'invocation', workstationSetting: false,
    re: /exceeds maximum allowed (?:tokens|size)[^]{0,120}offset and limit/ },
  { id: 'inv-read-on-directory', class: 'invocation', workstationSetting: false,
    re: /EISDIR: illegal operation on a directory/ },
  { id: 'inv-edit-anchor-missing', class: 'invocation', workstationSetting: false,
    re: /String to replace not found in file/ },
  { id: 'inv-edit-noop', class: 'invocation', workstationSetting: false,
    re: /No changes to make: old_string and new_string are exactly the same/ },
  { id: 'inv-edit-replace-all-missing', class: 'invocation', workstationSetting: false,
    re: /matches of the string to replace, but replace_all is false/ },
  { id: 'inv-search-bad-pattern', class: 'invocation', workstationSetting: false,
    re: /regex parse error|ripgrep rejected the pattern/ },
  // The weakest entry of the table on generality: it targets the shape
  // "<tool>: <subcommand> does not support" of a command-line wrapper, naming
  // no tool. To be dropped if the product wants to depend on no third-party
  // tool at all.
  { id: 'inv-wrapper-unsupported', class: 'invocation', workstationSetting: false,
    re: /\b\w+: \w+ \w+ does not support\b/ },
  { id: 'inv-unknown-agent-or-skill', class: 'invocation', workstationSetting: false,
    re: /Agent type '[^']*' not found|Unknown skill:|No such tool available/ },
  { id: 'inv-git-bad-ref', class: 'invocation', workstationSetting: false,
    re: /fatal: ambiguous argument|unknown revision or path not in the working tree/ },

  // ── LAYER 6 — the generic invocation entry, and why it sits here. "This
  // file does not exist" is exploration: no instruction makes anyone guess a
  // directory tree. So it is classified in order to be EXCLUDED, never to be
  // advised — hence workstationSetting false, which keeps it off the alerting
  // path. (It is not counted either: the detector's filter returns before its
  // counter. Nothing in this table is "counted but unsaid" — see the net's
  // entry above.) And it is the LAST invocation pattern because it is the only
  // one that leaks into verdicts (4 measured false positives, 2 node stack
  // traces and 2 python tracebacks). Moving it up re-opens all four.
  // `introuvable dans` is the second of the table's two French anchors.
  { id: 'inv-path-not-found', class: 'invocation', workstationSetting: false,
    re: /(?:Path|File) does not exist|No such file or directory|introuvable dans/ },

  // ── LAYER 7 — the last net, and it must stay a layer of its own. Nearly
  // every failing shell output starts here, so anywhere above the invocation
  // patterns this entry takes everything and the detector goes mute.
  { id: 'vrd-exit-code-bare', class: 'verdict', workstationSetting: false,
    re: /^\s*Exit code \d+/ },
] satisfies InvocationPattern[]).map(p => Object.freeze(p)));

export interface ClassifyResult {
  id: string;
  class: PatternClass;
}

/**
 * A string → a category, or `null` when no pattern recognises it.
 *
 * @param text the `error` field of a PostToolUseFailure
 */
export function classify(text: unknown): ClassifyResult | null {
  // This guard is not defensive handling of an impossible case: `error` is a
  // hook field, not a value this module builds. It can be absent, empty, or
  // not a string at all. That is the real contract of the input, and a
  // classifier that threw on it would take the watchdog's event loop down.
  if (typeof text !== 'string' || text === '') return null;
  for (const p of PATTERNS) {
    // `test` and never `exec`, so no captured group can ever escape. What
    // comes out is a pattern identifier and a class name, both drawn from this
    // table and fixed at load: no string that came in can come back out —
    // which is what lets the product's promise ("no prompt, file, tool output
    // or command content is retained") stand unamended.
    //
    // A fresh object every call, never the table entry: a consumer that
    // mutates it gets no answer wrong for the next caller, and nothing of the
    // table — its regex first of all — leaks out.
    if (p.re.test(text)) return { id: p.id, class: p.class };
  }
  return null;
}
