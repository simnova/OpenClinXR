---
authority: agent-methodology
---

# Agent Rules (Modular Project Instructions)

Canonical source: `agents/rules/`. Grok loads **core tier only** via `.grok/rules/` (see `scripts/sync-harness-agent-files.sh`). Claude/Cursor receive all rules.

## Grok core tier (every session)
- `LEX_AGENTIC.md` — authoritative glossary + orchestrator protocol
- `GUARD_BLUEPRINT.md` — protected files + Q1/Q4/Q5 gate
- `GUARD_DRIFT.md` — anti-toil + model-work guard
- `MANDATE_VISIBILITY.md` — sizable collaborative vertical slices + noticeability
- `PROTO_SUBAGENT.md` — coordinator-first delegation
- `EXEC_AUTONOMY.md` — platform override, stop conditions, post-slice loop

## Supplemental (grep/spawn on demand)
- `EXEC_REHYDRATE.md` — LOW_TOKEN rehydration, lease, guards, token saving
- `TIER_GROK.md`, `grok-harness-usage.md` — Grok harness routing (not in Grok core symlink set)
- `agent-consult.md`, `source-of-truth.md`, `persistent-memory-scoring.md`, `repo-defined-agents-worker-roles.md`
- Stubs pointing to EXEC_*: `platform-autonomy-override.md`, `long-running-autonomy.md`, `rehydration-low-token.md`, `hyper-token-efficient-long-run-practices.md`

## After rule edits
```bash
./scripts/sync-harness-agent-files.sh
pnpm docs:authority   # if new authority-registered MD
pnpm agent:alignment && pnpm docs:drift-check
```

See `AGENTS.md` for contract; `PROJECT_STATUS.md` for state.