# Design — agent-viz multi-agent (Claude Code + GitHub Copilot CLI)

**Status:** approved (decisions locked)
**Target:** v0.2.0
**Author:** Vincent (brainstormed with Claude)

## Goal

Make agent-viz capture and display events from **both Claude Code and GitHub Copilot CLI** in the same dashboard, with each event/session tagged by its source agent. The end-user runs one command (`agent-viz`) and gets a multi-agent live view.

## Why this is non-trivial

Claude Code and Copilot CLI both expose a hook system, but they diverge on:

- **Config file location** — Claude reads `.claude/settings.json` only. Copilot reads `.github/hooks/*.json` (project) and `~/.copilot/hooks/*.json` or `~/.copilot/settings.json` `hooks` key (user). `.claude/settings.json` is read by Copilot for some keys (skills, marketplaces) but **not officially documented for `hooks`** — we don't rely on it.
- **Hook command shape** — Claude: `{type, command, timeout}`. Copilot: `{type, bash, powershell, timeoutSec}`.
- **Wrapper JSON shape** — Claude: `settings.hooks.<EventName>[].hooks[]`. Copilot: `{version: 1, hooks: {<eventName>: [...]}}`.
- **Event payload format** — Copilot supports two formats; we pick **VS Code-compat (snake_case)** so payloads land identical to Claude's (`session_id`, `hook_event_name`).

## High-level architecture

```
Claude Code         Copilot CLI
     │                   │
     │ fires hook        │ fires hook
     ▼                   ▼
  node ".../bin/agent-viz.js" hook --source=claude
  node ".../bin/agent-viz.js" hook --source=copilot
                    │
                    │ stamp _source on event
                    ▼
        ${tmpdir}/agent-events/<session_id>.jsonl
                    │
                    │ POST /notify
                    ▼
              agent-viz server
                    │
                    │ SSE stream (with _source enriched)
                    ▼
              dashboard (badge)
```

## Decisions (locked)

### D1. Scope of integration → multi-agent badge (option B)

Events from both agents land in the same dashboard. Each event carries `_source: "claude" | "copilot"`. UI shows a small badge per session card and on the topbar so the user knows who fired what.

We do **not** treat Copilot-only events (`ErrorOccurred`, `PreCompact`, `SubagentStart/Stop`, `Notification`, `PermissionRequest`) at this stage. They land in the JSONL stream as raw events but the dashboard doesn't render them specifically. That's future work (v0.3+).

### D2. Hook installation target → native paths per agent (option B)

| Agent | Scope | File |
|---|---|---|
| Claude Code | user | `~/.claude/settings.json` |
| Claude Code | project | `<root>/.claude/settings.json` (committed) |
| Claude Code | local | `<root>/.claude/settings.local.json` (gitignored) |
| Copilot CLI | user | `~/.copilot/hooks/agent-viz.json` (dedicated file) |
| Copilot CLI | project | `<root>/.github/hooks/agent-viz.json` (committed) |
| Copilot CLI | local | `<root>/.github/hooks/agent-viz.local.json` (gitignored) |

Each agent gets its own dedicated file. No attempt to write Copilot hooks into `.claude/settings.json` (undocumented behavior, fragile).

### D3. Payload format → VS Code-compat (snake_case)

Hooks are registered in Copilot's `hooks.json` using the **PascalCase event names** (`SessionStart`, `PreToolUse`, etc.), which triggers Copilot to emit the VS Code-compatible payload format with `session_id` and `hook_event_name` fields. This matches Claude's payload shape — `lib/hook.js` parses both transparently.

If empirical testing reveals the format mapping doesn't behave as documented, fallback is a 30-line normalization layer in `hook.js`.

### D4. Source tagging → CLI flag `--source=<agent>`

The hook command embedded in each agent's config carries an explicit flag:

- Claude config: `node ".../bin/agent-viz.js" hook --source=claude`
- Copilot config: `node ".../bin/agent-viz.js" hook --source=copilot`

`lib/hook.js` reads the flag, stamps `_source` on the event, writes JSONL.

