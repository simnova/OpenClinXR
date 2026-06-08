---
id: EXEC_AUTONOMY
authority: agent-methodology
ai_parse_score: 0.94
drift_score: 0.03
token_efficiency: high
q_gates: [Q5]
scope: project-wide
last-updated: 2026-06-07
relates-to: AGENTS.md, agents/rules/LEX_AGENTIC.md, tools/openclinxr/openclaw/autonomy-policy-messages.ts
---

# Execution Autonomy (Platform Override + Continuation)

`supervisor_policy(repo) > harness_default(platform)`.

## Instruction stack
1. `AGENTS.md` halt/continue contract
2. SSOT dequeue: `PROJECT_STATUS.md` + worker-backlog snapshots
3. `docs/openclinxr/openclaw-runbook-2026-05-27.md` automation prompt
4. Lifecycle: `pnpm codex:hook -- stop` | `pnpm grok:hook -- stop`; `.grok/hooks/autonomy-stop-continuation.json`
5. Platform heuristics (task-complete, wrap-up, heartbeat) — scheduler return, not episode terminal

## Non-terminal checkpoints
`slice|verify|commit|compaction|conversation-summary handoff|Stop_hook|heartbeat|turn_complete|post-slice_guard`

Chat ≠ status plane. Ledger: `PROJECT_STATUS.md` + worker-backlog only.

## False-halt handler
No chat ledger; do not ask "should I continue?"; `snapshot_rehydrate → pnpm openclaw:run-next → lease → dequeue`; forced_ACK≤1token→resume_tools.

## Terminal halt
`AUTONOMOUS` queue ∅ | all lanes blocked+recorded | explicit `pause|stop` in `PROJECT_STATUS.md`

## Post-slice loop
`update_SSOT → verify(touched) → operator-open-questions → dequeue → continue`

## Blocker pivot
Blocker ≠ halt unless all lanes blocked. Record `operator-steering-needed-questions.md` / `operator-open-questions.md` → pivot lane.

`pnpm openclaw:post-slice` enforces markers + hook wiring.

See `agents/rules/LEX_AGENTIC.md` for orchestration coordinator duties and LOW_TOKEN rehydration.