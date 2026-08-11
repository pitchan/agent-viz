// viz-invocation-patterns.mjs — recognising, from the shape of its message, an
// error that comes from HOW something was called rather than from what it did.
//
// Pure module: no DOM, no fs, no clock, no state, no dependencies. Give it a
// string, it gives back a category or null. It knows nothing about alerts or
// events, and nothing about what a detector will do with the answer.
//
// It is a file in its own right rather than a block inside the detector because
// it has its own reason to change: this table grows with every new pattern met,
// while the alerting logic does not move.
//
// ── Where this table comes from ───────────────────────────────────────────
// It is not guessed. It comes from a survey of 370 sessions, 8 projects,
// 24,182 tool calls and 587 real failures (doc/27, 2026-08-08 — private repo,
// see docs/sources-externes.md), which measured for every pattern both its
// occurrences AND its false positives.
//
// Four of its findings are easy to undo by accident and expensive to find
// again:
//
//   1. THE ORDER, AND IT IS LAYERED. First match wins, exactly like
//      RECOGNIZERS in the engine — but "specific → generic" is not enough on
//      its own, and an independent review measured why: with the alerting
//      patterns near the top, 18 of its 20 hostile texts reached them,
//      including a `cat` of this detector's own design document.
//
//      The rule that replaces it: EVERYTHING THAT EXPLAINS THE FAILURE BY
//      SOMETHING OTHER THAN THE WAY IT WAS WRITTEN IS CONSULTED FIRST. If a
//      text carries the proof that a program ran and reported — a test
//      runner's glyphs, an execution stack, a compiler diagnostic, an npm
//      script's output — then the system message inside it is QUOTED, not
//      EMITTED, and it is a verdict. Hence the seven layers below, in this
//      order: harness → environment → program report → workstation setting →
//      tool protocol → missing path → bare exit code.
//
//      The trap that layering must not fall into, and it was measured too:
//      `vrd-exit-code-bare` matches `^\s*Exit code \d+`, and nearly every
//      failing Bash output opens that way. Ahead of the invocation patterns it
//      would take everything and the detector would go silent — the worst
//      failure this product has. Which is why it is a layer of its own, dead
//      last, and why only the FIVE SPECIFIC verdict patterns move up.
//
//      Measured on the 587 real failures: this order gives, cell for cell,
//      the same distribution as the survey's — 206 invocation, 214 verdict,
//      88 harness, 74 environment, 5 unclassified, and the same 42-hit
//      alerting subset — on the raw hook text and on the ANSI-stripped text
//      alike. It changes nothing that was measured and closes what was not.
//
//   2. THE POWERSHELL ANCHOR. On the machine this was calibrated against,
//      100% of PowerShell messages are in FRENCH: `At line:N char:` appears
//      0 times, `is not recognized` appears 0 times, and eleven messages have
//      their accents mangled into U+FFFD. A table written in English would
//      have caught ZERO PowerShell cases on the very machine where the
//      problem exists — silently, the worst failure mode this product has.
//      One written in French would have broken on the mangled accents. So the
//      five PowerShell patterns anchor on `FullyQualifiedErrorId`, a .NET
//      identifier PowerShell has never translated nor accented, and never on
//      the readable sentence in front of it.
//
//      `CategoryInfo` is NOT an anchor and is excluded by name: no pattern of
//      the survey used it, and a test refuses any pattern that mentions it.
//      The cost of that choice, measured and accepted: a PowerShell message
//      that arrives without its `FullyQualifiedErrorId` line is not classified
//      at all, however much French prose it carries.
//
//      Two patterns anchor on FRENCH prose instead, and both are outside the
//      alerting subset: `env-binary-missing` (`est introuvable`) and
//      `inv-path-not-found` (`introuvable dans`). They are the table's only
//      translated anchors and a test exercises each of them.
//
//   3. THE SHELL'S OWN STAMP. Bash prefixes every message it emits with
//      `line N:` — `/usr/bin/bash: line 1: cd: …`, `bash: eval: line 16: …`.
//      A text that merely QUOTES the message does not. All seven POSIX-shell
//      patterns therefore require that stamp: it is what tells a message the
//      shell wrote from a message a document, a test report or a container's
//      multiplexed log carries. Verified on all 28 real POSIX-shell failures
//      of the survey — every one of them keeps its classification — and on
//      the hostile texts, which stop reaching the alerting subset.
//      Residual limit, written rather than hidden: a container running bash
//      does stamp `line N:`, so its log lines can still be taken for local
//      ones.
//      That residual limit got WIDER on 2026-08-08 and is named here rather
//      than left to be discovered: `-c:` is exactly what a container stamps,
//      since `CMD`/`RUN` in shell form run `sh -c`. A multiplexed container
//      log line now reaches the ALERTING subset through
//      `inv-bash-heredoc-too-large`. A test exercises this deliberately so
//      the exposure is visible in the suite rather than in production.
//
//      A second limit, and the more important one: THE ANCHORS IDENTIFY THE
//      INVOCATION PATH, NOT THE CAUSE. `eval:` plus a double quote
//      establishes "unterminated double quote under the eval path" and
//      nothing else — no backslash, no path, no heredoc appears in the
//      regex. That the two coincided 19 times out of 19 over 90 days is a
//      correlation, not a mechanism. `grep "TODO src/` lands on the first
//      anchor, `git commit -m 'l'agent'` on the second, and each would be
//      handed the other cause's remedy. This is why the French sentences
//      state the established fact first and the likely gesture second, and
//      why the counters these patterns feed are noisier than a reader of the
//      survey would assume.
//
//   4. THE WORKSTATION SETTING. `workstationSetting` marks the subset that
//      alone deserves an alert — Windows paths, Bash quoting, PowerShell
//      cmdlets, command separators. Everything else is recognised TO BE
//      EXCLUDED, not to be said.
//
//      A pattern earns that flag by ONE test, and the doc states it by its
//      criterion rather than by a symptom: is this something the user can fix
//      ONCE and never see again? Two different things fail that test. The
//      tool-protocol patterns (`inv-write-before-read`,
//      `inv-read-without-pagination`, `inv-search-bad-pattern`) fail it
//      because their instruction is ALREADY WRITTEN in the tool descriptions
//      the agent re-reads every turn. `inv-bash-unbalanced-quote` failed it
//      for a third reason and only briefly: it merged two causes, so it could
//      name no remedy. Splitting it (doc/30) gave both causes their own flag.
//      The merged pattern stays in the table AND stays alerting — see its
//      entry for why a non-alerting net would have been silent rather than
//      safe.
//
// ── A limit that is written down rather than hidden ───────────────────────
// `bash` messages are not localised on this machine, so the `inv-bash-*`
// patterns are in English. But `bash` IS translatable through LANG/LC_ALL:
// under a non-English locale those patterns will fall silent. No stable
// identifier exists on the POSIX side to guard against it.

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
export const PATTERNS = Object.freeze([
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
  // shell — never one particular path. This is the 5 August incident: three
  // subagents of the same session tripping on `cd F:\DEV\… && …` minutes apart.
  { id: 'inv-bash-windows-path-unquoted', class: 'invocation', workstationSetting: true,
    re: /line \d+: cd: [A-Za-z]:[^\s/\\][^\s:]*: No such file or directory/ },
  { id: 'inv-bash-cd-too-many-args', class: 'invocation', workstationSetting: true,
    re: /line \d+: cd: too many arguments/ },
  // Two disjoint causes under one message. The 2026-08-08 survey (doc/30)
  // went back from the message TO THE COMMAND — which the original
  // calibration never did, having only ever read the failure text — and
  // found no typo among the 19: two workstation settings, 11 and 8.
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
  // BEHIND them — but it must not be silent, and an earlier version of this
  // split got that wrong in a way worth writing down.
  //
  // That version marked it `workstationSetting: false`, claiming it was
  // "classified and counted, never said". It counted nothing: the detector's
  // filter (`viz-watchdog.mjs:495`) returns BEFORE the counter at :502-503,
  // so a non-alerting pattern is classified and then thrown away. Counting is
  // a side effect of alerting, not a channel of its own. And before the split
  // EVERY stamped `unexpected EOF` rang, so alerting on `eval:` and `-c:`
  // alone silenced a third shape — `bash script.sh` stamps `script.sh: line
  // N:` — that used to ring. The split written to prevent silence was
  // introducing one, justified by a mechanism that did not exist.
  //
  // Alerting, it cannot silence anything, and its vague sentence — « un
  // guillemet ouvert et jamais refermé » — becomes the honest one: it states
  // the symptom in exactly the case where the cause is not yet characterised.
  { id: 'inv-bash-unbalanced-quote', class: 'invocation', workstationSetting: true,
    re: /line \d+: unexpected EOF while looking for matching/ },
  { id: 'inv-bash-syntax-error', class: 'invocation', workstationSetting: true,
    re: /line \d+: syntax error near unexpected token/ },
  // Recognised in order to be EXCLUDED, never to be said — and it is NOT
  // counted either: the detector's filter returns before its counter. This is
  // a correction of a first calibration rather than a nuance.
  //
  // It is silenced for the opposite reason to the net above, and
  // the difference is the whole rule. The net was silenced while it still
  // covered a shape that used to ring, with nothing to catch it: that was a
  // hole. This one was silenced because it rang WRONGLY — the same failure is
  // still classified by `env-binary-missing` above, and a missing binary has
  // no workstation setting to post, so saying nothing is correct. Not
  // alerting is right when the failure has no gesture to offer; it is wrong
  // when it merely hides a shape nobody has characterised yet.
  //
  // It weighs 1 occurrence, 1 project, 1 actor over 90 days, and it tells a
  // PowerShell cmdlet from a missing binary by the CASE of the name alone —
  // which is not a criterion. Left alerting, `Docker-Compose: command not
  // found` rang while `docker-compose: command not found` stayed silent: the
  // same failure, and only the capital deciding. It also now sits after
  // `env-binary-missing`, the pattern it used to precede 51 occurrences to 1.
  { id: 'inv-cross-shell-cmdlet-in-posix', class: 'invocation', workstationSetting: false,
    re: /line \d+: [A-Z][a-z]+-[A-Z][A-Za-z]+: command not found/ },
  // The five PowerShell patterns, all five of them, together. The anchor is
  // the .NET identifier, never the sentence in front of it — see point 2 of
  // the header. This is the least intuitive decision of the survey and the
  // easiest one to undo by accident.
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
].map(Object.freeze));

/**
 * A string → a category, or `null` when no pattern recognises it.
 *
 * @param {unknown} text the `error` field of a PostToolUseFailure
 * @returns {{ id: string, class: string } | null}
 */
export function classify(text) {
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