### D5. Event storage directory → `agent-events/` with transitional dual-read

- Hooks write to `${tmpdir}/agent-events/<session_id>.jsonl` (new).
- Server reads from BOTH `${tmpdir}/agent-events/` AND `${tmpdir}/claude-events/` (legacy).
- Events read from legacy dir default to `_source: "claude"` if missing.
- Drop legacy read after 2 minor versions (v0.4.0).

### D6. CLI surface → auto-detect with override

```
agent-viz install-hooks                       # detect installed agents, install for all
agent-viz install-hooks --target=claude       # force claude only
agent-viz install-hooks --target=copilot      # force copilot only
agent-viz install-hooks --target=both         # force both regardless of detection
agent-viz install-hooks --check               # audit all detected agents
agent-viz install-hooks --user|--project|--local   # scope (unchanged)
agent-viz uninstall-hooks                     # remove from all detected agents
```

**Detection logic:**
- Claude installed if: `claude` in PATH OR `~/.claude/settings.json` exists.
- Copilot installed if: `copilot` in PATH OR `~/.copilot/` directory exists with any file.
- If neither detected → install for Claude (back-compat with current default).

### D7. Dashboard badges → session card + topbar

Add small pill badge:
- **Claude** → color `--holo` (cyan, `#66ccff`)
- **Copilot** → color `--agent` (violet, `#bc8cff`)

Locations:
- Each `.session-card` in `#sessions-list`: badge next to ID slice.
- Topbar: badge next to `.logo` when a session is active, derived from current session's source.

No per-event badge in the activity feed (events within a session all share the same source — redundant).

## Code-level changes

### `lib/install-hooks.js`

- Add a parallel module/section for Copilot: `installCopilot`, `uninstallCopilot`, `auditCopilot`.
- Add `detectAgents({ cwd })` returning `{ claude: bool, copilot: bool }`.
- New `EVENTS_COPILOT` constant — same five names as Claude (PascalCase) since we picked VS Code-compat.
- New `resolveCopilotScope({ scope, cwd })` returning `{ scope, file, projectRoot }`.
- New `resolveCopilotHookCommand({ packageRoot, version })` — same logic as `resolveHookCommand` but appends `--source=copilot` to the embedded command.
- Update `resolveHookCommand` to append `--source=claude`.
- Update `install({ target, ... })` to dispatch by target, returning `{ claude?, copilot? }` results.
- Update `uninstall` symmetrically.
- Update `audit` symmetrically.
- `.gitignore` entry handling: when writing local Copilot hook, ensure `.github/hooks/agent-viz.local.json` is in `.gitignore` (same logic as `.claude/settings.local.json`).

Copilot hook file content shape:
```json
{
  "version": 1,
  "hooks": {
    "SessionStart": [{ "type": "command", "bash": "node \"...\" hook --source=copilot", "powershell": "node \"...\" hook --source=copilot", "timeoutSec": 5 }],
    "UserPromptSubmit": [...],
    "PreToolUse": [...],
    "PostToolUse": [...],
    "Stop": [...]
  }
}
```
The `bash` and `powershell` fields receive the **same** node command — node is cross-platform and the file path is normalized with forward slashes. `timeoutSec: 5` (matches Claude's `timeout: 5`).

### `lib/hook.js`

- Parse `--source=<agent>` from `process.argv`. Default to `claude` if absent (back-compat).
- Change directory: `path.join(os.tmpdir(), 'agent-events')` (was `claude-events`).
- Stamp `evt._source = source` before write.
- All other logic unchanged.

### `lib/server.js`

- Read events from BOTH `${tmpdir}/agent-events/` (primary) and `${tmpdir}/claude-events/` (legacy fallback).
- For events from legacy dir without `_source`, default to `claude`.
- Session metadata exposes `agentSource: "claude" | "copilot"` taken from the **first** event's `_source` field (sessions are per-agent — `session_id` doesn't collide cross-agent in practice).
- Sessions API (`GET /sessions`) includes `agentSource` field.
- Purge / compact logic applies to both dirs.

