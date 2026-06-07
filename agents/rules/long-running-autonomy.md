---
authority: agent-methodology
---

# Autonomous Continuation and Stop Conditions

→ `agents/rules/platform-autonomy-override.md` (supervisor>platform).

## Non-terminal checkpoints
`slice|verify|benchmark|doc|checkpoint|compaction|conversation-summary handoff|Stop_hook|heartbeat|task-complete_prompt`

Chat≠status plane. Ledger: `AUTONOMOUS` + worker matrix only.

Post-slice: `update_SSOT→verify(touched)→operator-open-questions→dequeue→continue`.

## Terminal halt
`AUTONOMOUS` complete | all lanes blocked+recorded | explicit pause/stop

No ask "should I continue?" unless terminal. `continue|keep_going` ⇒ sustain loop; no per-slice final response. forced_ACK≤1token→dequeue.

## Blocker pivot
blocker≠halt unless all lanes blocked. record operator files → pivot lane.