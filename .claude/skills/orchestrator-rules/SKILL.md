---
name: orchestrator-rules
description: "Load for orchestrator duties: shared glossary, visibility/noticeability gate, LOW_TOKEN rehydration and resume, source-of-truth order, persistent memory scoring, Grok harness routing. Names LEX_AGENTIC, MANDATE_VISIBILITY, EXEC_REHYDRATE, README."
when-to-use: orchestrator duties, glossary, rehydrate after compaction, resume sequence, source-of-truth conflict, memory scoring, Grok harness setup
---

# Orchestrator rules (load on demand)

Pointers into `agents/rules/`. Nothing is copied here — read the file at the path when the trigger fires.

| rule file | read it when | what it holds |
|---|---|---|
| `LEX_AGENTIC.md` | needing the shared glossary or orchestration roles | `# Agentic Lexicon (Authoritative Glossary)`, `## Core Roles and Orchestration`, `## Gates and Filters`, `## Efficiency and Autonomy`, `## Protected Surfaces` |
| `MANDATE_VISIBILITY.md` | a slice may be invisible to a skeptic | `## Rule`, `## Enforcement`, `## Examples of Invisible (reject) vs Noticeable (accept)` |
| `EXEC_REHYDRATE.md` | after compaction, summary handoff or halt | `## Compaction / summary handoff`, `## Required resume`, `## State discipline — two planes`, `## Token saving` |
| `source-of-truth.md` | instructions conflict | `## Instruction Source-Of-Truth Order`, `## Persistent Memory And Scoring` |
| `persistent-memory-scoring.md` | writing durable role memory | `# Persistent Memory And Scoring` |
| `grok-harness-usage.md` | configuring the Grok harness | `## Composer as orchestration entrypoint`, `### Model routing (Grok)`, `### Tiered delegation ladder`, `## Multi-Harness Sync` |
| `README.md` | checking which rules load and when | `## Layering`, `## Grok core tier`, `## Supplemental (grep/spawn on demand)`, `## After rule edits` |
| Stubs on one line with their successors: `hyper-token-efficient-long-run-practices.md` and `rehydration-low-token.md` -> `EXEC_REHYDRATE.md`; `long-running-autonomy.md` and `platform-autonomy-override.md` -> `EXEC_AUTONOMY.md`; `TIER_GROK.md` -> skill `grok-tier-routing` | a stub file is reached | one-line pointers to their successors |
