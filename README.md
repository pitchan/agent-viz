# agent-viz

Real-time visualizer for [Claude Code](https://docs.claude.com/en/docs/claude-code) sessions. Streams hook events into a live web dashboard with multi-agent topology, token usage, and tool-call timeline.

## Install & start (recommended)

Two commands and you're done:

```bash
npm install -g agent-viz
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

## Other ways to run it

### Try it once without installing

```bash
npx agent-viz
```

Same behavior as the global install, **but slower in practice**: each Claude Code hook firing pays an npx cold-start cost (~300–800 ms) because the binary is resolved from a temp cache. For daily use, prefer the global install above (~40–80 ms per hook firing).

### Per-project install

```bash
npm install --save-dev agent-viz
npx agent-viz
```

Adds `agent-viz` as a dev dependency. The hook command embedded in `settings.json` points at the local `node_modules/.bin/agent-viz` (fast, no npx overhead). Scope defaults to `<root>/.claude/settings.local.json` (gitignored).

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

## Hook management

The first time you run `agent-viz`, it auto-registers Claude Code hooks. By default they go to:

- `<project>/.claude/settings.local.json` (gitignored) when launched inside a git or npm project,
- `~/.claude/settings.json` (user-level) otherwise.

You only need the commands below in three situations:

**1. You want to share the hook with your team.** The default install is gitignored so each teammate manages their own. To commit it instead:

```bash
agent-viz install-hooks --project   # writes <root>/.claude/settings.json (committed)
```

**2. You globally installed agent-viz from inside a project but want the hook user-wide.** Default scope detection picked `--local`; force user scope:

```bash
agent-viz install-hooks --user      # writes ~/.claude/settings.json
```

**3. You want to check or remove the hooks.**

```bash
agent-viz install-hooks --check     # read-only audit: which events are wired up?
agent-viz uninstall-hooks           # remove from all scopes
agent-viz uninstall-hooks --user    # remove from user scope only
```

When writing to `settings.local.json`, agent-viz appends the file to your `.gitignore` (only if a `.gitignore` already exists, never creates one).

## Captured events

`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`. Events land as JSONL in `${tmpdir}/claude-events/<session_id>.jsonl` and are streamed to the dashboard via Server-Sent Events.

## Configuration

Environment variables (all optional):

| Var | Default | Effect |
|---|---|---|
| `PORT` | `3333` | Port the dashboard listens on. |
| `VIZ_PURGE_AGE_H` | `24` | Delete sessions older than N hours. |
| `VIZ_KEEP_MAX` | `20` | Keep at most N most recent sessions. |
| `VIZ_COMPACT_KB` | `500` | Compact files larger than N KB (keeps last 100 events + summary). |

The server purges old sessions on boot and every hour.

## Requirements

- Node.js ≥ 18
- Claude Code installed and configured

## License

MIT — see [LICENSE](./LICENSE).
