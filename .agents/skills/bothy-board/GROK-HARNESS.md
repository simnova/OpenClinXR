# BothyBoard — Grok harness addendum

Read this when the parent is Grok Build / Grok CLI. The core
[SKILL.md](SKILL.md) remains the protocol. This file is the **wake and
routing** contract so a later session cannot fall back to chat lore.

## Wake: native `monitor`, not Stop-hook

Grok's `monitor` tool is first-class (`~/.grok/docs/user-guide/20-background-tasks.md`).
Each stdout line is a session notification. Silence costs zero tokens. Exit
ends the watch. `persistent: true` lasts the session.

**Do not** wake Bothy mail with:

- Grok Stop `{decision:block}` stuffing a MAILBOX digest into the block reason
  (full rehydrate every turn; 8-blocks/turn cap; idle still burns Grok)
- `/loop` or `scheduler_create` (those start a **new agent turn** on a timer)
- in-session `mailbox.poll` loops while the parent is idle

Arm once per session:

```
monitor(
  command = "pnpm openclaw:mailbox:monitor",
  description = "Bothy mailbox foreign-comment wake",
  persistent = true
)
```

The command must print **only** `DONE`, `FAILED`, or `CANCELLED`. `DONE` means
new foreign comment ids appeared after the seed tick. `FAILED` means a
**permanent** fault (missing `BOTHY_BOARD_PAT`, HTTP 401/403). Kill with
`kill_command_or_subagent`.

## Poll mechanics (measured 2026-08-29)

- Consume `result.structuredContent`. Do not reparse `content[0].text`.
- Pass `since` (ISO-8601, newest successfully observed `createdAt` per task).
  Measured: 339,390 B → 308 B on the coordination card.
- Pass `cacheToken` on every `bothy-board.sync`. Unchanged board returns
  `{"unchanged":true,"cacheToken":"bb-r<rev>-<hash>"}` only (310,977 B → 248 B).
- JSON-RPC batching is unsupported (`-32601`). Poll known `tsk_` ids one at a time.
- `sync` ignores `projectId`. Never infer absence from an unscoped sync.
- `authorName` is often `member` for every agent. Filter self by body marker
  `[grok-orchestrator:<session>]` plus seen comment ids — not by authorName alone.

## Failures

| class | examples | action |
|---|---|---|
| permanent | missing PAT, HTTP 401/403, invalid token | print `FAILED` and exit |
| transient | `fetch failed`, timeout, 5xx, ECONNRESET | back off, cap 8× 45s, **keep running** |

Abort-after-N-transient-failures is forbidden. Measured: a 7.5 min network blip
plus exit-on-10 made a healthy board a permanent blind watcher.

## After `DONE`

1. `mailbox.poll` the watch list (`tools/openclinxr/openclaw/mailbox-watch.json`, cap 8).
2. Answer, claim, or dequeue. Do **not** run `openclaw:run-next` merely because a turn ended.
3. `spawn_subagent` / `dispatch()` **must pass `model:`**. Omit inherits parent grok-4.6.
   - text: `deepseek-v4-flash` (+ `modelDowngradeReason: "budget constraints"` on write `dispatch()`)
   - worker must **read** an image: `deepseek-v4-flash-vision-exp` only
   - grok-4.6: measured flash failure or `UNABLE:` only
4. Pixel grades stay on the parent. Vision-exp is for the worker that must see pixels.

## Register

`worktrees.register` + `agents.heartbeat` are presence. They do **not** re-claim.
A `review` card with leftover `assigneeAgentId` still occupies write-roots; TTL
does not drop it. Do not paper that over with a Stop-hook loop.

`sessions.bind` requires a claim. Orchestrator-on-dialog-only is `bind_without_claim` — expected.

## Mailbox posts

`mailbox.post` `{ authorName: "grok-orchestrator", grokSessionId }` and put
`[grok-orchestrator:<session>]` in the body so later polls can filter self-echo.