### `lib/lifecycle.js` / `bin/agent-viz.js`

- New CLI flag `--target=<claude|copilot|both>` for `install-hooks`, `uninstall-hooks`, `--check`.
- Auto-detection runs when `--target` not specified.
- `install-hooks --check` output formatted per-agent:
  ```
  Claude Code:
    settings : ~/.claude/settings.json  (scope: user)
    [x] UserPromptSubmit
    ...
  Copilot CLI:
    settings : ~/.copilot/hooks/agent-viz.json  (scope: user)
    [x] UserPromptSubmit
    ...
  ```

### `lib/preuninstall.js`

- Extend cleanup to also remove Copilot hook files from all known scopes.
- Atomic file deletion (no JSON merging needed for Copilot).

### `index.html` + `public/viz-network.js` + `public/viz-ui.js`

- New `.agent-badge` CSS pill (small, 9-10px font, rounded, colored per source).
- `viz-network.js`: when rendering session cards, inject badge from `s.agentSource`.
- `viz-network.js`: when active session changes (including in "Latest (auto)" mode where the followed session can switch to a different agent), update topbar badge `<span id="topbar-agent">`. Hide the badge when no session is active.
- `index.html`: add `<span id="topbar-agent" class="agent-badge"></span>` next to `.logo`.

### `package.json`

- Bump version to `0.2.0`.
- Update `description` to "Real-time visualizer for Claude Code and GitHub Copilot CLI sessions."

### `README.md`

- Update intro to mention both agents.
- New section: "Multi-agent support" explaining Copilot CLI and the badge.
- Update install path table.
- Mention `--target` flag.
- Note about `--source` tagging in `.claude/settings.json` and `.github/hooks/agent-viz.json`.

## Testing strategy

Manual smoke test (the user explicitly asked for hands-on testing):

1. Install fresh: `npm install -g agent-viz` → `agent-viz` (no hooks pre-existing).
   - Expected: hooks installed for Claude (and Copilot if `copilot` is in PATH or `~/.copilot/` exists).
2. Run Claude Code → events appear with cyan badge.
3. Run Copilot CLI in another terminal → events appear with violet badge in the same dashboard.
4. Switch sessions in the overlay → topbar badge updates.
5. `agent-viz install-hooks --check` → both agents reported.
6. `agent-viz uninstall-hooks` → all hook entries / files removed.
7. `npm uninstall -g agent-viz` → preuninstall cleans both Claude settings AND Copilot hook files.

Unit-test gaps (existing project has no tests; we don't add a test framework as part of this change). The install-hooks module already has internal helpers exposed for future testing — we keep that pattern.

## Backwards compatibility

- Existing `claude-events/` JSONL files keep working (server reads both dirs).
- Existing Claude hook commands without `--source` arg keep working (default to `claude`).
- Existing `agent-viz install-hooks` (no flag) behaves the same as before for Claude-only setups (auto-detects, finds Claude, installs).
- `npm uninstall` cleanup is backward-extending: removes the new Copilot files in addition to the existing Claude cleanup.

## Out of scope (future work)

- Render Copilot-only events (`ErrorOccurred`, `PreCompact`, `SubagentStart/Stop`, `Notification`, `PermissionRequest`) with proper UI treatment.
- Validate `.claude/settings.json` `hooks` key as a Copilot config target (would unify config files but undocumented).
- Color tinting of canvas nodes by source.
- Per-source stats card in topbar.
- A formal test framework.

## Open risks

- **R1.** Copilot's PascalCase → VS Code-compat payload mapping is documented but not empirically verified by us. Mitigation: smoke test on day 1; fallback is normalization layer (~30 lines).
- **R2.** Session ID uniqueness across agents: very unlikely collision (UUID-shaped on both sides), but if it happens, latest event wins in JSONL append. Acceptable.
- **R3.** A user who runs `agent-viz` in a project where someone else already committed a `.github/hooks/agent-viz.json` will get a "noop" install for Copilot project scope — correct behavior, matches Claude's idempotent install.
