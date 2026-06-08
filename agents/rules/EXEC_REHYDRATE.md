---
id: EXEC_REHYDRATE
authority: agent-methodology
ai_parse_score: 0.93
drift_score: 0.03
token_efficiency: high
q_gates: [Q5]
scope: project-wide
last-updated: 2026-06-07
relates-to: AGENTS.md, PROJECT_STATUS.md, agents/rules/LEX_AGENTIC.md
---

# Execution Rehydration (LOW_TOKEN + Long-Run)

See `agents/rules/LEX_AGENTIC.md` for authoritative LOW_TOKEN definition.

## Compaction / summary handoff
`KV_eviction|summary_handoff` → cold-start rehydrate only (`EXEC_AUTONOMY.md`).

## Required resume (session|compaction|handoff|pre-halt)
1. `AGENTS.md` top + BLUF
2. `PROJECT_STATUS.md` first ~60–80 lines
3. Active slice `.openclinxr/slices/<id>/brief.json` if in flight
4. Worker-backlog snapshot header + ownership matrix only
5. Full `LEX_AGENTIC.md` for orchestrator forest view

History: `tail -50 PROJECT_STATUS.md | grep` — never full ledger reads.

## Commands
- Cheap guards: `pnpm agent:alignment` then `pnpm docs:drift-check`
- Preflight: `pnpm openclaw:preflight` (alignment + drift + lease status)
- Lease: `pnpm openclaw:lease -- acquire --owner <role> --slice <id> --ttl-minutes 60`
- Post-slice: `pnpm openclaw:post-slice`
- Scheduler: `pnpm openclaw:automation-prompt` for unattended loops

## State discipline
Durable state ONLY in `PROJECT_STATUS.md` + worker-backlog + registered artifacts + `agents/**` memory. Never chat-only ledgers.

## Token saving
- Parallel tool calls for independent reads/greps
- `read_file` with `offset`+`limit`; prefer `grep` over broad reads
- Focused tests: `pnpm --filter <pkg> test -- -t "<substring>"`
- No chat summaries; status in canonical MDs only

## Anti-interruption
Slices <1h ideal; immediate next after record+verify. Coordinator-first subagents; narrow non-overlapping write scopes.

## Drift guard
Never 2+ evidence-only without coordinator+drift-police review + product pivot. Consult `agents/adversarial/openclaw-drift-police/` on sprawl suspicion.

M1 Max 64 GB primary; UI-XR runtime evidence consumer posture per worker matrix.