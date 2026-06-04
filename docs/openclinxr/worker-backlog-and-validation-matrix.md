# Worker Backlog And Validation Matrix

## Current State Snapshot

Current product: blueprint-driven encounter factory for peds_asthma_parent_anxiety_v1 plus ED seed. The active work should move case definitions into generated runtime behavior, review packets, replay/persistence, and reusable asset materialization. UI-XR runtime evidence consumer remains metadata-only, reviewer-gated, and not a learner/Quest/production readiness claim.

Last support checkpoint: 2026-06-04 repo hygiene pruned historical evidence and compacted long-running logs. The worker matrix now keeps live ownership, checkpoints, and validation posture only. Detailed historical rows are in git.

Next action: Worker 11/9 should propagate `pedsHumanoidMaterializationHandoff` into publication/review packet summaries and then make UI-XR prefer worker-fed humanoid metadata before deterministic fallback.

## Efficient Rehydration + Working Model

Read `AGENTS.md`, `PROJECT_COORDINATION_INDEX.md`, `AUTONOMOUS_WORK_PLAN.md`, and this file. Use snapshots-first, focused `rg`, `pnpm openclaw:lease -- status`, small slices, and focused tests. `openclaw-runbook-2026-05-27.md` and `docs:drift-check` are the guardrails. Efficiency Quick Ref: `pnpm agent:alignment`, `pnpm docs:drift-check`, `pnpm openclaw:post-slice`, focused `vitest -t`.

Do not toil on evidence refreshes. Evidence supports product decisions; it is not the product.

## Active Product Advancement Order

| Priority | Workers | Lane | Validation posture |
| --- | --- | --- | --- |
| 1 | Worker 11/9 | Peds humanoid materialization handoff into publication/review/runtime metadata preference | Focused worker, packet, UI-XR tests; false readiness gates |
| 2 | Worker 9/7/11 | UI-XR runtime evidence consumer plus Admin/GraphQL/API review/replay summaries | Metadata-only payloads, raw hidden, reviewer decision gates |
| 3 | Worker 7/8/9 | Worker 7 plus Worker 8 completed-station faculty review path | Local deterministic smoke, faculty/admin review surface tests |
| 4 | Worker 11 | Clinical Asset Commons reuse for humanoids/equipment/floors/nurses | Sidecar provenance, materialization gates, MADR linkage |
| 5 | Worker 10/support | Local exam and model/voice harnesses | Test/data boundary only; no runtime manifest pollution |

## Recent Checkpoints

2026-06-04 repo hygiene (Worker 0 support): deleted historical generated evidence and stale docs, replaced old benchmark-dependent Pages tests with temporary fixtures, redirected worktree cleanup output to `.agent-factory`, regenerated registries/indexes, and compacted long logs into checkpoint summaries. Next: product pivot remains peds humanoid handoff propagation.

2026-06-04 architecture/arena (Worker 0 support): production apps/packages, Capability Arena cage matches, Clinical Asset Commons, and support/governance packages are visually and architecturally separated. Arena READMEs link to MADRs and promotion gates.

2026-06-04 humanoid provenance (Worker 11/9): peds humanoid GLBs are Anny-compatible stub + Blender procedural B candidates with sidecar provenance and blocked overclaims. Next: carry the handoff into review/runtime surfaces.

2026-06-04 hooks/public alignment (Worker 0/7/9/11 support): hook runner, local exam smoke, Pages validation, and public copy now reinforce production/factory/asset-commons/arena/local/connected/Azure boundaries.

## Validation Rules

Required Per-Slice Record: Product path advanced, Blueprint/factory tie, Touched files, Evidence, Next queued slice.

When touching coordination files, run `pnpm agent:alignment && pnpm docs:drift-check`. For code, run focused tests for touched packages before broader gates. Historical evidence and log files should be pruned unless they are current evidence, reusable templates, runtime assets, or explicit compatibility inputs.
