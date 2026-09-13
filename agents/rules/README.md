---
authority: agent-methodology
---

# Agent Rules (Modular Project Instructions)

Canonical source: `agents/rules/`. Grok loads **core tier only** via `.grok/rules/` (see `scripts/sync-harness-agent-files.sh`). Claude/Cursor receive all rules.

## Layering — baseline first, harness needs on top

Operator direction, 2026-09-10: *"we can have baseline agentic config that applies to all, then
layer on top of that harness specific needs."*

| tier | where | what belongs there |
|---|---|---|
| **baseline** (all harnesses) | `AGENTS.md`, `agents/rules/**`, `.agents/skills/**` | the operating contract, guardrails, Q-gates, delegation protocol — anything true of every agent in this repo |
| **harness layer** | `CLAUDE.md`, `.grok/**`, `.codex/**`, `.cursor/**`, `.claude/skills/**` | one harness's own voice, tooling, hooks, model routing, capability workarounds |

A rule reaching only one harness is **not** evidence it should be promoted. Check first whether the
other harnesses already solve that need their own way: prose style is Claude's
(`CLAUDE.md` + skill `operator-prose`), and Grok's equivalent is
`.grok/personas/terse-bluf.toml` mirroring `WORKER_TONE_DIRECTIVE`. Promoting Claude's into the
core tier on 2026-09-10 gave Grok a second, conflicting voice contract; it was reverted the same
day.

Promote only when the need is genuinely shared **and** no harness already has its own answer.

## Grok core tier (every session)

Measured 2026-09-13: `.grok/rules/` holds exactly these SIX symlinks, and
`scripts/sync-harness-agent-files.sh:12-19` (`CORE_RULES`) is the source of truth. This list
previously named ten; four of them were never linked, and that was correct rather than an oversight.

- `LEX_AGENTIC.md` — authoritative glossary + orchestrator protocol
- `GUARD_BLUEPRINT.md` — protected files + Q1/Q4/Q5 gate
- `GUARD_DRIFT.md` — anti-toil + model-work guard
- `MANDATE_VISIBILITY.md` — sizable collaborative vertical slices + noticeability
- `PROTO_SUBAGENT.md` — coordinator-first delegation
- `EXEC_AUTONOMY.md` — platform override, stop conditions, post-slice loop

### Deliberately NOT in the Grok core tier

These are ORCHESTRATOR-facing and reach a dispatched worker only as harm or noise. A worker runs one
carded slice inside its own worktree; it does not dequeue, delegate, verify delegates or scout.
`orchestrator-only-main.md` in particular tells its reader "you are a CEO, not an IC, do not write
product code" — the opposite of a worker's job. Claude and Cursor still receive all rules
(`.claude/rules/`, `.cursor/rules/` link every file), so nothing is lost to the coordinator.

- `PROTO_VERIFY_DELEGATION.md` — trusting what a delegate returns; probes, claims, retros
- `PROTO_CURIOUS_RESEARCHER.md` — standing background scout
- `PROTO_BOARD_LOOP.md` — board → brief → dispatch → contract → integrate gate
- `orchestrator-only-main.md` — main session = CEO / orchestrator only

**If you add a file here, add it to `CORE_RULES` in the sync script too, or this list lies again.**

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