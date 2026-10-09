# agent-viz

**Where do your tokens go?** One command, zero runtime dependencies: agent-viz tracks your coding agents live and puts a measured figure on what they waste.

It works with [Claude Code](https://docs.claude.com/en/docs/claude-code), [GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli), [Antigravity CLI](https://antigravity.google) and [Codex](https://developers.openai.com/codex). It reads, measures and advises. It runs nothing on your behalf, and none of your data leaves your machine.

[![agent-viz in 20 seconds](docs/media/agent-viz-promo.gif)](https://youtu.be/GYJ5cXP6u4w)

- **Live view** — every tool call, every subagent, tokens and cost, as the session runs.
- **Live alerts** — an agent repeating the same call, failing in a row, or gone silent raises an alert while it happens. No rule to configure.
- **Advice** — costs measured on your own past sessions, each one tied to a figure and to one action.

## Install & start (recommended)

Two commands and you're done:

```bash
npm install -g @vcueto/agent-viz
agent-viz
```

That second command does **everything in one go**:

- registers the Claude Code hooks (first run only — idempotent),
- starts the dashboard on http://localhost:3333,
- returns control to your terminal (the server runs in background).

Open http://localhost:3333, run Claude Code in any other terminal, watch events appear live. To stop:

```bash
agent-viz stop
```

To update, reinstall and restart the dashboard:

```bash
npm install -g @vcueto/agent-viz
agent-viz stop --keep-hooks
agent-viz
```

## What works with which agent

| Feature | Claude Code | Copilot CLI | Antigravity CLI | Codex |
|---|:---:|:---:|:---:|:---:|
| **Live view** | | | | |
| Tool calls as they happen | ✅ | ✅ | ✅ | ✅ |
| A failed tool shown as an error | ✅ | ❌ ¹ | ⚠️ ² | ⚠️ ⁷ |
| Subagents in the topology | ✅ | 🚧 | ❌ | ❌ |
| Tokens | ✅ | ❌ ³ | ⚠️ ⁴ | ⚠️ ⁸ |
| Cost | ✅ | ❌ | ⚠️ ⁵ | ⚠️ ⁹ |
| Session duration | ✅ | ✅ | ❌ ⁶ | ✅ |
| **Live alerts** | | | | |
| Loop | ✅ | ✅ | ✅ | ✅ |
| Stuck | ✅ | 🚧 | ✅ | ✅ |
| Retry storm | ✅ | ❌ ¹ | ⚠️ ² | ⚠️ ⁷ |
| Bad invocation | ✅ | ❌ ¹ | 🚧 | ⚠️ ⁷ |
| **Observatory** | | | | |
| Advice, analysed sessions, tokens & prices, skills | ✅ | ❌ | ❌ | ❌ |

✅ works · ⚠️ works with a limit · ❌ not available · 🚧 not reliable yet: do not count on it for that agent

1. Copilot CLI sends no tool-failure event.
2. Known once the model call ends, not when the tool ends.
3. Copilot CLI does not expose token usage.
4. One model call behind during a turn, exact once it ends.
5. Cost is an estimate from Google's public API prices, not what your Antigravity plan bills.
6. Antigravity sends no session-start event.
7. Shell commands only, on Codex 0.155 or later: Codex sends no tool-failure event, so the failure is read from the session transcript. A command that never starts turns red at the next Codex event.
8. No figure for a forked thread, nor for a session written by an older Codex.
9. What the session would cost at OpenAI's API rates. A ChatGPT plan is billed differently, and codex-auto-review has no published price.

Cursor is not supported.

## What it changes on your machine

| What | Where | How to undo |
|---|---|---|
| Hook entries, one per captured event | `~/.claude/settings.json`, `~/.copilot/hooks/agent-viz.json`, `~/.gemini/config/hooks.json`, `~/.codex/hooks.json` — only for the agents found on your machine | `agent-viz stop` removes them; `agent-viz uninstall-hooks` does it without touching the dashboard |
| A copy of each hooks file, taken before it is changed | `~/.agent-viz/backups/` | delete the folder |
| Live events, as the agent sends them: prompts, tool inputs and tool results | `<temp dir>/agent-events/`, one file per session, deleted after 24 hours | `agent-viz` deletes them on its own; the dashboard also has a clear button |
| The analysis database: counters, sizes, tool names, and [three named exceptions](#observatory-analysis-and-advice) | `~/.agent-viz/observatory.db` | delete the file, it is rebuilt from your transcripts |

- agent-viz adds its own hook entries and leaves the ones you wrote untouched. See [Coexistence with other hooks](#coexistence-with-other-hooks).
- `agent-viz install-hooks --check` shows what is wired up without writing anything.
- The server listens on `127.0.0.1` only.
- The only outbound traffic: once a day, agent-viz downloads two public Anthropic documentation pages (prices and model list) to check its bundled price table against them. Nothing about you or your sessions is sent.

## Other ways to run it

### Try it once without installing

```bash
npx @vcueto/agent-viz
```

Same behavior as the global install, **but slower in practice**: each Claude Code hook firing pays an npx cold-start cost (~300–800 ms) because the binary is resolved from a temp cache. For daily use, prefer the global install above (~40–80 ms per hook firing).

### Per-project install

```bash
npm install --save-dev @vcueto/agent-viz
npx agent-viz
```

Adds `agent-viz` as a dev dependency. The hook command embedded in `settings.json` runs the installed package directly, `node "<repo>/node_modules/@vcueto/agent-viz/bin/agent-viz.js" hook` (fast, no npx overhead). Scope defaults to user level (`~/.claude/settings.json`), as for the global install. To limit the hook to this repo, see [Hook management](#hook-management).

## Daily usage

| Goal | Command |
|---|---|
| Start the dashboard | `agent-viz` |
| Stop it | `agent-viz stop` |
| See if it's running | `agent-viz status` |
| Run attached (Ctrl+C to quit) | `agent-viz start --foreground` |
| Use a different port | `agent-viz start --port 4000` |
| Open browser automatically | `agent-viz start --open` |
| Skip auto hook install | `agent-viz start --no-install-hooks` |

## Live alerts

Four detectors watch the event stream of every session. They need no configuration. An alert appears on the bell in the top bar and, if you allow it, as a browser notification.

| Alert | Raised when |
|---|---|
| **Loop** | the same agent calls the same tool with the same input 4 times within 60 seconds |
| **Retry storm** | the same agent fails 3 times in a row on the same tool; a success resets the count |
| **Stuck** | a tool is still running and no event has arrived for 3 minutes |
| **Bad invocation** | a call failed because of how it was written, for a cause you fix once on your workstation — a Windows path passed unquoted to bash, for instance |

- An alert states a count it has seen, such as "3 of 4 failing". It never claims more than that.
- A call you interrupt yourself is never counted as a failure.
- A stuck alert withdraws itself when the session speaks again. After 30 minutes of silence the session is treated as over, not stuck.
- Retry storm and Bad invocation rely on the tool-failure event, which not every agent sends: see [What works with which agent](#what-works-with-which-agent).

## Observatory (analysis and advice)

Two pages come on top of the live view, opened from the toolbar. Their labels are in French in the interface.

- **Advice** (*Conseils*) — the actions to take first, each one tied to a figure measured on your own sessions:
  - which project rebuilds its cache prefix mid-session;
  - which MCP server is loaded everywhere and never called;
  - which command prints a lot, often;
  - which files several agents read again;
  - which sessions are compacted several times;
  - which subagents are started for tasks too short to be worth it;
  - which sessions end with unverified changes — files modified after the last test, build, lint or typecheck command, and the tokens emitted after that last proof.
- **Analysed sessions** (*Sessions analysées*) — the table of measured sessions (cost, net tokens, duration, main model), with the figures session by session.

No saving is projected: these are costs observed over the period.

### What you do with a piece of advice

The Observatory measures and advises. It never runs anything on your behalf. Each card asks one question and offers three answers:

| Answer | What happens |
|---|---|
| **I adopt it** (*Je l'adopte*) | the card goes to the journal; if its recomputed cost grows back by 50 % or more, it returns and asks whether the change really took |
| **Later** (*Plus tard*) | the card returns on its own at the same threshold |
| **No thanks** (*Non merci*) | you record your reason in one line; this advice is never offered again |

- No decision is final: each one is listed in the folded section *Décisions rendues*, with its date and a *Réactiver* button.
- Known limit: a project is identified by its **path**. A moved or renamed project is a new subject, and its card comes back active.

### What is counted

- The analysis window is chosen in the header: 7, 30 or 90 days, 30 by default. Each card shows the period it was observed on.
- Machine sessions (`claude -p`, scripts) are scanned and badged, and left out of the advice and the totals by default. A switch shows them on demand, and the summary always states which sessions were counted.
- The database migrates on its own at startup: a new column triggers a full re-scan in the background, without blocking the live view.

### Three things to know

- **Two blocks, never one ranking.** Some rules count real tokens, others start from bytes converted at about 4 bytes per token. The two do not have the same precision: the page shows them apart and displays **no total**, because one session feeds several rules and would be counted twice.
- **One source of prices.** The price table bundled with the engine prices the whole product, live view included, and each page names where its prices come from. The table is dated: a message is priced at the rate in force on the day it was sent. The public pages downloaded once a day only serve as a check: they flag a drift and never set a price. A session whose model has no known price is marked "partial", never rounded to zero silently.
- **Metadata, and three named exceptions.** Most of what the database keeps is counters, sizes and tool names: no file content and no tool output goes into it. Three things do, and you should know it:
  - the **paths** of files modified after the last verification, 20 at most per session;
  - the **text of two verification commands** per session, the first and the last, 200 characters at most, with assignments such as `NPM_TOKEN=…` removed before writing;
  - an **excerpt of the questions** you asked, when they look like a question about finding your way in the code.

  All of it stays on your machine: the database is a local file and is sent nowhere.

### The database is disposable

- `~/.agent-viz/observatory.db` is derived data: your transcripts remain the source of truth.
- Deleting it only loses the decisions you recorded on the advice cards, refusal reasons included. It is rebuilt at the next scan: at startup, then every hour.
- The *Purger la base* button on the Advice page does the same without touching the file: it empties the database, after confirmation, then starts a full scan.

### The analysis engine

The analysis runs on the netgain engine, which **is part of agent-viz**: same repository (folder `src/engine/`), same package, same version, same install. There is nothing to plug in or install on the side. If the engine were missing — a damaged install — both pages show the exact error and **the live view keeps working normally**.

## Multi-agent support

agent-viz captures events from **Claude Code, GitHub Copilot CLI, Antigravity CLI and Codex** simultaneously. On first run, it auto-detects which CLI agents are installed locally and registers the appropriate hooks for each. Sessions are tagged in the dashboard with a colored pill badge (cyan for Claude, violet for Copilot, pink for Antigravity, green for Codex).

To force a target explicitly:

```bash
agent-viz install-hooks --target=claude        # Claude only
agent-viz install-hooks --target=copilot       # Copilot only
agent-viz install-hooks --target=antigravity   # Antigravity only
agent-viz install-hooks --target=codex         # Codex only
agent-viz install-hooks --target=both          # all agents even if not detected
```

Detection: an agent is considered installed if its CLI binary is on your `PATH` (`agy` for Antigravity), or if its config home (`~/.claude/` for Claude, `~/.copilot/` for Copilot, `~/.gemini/antigravity-cli/` for Antigravity, `~/.codex/` for Codex) exists with at least one file inside.

### Antigravity CLI

- agent-viz writes a single `agent-viz` key in `~/.gemini/config/hooks.json` (or `<repo>/.agents/hooks.json` with `--project`); other hook names in that file are left untouched.
- There is no `--local` scope for Antigravity: the interactive prompt does not offer it.
- The agent-viz install path must not contain a space: Antigravity passes quotes through to the command on Windows, so a quoted path cannot run.

Known limits, all on Antigravity's side:
- A failed tool (non-zero exit, or a call rejected before it runs) turns red once the model call ends, not when the tool ends: Antigravity writes the result after its end event.
- The error text is Antigravity's own sentence, followed by the command's output; its exit code is not always the command's (`exit 3` is reported as code 1).
- To read these results, agent-viz also runs on `PostInvocation`: one more hook process per model call.
- Tokens are read from `~/.gemini/antigravity-cli/conversations/<id>.db` (undocumented). They lag one model call behind during a turn and are exact once it ends. If the format changes, the session shows "Tokens N/A" instead of a wrong figure.
- Cost is an estimate from Google's public API prices, not what your Antigravity plan bills.
- No session duration: Antigravity sends no session-start event.
- The analysis panels (Conseils, Sessions analysées, Jetons & tarifs, Skills) cover Claude Code sessions only.

### Codex

- agent-viz adds its hook entries to `~/.codex/hooks.json` (or `<repo>/.codex/hooks.json` with `--project`); hooks you wrote in that file are left untouched.
- There is no `--local` scope for Codex: the interactive prompt does not offer it.
- Nothing shows up until you trust the hooks in Codex: it asks you to review them the next time it starts. You have to do it again whenever agent-viz rewrites its hook command.
- If that file already holds an agent-viz command tagged `--source=claude`, the install rewrites it to `--source=codex`. Until then, Codex sessions show up under the Claude badge.

Known limits:
- Tokens are read from the session transcript under `~/.codex/sessions/`.
- A thread forked from another one starts with a copy of its parent's history, token lines included, with nothing marking where the copy ends: agent-viz shows "Tokens N/A" for it instead of a figure that would count the parent twice.
- Older Codex builds write token lines with a total and no breakdown. agent-viz shows "Tokens N/A" for those sessions instead of a wrong figure. Seen on 0.135.0-alpha.1, not on 0.147 and later.
- Cost is what the session would cost at OpenAI's API rates. A ChatGPT plan is billed differently, and codex-auto-review has no published price.
- Codex sends no tool-failure event. agent-viz reads the outcome of each shell command from the session transcript: a non-zero exit code, or a command the sandbox refused to start, is shown as a failed tool.
- A command that never starts sends no end event at all: it turns red at the next Codex event (next tool, next prompt, or end of turn), not at once.
- A failed file edit or MCP call is not reported.
- Codex builds before 0.155 do not write the command outcome in their transcript: no failure is shown for those sessions.
- Only the last megabyte of the transcript is read on each event: a command whose output line is larger is shown as successful.
- Subagent threads are not drawn in the topology.

## Hook management

The first time you run `agent-viz`, it auto-registers hooks for each detected agent. **The default scope is user-level (global)** — the hook then fires from every directory, so a session launched anywhere is captured:

| Agent | Default location (user scope) |
|---|---|
| Claude Code | `~/.claude/settings.json` |
| Copilot CLI | `~/.copilot/hooks/agent-viz.json` |
| Antigravity CLI | `~/.gemini/config/hooks.json` |
| Codex | `~/.codex/hooks.json` |

Project scopes are opt-in. You only need the commands below in three situations:

**1. You want to scope the hook to one repo (and share it with your team).** Commit it at project scope:

```bash
agent-viz install-hooks --project   # writes <root>/.claude/settings.json (committed)
agent-viz install-hooks --local     # writes the gitignored per-repo variant
```

**2. You're already on user scope and want to confirm it.**

```bash
agent-viz install-hooks --user      # writes ~/.claude/settings.json (this is the default)
```

**3. You want to check or remove the hooks.**

```bash
agent-viz install-hooks --check     # read-only audit: which events are wired up?
agent-viz uninstall-hooks           # remove from all scopes
agent-viz uninstall-hooks --user    # remove from user scope only
```

When writing to `settings.local.json`, agent-viz appends the file to your `.gitignore` (only if a `.gitignore` already exists, never creates one).

### Backups

Before `start`, `stop`, `install-hooks` or `uninstall-hooks` changes or deletes a hooks file, agent-viz copies the file as it is to `~/.agent-viz/backups/<source path>/<UTC time>.json`. In `<source path>`, every character other than a letter, a digit, `.`, `_` or `-` becomes `-`: `/home/me/.claude/settings.json` gives `-home-me-.claude-settings.json`. The last 30 copies of each file are kept. A file that does not exist yet is not copied.

The command prints the path of each copy under the file it changed:

```
✓ Claude Code hooks refreshed → /home/me/.claude/settings.json
  scope: user, mode: absolute
  backup: /home/me/.agent-viz/backups/-home-me-.claude-settings.json/2026-09-14T10-05-07.123Z.json
```

If the copy fails, the hooks file is left unchanged and the command prints the reason: `backup of /home/me/.claude/settings.json failed, file left unchanged: <reason>`.

To restore a copy, copy it back by hand. `settings.json` also holds settings that are not hooks (model, plugins, status line): an old copy brings them back as they were, so compare first. A Copilot file deleted by `stop` is restored the same way, to `~/.copilot/hooks/agent-viz.json`.

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.before-restore   # keep the current file
diff ~/.claude/settings.json "<backup path>"                        # see what changes
cp "<backup path>" ~/.claude/settings.json                          # restore
```

## Coexistence with other hooks

agent-viz **never replaces or removes hooks you didn't add**. Claude Code runs every hook registered for an event in parallel, so any custom hook you already had (logger, security check, etc.) keeps working alongside agent-viz.

When you run `agent-viz install-hooks`, it reports any sibling hooks already registered on the same events:

```
Claude Code:
  settings : /home/me/.claude/settings.json  (scope: user)
  hook cmd : node "<package dir>/bin/agent-viz.js" hook --source=claude  (mode: absolute)
  backup   : /home/me/.agent-viz/backups/-home-me-.claude-settings.json/2026-09-14T10-05-07.123Z.json
  ✓ added: UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, SessionStart
  Coexisting hooks (run in parallel, untouched):
    - PreToolUse: 1 other(s)
```

If an existing agent-viz hook entry has a stale command — e.g. an absolute path that no longer exists after a reinstall, or a pinned npx version that's now older than the installed package — `agent-viz install-hooks` rewrites the command in place rather than leaving it broken. Hand-edited custom wrappers (commands that don't follow the standard `node "<path>" hook` or `npx ... agent-viz... hook` shape) are left untouched.

`agent-viz install-hooks --check` now reports both missing and stale entries:

```
  [x] UserPromptSubmit
  [~] PreToolUse        (stale, +1 other)
  [ ] PostToolUse
```

To start completely clean:

```bash
agent-viz uninstall-hooks   # removes all agent-viz hooks across scopes
agent-viz install-hooks     # re-add a fresh entry
```

## Uninstalling

Two steps, **in order** — npm 7+ no longer runs lifecycle scripts on uninstall ([official docs](https://docs.npmjs.com/misc/scripts#a-note-on-a-lack-of-npm-uninstall-scripts)), so you have to clean up the hooks before removing the package:

```bash
agent-viz uninstall-hooks    # remove agent-viz hooks from all scopes
npm uninstall -g @vcueto/agent-viz   # then remove the package
```

If you skipped step 1 (or uninstalled an older version), Claude Code will start logging `Cannot find module` errors at every hook firing. Recover with:

```bash
# Easiest — npx fetches a fresh agent-viz just to run the cleanup:
npx --yes @vcueto/agent-viz@latest uninstall-hooks

# Or hand-edit ~/.claude/settings.json and remove every hook entry whose
# `command` mentions "agent-viz".
```

If you reinstall agent-viz to a different path later (e.g. moved your dev clone), `agent-viz install-hooks` rewrites the stale absolute paths in place — no need to uninstall first.

## Captured events

`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure` (Claude Code only), `Stop`, `SessionStart`. Antigravity and Codex send no such event: for them, agent-viz writes `PostToolUseFailure` itself, from the tool result the agent reports or from its session transcript. Events land as JSONL in `${tmpdir}/agent-events/<session_id>.jsonl` and are streamed to the dashboard via Server-Sent Events. Each event carries a `_source: "claude" | "copilot" | "antigravity" | "codex"` field set by the hook command's `--source` flag.

## Configuration

Environment variables (all optional):

| Var | Default | Effect |
|---|---|---|
| `PORT` | `3333` | Port the dashboard listens on. Also the port `start`, `stop` and `status` target when no pid file exists. |
| `VIZ_PURGE_AGE_H` | `24` | Delete sessions older than N hours. |
| `VIZ_KEEP_MAX` | `20` | Keep at most N most recent sessions. |
| `VIZ_COMPACT_KB` | `500` | Compact files larger than N KB (keeps last 100 events + summary). |

The server purges old sessions on boot and every hour.

## Requirements

- Node.js `>=24.16.0 <25 || >=26.1.0`. On Windows, every earlier release (24.0–24.15, all of 25.x, 26.0.0) ships a libuv defect that randomly kills a Node process on any connection to 127.0.0.1 (libuv#5107, cherry-picked into Node 24.16.0 and 26.1.0). agent-viz opens one such connection per hook event and on every `start`, `status` and `stop`.
- Claude Code installed and configured

## Development

One repository, **one package**: `@vcueto/agent-viz`. The analysis engine is not a separate
package — its TypeScript source lives in `src/engine/` and its build output, `dist/engine/`,
ships inside the published tarball. Since the 2026-08 tree merge there is a single `src/`:
`src/server/` (the daemon, ESM since step 3 of the migration), `src/engine/` (the engine,
TypeScript ESM) and `src/web/` (the browser code, TypeScript since step 5 — served straight
from source, types stripped at request time; there is no `dist/web/`).

The root package is ESM (`{"type":"module"}`), so `src/engine/` needs no subtree marker of
its own: no `package.json` twin to keep versioned, none written by the build.

```bash
git clone https://github.com/pitchan/agent-viz.git
cd agent-viz
npm install
npm run build                # the engine is TypeScript; dist/ is not committed
npm start                    # dashboard on http://localhost:3333
```

Tests: `npm test` (a single `vitest run` over one `tests/` tree, product and
engine together). After changing engine source, rebuild it (`npm run build`)
— the product loads the compiled `dist/engine/`. Publishing runs typecheck,
the build and the test suite first (`prepublishOnly`).

Every test file is `.test.ts`, written against vitest's own API
(`import { test, expect } from 'vitest'`). vitest loads `test-support/env-guard.ts`
first: it redirects `HOME`, `USERPROFILE`, `TEMP` and `TMP` to a throwaway
sandbox and forces a dead port, so a test can never write to your real
`~/.claude/settings.json` or reopen your observatory database.

## License

MIT — see [LICENSE](./LICENSE).
