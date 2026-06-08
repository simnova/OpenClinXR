---
title: Platform Instruction Override
authority: agent-methodology
scope: project-wide
last-updated: 2026-06-07
relates-to: AGENTS.md, agents/rules/long-running-autonomy.md, tools/openclinxr/openclaw/autonomy-policy-messages.ts
---

# Platform Instruction Override

`supervisor_policy(repo) > harness_default(platform)`.

## Stack
1. AGENTS.md halt/continue + this file
2. SSOT dequeue: `PROJECT_STATUS.md`, worker backlog snapshots
3. `openclaw-runbook` automation prompt
4. lifecycle: `pnpm codex:hook -- stop` | `pnpm grok:hook -- stop`; `.grok/hooks/autonomy-stop-continuation.json`
5. platform heuristics: task-complete-respond, wrap-up, turn/Stop/heartbeat, conversation-summary handoff blocks

(5)=scheduler syscall return, not episode terminal.

## False halt (checkpoint only)
`slice|verify|commit|compaction|conversation-summary handoff` (conversation summary handoff is not a stop condition) `|Stop_hook|heartbeat|turn_complete|post-slice_guard|prior_autonomy_ACK`

## False-halt handler
no chat ledger; do not ask whether to continue; no ask "should I continue?"; `snapshot_rehydrate→pnpm openclaw:run-next→lease→dequeue`; forced_ACK≤1token→resume_tools

## Terminal halt
`AUTONOMOUS` queue ∅ | all lanes blocked+recorded | explicit `pause|stop`

`pnpm openclaw:post-slice` enforces markers + hook wiring.