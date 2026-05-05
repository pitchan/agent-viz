# agent-viz

Real-time visualizer for [Claude Code](https://docs.claude.com/en/docs/claude-code) sessions. Streams hook events into a live web dashboard with multi-agent topology, token usage, and tool-call timeline.

## Quick start

```bash
npx agent-viz
```

That's it. The CLI will:

1. Install the necessary Claude Code hooks (project-local by default if you're inside a git/npm project, user-level otherwise).
2. Start a local server on `http://localhost:3333`.
3. Stream events from your Claude Code sessions live into the dashboard.

Open `http://localhost:3333` in your browser, then run Claude Code in any other terminal — events appear in real time.

## Installation modes

### One-shot (no install)

```bash
npx agent-viz
```

Run from anywhere. Caveat: each Claude Code hook firing pays the npx cold-start cost (~300–800 ms). Fine for occasional use; for daily use prefer a global install.

### Global install (recommended for daily use)

```bash
npm install -g agent-viz
agent-viz
```

Hook firings then take ~40–80 ms each (the hook command in `settings.json` becomes an absolute path to the installed binary).

### Per-project install

```bash
npm install --save-dev agent-viz
npx agent-viz
```

Adds `agent-viz` as a dev dependency. The hook is registered at project scope (`<root>/.claude/settings.local.json`, gitignored).

## Commands

| Command | Description |
|---|---|
| `agent-viz` *(default: `start`)* | Install hooks if missing, start the server detached. Idempotent. |
| `agent-viz start` | Same as above. Flags: `--port N`, `--foreground`, `--no-install-hooks`, `--open`. |
| `agent-viz stop` | Gracefully shut down the running server. |
| `agent-viz status` | Show running state, URL, PID, log path. |
| `agent-viz install-hooks` | Install Claude Code hooks. Scope flags: `--user`, `--project`, `--local` (default in project). Use `--check` for read-only audit. |
| `agent-viz uninstall-hooks` | Remove agent-viz hooks. Without scope flag, scans all three locations. |
| `agent-viz --help` | Show full usage. |

## How hook scope is chosen

When installing, agent-viz walks up from the current directory looking for a `.git/` or `package.json` marker.

| Situation | Default destination |
|---|---|
| Inside a git/npm project | `<root>/.claude/settings.local.json` (gitignored, machine-local) |
| Outside a project | `~/.claude/settings.json` (user-level) |
| `--user` / `--project` / `--local` | Always honored, overrides the default |

When writing to `.claude/settings.local.json`, agent-viz also adds the file to your `.gitignore` (only if a `.gitignore` already exists).

## Captured events

`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`. Events land as JSONL in `${tmpdir}/claude-events/<session_id>.jsonl` and are streamed to the dashboard via Server-Sent Events.

## Housekeeping

The server purges sessions older than 24 h on boot and every hour, keeps the 20 most recent, and compacts files larger than 500 KB. All thresholds are configurable via env vars: `VIZ_PURGE_AGE_H`, `VIZ_KEEP_MAX`, `VIZ_COMPACT_KB`, `PORT`.

## Stopping

```bash
agent-viz stop
```

This sends `POST /shutdown` to the running server and falls back to `SIGTERM` / `SIGKILL` if needed. Hooks remain registered until you run `agent-viz uninstall-hooks`.

## Requirements

- Node.js ≥ 18
- Claude Code installed and configured

## License

MIT — see [LICENSE](./LICENSE).
