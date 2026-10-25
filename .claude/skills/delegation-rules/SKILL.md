---
name: delegation-rules
description: "Load before dispatching or briefing a worker, verifying a delegate's report, running the board loop, spawning subagents or a scout. Names PROTO_VERIFY_DELEGATION, PROTO_BOARD_LOOP, PROTO_SUBAGENT, agent-consult, orchestrator-only-main."
when-to-use: dispatch a worker, write a brief, verify a delegate report, run the board loop, spawn a subagent, start a scout, am I allowed to write product code, worktree per lane, standing approval, prior art first, compute first
---

# Delegation rules (load on demand)

Pointers into `agents/rules/`. Nothing is copied here — read the file at the path when the trigger fires.

| rule file | read it when | what it holds |
|---|---|---|
| `PROTO_VERIFY_DELEGATION.md` | before a dispatch and after any delegate reports | `# OPERATOR DIRECTIVES`, `## 1. Never trust the report — verify against the tree`, `## 3. Every new rule needs a destructive probe`, `## 6. Retrospect after landing, not during`, `## Dispatch facts that cost real time` |
| `PROTO_BOARD_LOOP.md` | running board → brief → dispatch → integrate | `## The shape`, `## An issue is not dispatchable until someone decides what would prove it done`, `### One closed, one opened`, `## Two lanes per cycle`, `## Commit the RED before the issue exists` |
| `PROTO_SUBAGENT.md` | spawning any subagent | `## Core Rule`, `## When to Use Subagents`, `## Sub-Agent Work Order Template`, `## Best Practices` |
| `PROTO_CURIOUS_RESEARCHER.md` | a standing scout turn | `## The rule`, `## What to do with the results`, `## Cadence` |
| `agent-consult.md` | consulting a repo agent or the Grok composer | `## Steps (LOW_TOKEN)`, `## When to Consult (Mandatory)`, `## Memory Injection`, `## Memory Write-Back` |
| `repo-defined-agents-worker-roles.md` | mapping a role to a worker | `# Repo-Defined Agents And Worker Roles` |
| `orchestrator-only-main.md` | a main session is tempted to write product code | `## Law`, `## Self-test`, `## Escape hatch` |
| `GUARD_WORKTREE_PER_LANE.md` | before touching a second checkout, pushing toward main, or staging a binary | `## Rule`, `## Commit-time large-file guard` |
| `GUARD_STANDING_APPROVAL.md` | before a reversible move, a conflict resolution, or a timeout default | `## 1. Pre-approved moves (do them, then log)`, `## 2. Still needs Patrick live (no timeout default, ever)`, `## 3. Log every policy move` |
| `PROTO_PRIOR_ART_COMPUTE_FIRST.md` | before writing a new card or tuning numeric gates | `# Prior art and compute first`, `## How the card proceeds`, `## Guardrails`, `## Appendix: Compute-first candidates (survey, 2026-10-19)` |
