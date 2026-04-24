# Token counters on session & agent nodes — design

Status: approved, ready for plan
Date: 2026-04-24

## Goal

Display live token usage on each session and agent node in the viz, with full breakdown (input / output / cache read / cache creation) in the detail popup.

## Scope

- In scope: tokens per session (main thread) + per agent (subagent). Display on the canvas node and in the detail popup. Live updates.
- Out of scope: per-tool tokens (technically impossible — usage is per message, not per tool_use block), $ cost conversion, temporal graphs, per-model breakdown.

## Data sources (verified against real files)

Two hook-event patterns in `%TEMP%/claude-events/<session>.jsonl` and two transcript patterns in `~/.claude/projects/<slug>/<session>.jsonl` were inspected. Findings:

| Source | Main thread | Subagent |
|---|---|---|
| Hook events | Not present. `Stop` carries `last_assistant_message` but no `usage`. | `PostToolUse` on `tool_name: "Agent"` carries `tool_response.usage` + `totalTokens` (cumulative final value). |
| Transcript | `{"isSidechain":false,"type":"assistant","message":{...,"usage":{...}}}` (one entry per assistant message) | `{"type":"progress","data":{"type":"agent_progress","agentId":"<aid>","data":{"message":{...,"usage":{...}}}}}` (streamed per message) |

`usage` object shape: `{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`.

## Strategy — Z3 (transcript live + hook reconciliation)

- Parse transcript incrementally for both main-thread and subagent tokens → live updates during long-running turns.
- When `PostToolUse(Agent)` arrives with `tool_response.usage`, overwrite the subagent's accumulated value with this authoritative total. Protects against transcript gaps / missed lines.

## Architecture

### Server (`server.js`)

Extend `sessionIndex[id]` with:

```js
{
  tokens: {
    main: { in: 0, out: 0, cacheCreate: 0, cacheRead: 0 },
    perAgent: Map<agentId, { in, out, cacheCreate, cacheRead }>
  },
  transcriptWatcher: fs.FSWatcher | null,
  transcriptOffset: number,
}
```

Transcript watcher setup:
- Factor out `getTranscriptPath()` (already exists, used by `ensureFirstPrompt`).
- When opening a session jsonl watcher, also open a transcript watcher as soon as `transcript_path` is known (first hook event in the file).
- Append-only reading identical to `readAndBroadcast` (offset + debounce 50 ms).

Per-line parsing:
- Main thread detection: `evt.isSidechain === false && evt.type === 'assistant' && evt.message?.usage` → accumulate into `tokens.main`.
- Subagent progress detection: `evt.type === 'progress' && evt.data?.type === 'agent_progress' && evt.data?.agentId && evt.data?.data?.message?.usage` → accumulate into `tokens.perAgent[agentId]`.

Hook-event reconciliation (in existing `readAndBroadcast`):
- On `evt.hook_event_name === 'PostToolUse' && evt.tool_name === 'Agent' && evt.tool_response?.usage` → overwrite `tokens.perAgent[evt.tool_response.agentId]` with the provided `usage`.

Broadcast:
- New SSE message type: `{type:"tokens", session:<sid>, main:{...}, perAgent:{agentId:{...}, ...}}`.
- Throttled to one broadcast per session per 250 ms (debounced timer).

GC:
- `deleteSession` closes `transcriptWatcher` and clears tokens state alongside its existing cleanup.

### Client (`public/viz-*.js`)

`viz-state.js`:
- Add `state.tokens = { main: null, perAgent: new Map() }`.
- `clearState()` resets it.

`viz-network.js`:
- SSE handler for `data.type === 'tokens'` → replace `state.tokens.main` and merge `state.tokens.perAgent`. `markDirty()`.

`viz-canvas.js`:
- In the draw pass for session and agent nodes, below the existing `sub` label, render a compact token count (`formatTokens(total)`) in `text-muted` color.
- Session node total = `main.(in+out+cacheCreate+cacheRead) + Σ perAgent`.
- Agent node total = `perAgent[agentId].(in+out+cacheCreate+cacheRead)`.
- `formatTokens(n)` → `"850"` / `"12.4k"` / `"1.3M"`. Lives in `viz-state.js` with the other helpers.

`viz-ui.js`:
- In `showDetail()` for types `session` and `agent`, add 4 `.meta-card` entries: Input, Output, Cache read, Cache creation. Values passed through `formatTokens`.

## Edge cases

- Transcript not yet discovered (first hook event not seen): tracker is no-op until `transcript_path` lands. No tokens shown until then.
- Transcript compacted by Claude Code externally: not in scope. If the transcript file is truncated/rotated we stop receiving updates for that session, which is acceptable — reconciliation via `PostToolUse(Agent)` still delivers the final subagent totals.
- Session jsonl compacted by this server (`compactSession`): independent of transcript, no impact.
- Missing `agent_id` on `SubagentStart` (already handled elsewhere with fallback to `sid`): subagent tokens may accumulate under the session node instead. Acceptable.
- Session cleared from the UI: `clearState()` resets `state.tokens`. The server keeps accumulating; the next SSE `tokens` frame will restore the counters.

## Non-goals

- Dollar cost. Pricing varies by model and tier; intentionally excluded.
- Per-tool attribution. Tokens are per message; multiple tool_use blocks in one message share the same usage block.
- Historical / time-series view of tokens. Only the current running total is kept.
- Per-model split. A session can mix Opus and Haiku; we sum them.

## Verification plan

- Manual: run a session that spawns ≥ 1 subagent, watch tokens tick up on both the session node and the agent node during the subagent's work.
- Sanity: sum of per-agent totals + main should be close to the grand total of the session (exact match not guaranteed — main thread messages emitted while subagents are running are counted separately; expected).
- Reconciliation: kill the server mid-subagent, restart — the subagent's `PostToolUse(Agent)` event (already persisted to hook jsonl) should reconcile the total on replay.
