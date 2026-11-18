# 0064 — Retire the ambient-fail gate (refuse a dispatch whose planted contract is already green on main)

- Status: **retired, not enforced**
- Date: 2026-11-18
- Deciders: operator (direction 2026-11-18: "for things that are deleted - if they are valuable decisions MADRs can capture them"); orchestration review #2 (2026-08-08), which set the rule; coordinator super-ceo-cap41 (deletion ruling 2026-11-18)
- Deleted file: `tools/openclinxr/openclaw/ambient-fail-gate.ts` (3,547 B, added in 784adb939 2026-08-08, deleted by the aisha-parity lane for the render-parity thinning offset)

## Context

Orchestration review #2 (2026-08-08) traced three orchestrator errors to one class, the predicate-subject mismatch: the assertion is well formed, but the thing it is evaluated over is not the defect.

- population: #196's RED filtered all 14 environments, where a difference is guaranteed, instead of the width sweep of one, and went green while the defect was present.
- lifecycle: integrate's rebuild measured `base...head` after the merge, when it is empty.
- policy: #198 ("at least 12 must stay fallback") and #202 ("none may be fallback") asserted opposite values of the same ledger field with no supersession line.

The review said another rules section would not bind, because the rules already described both cases: "What failed is RED UNDER THE FILTER THAT SHIPS, not RED under a hand-tuned population."

## Decision (2026-08-08)

Before dispatch, run the planted contract exactly as the worker will, against main as it stands, and refuse if it passes. `ambient-fail-gate.ts <test-file>` ran `pnpm exec vitest run <test-file>` with `CI=1` and exited 0 when the contract failed on main (safe to dispatch), 1 when every contract in the file passed (vacuous plant, refuse), 2 on usage error.

## Status on 2026-11-18

The gate was never wired. At 48f63f3d5, `git grep -F ambient-fail-gate` finds only the file, its entry in `tools/openclinxr/openclaw/tools-cruft-baseline.json`, and the review-#2 sentence at `PROJECT_STATUS.md:304`, which records the past build. No dispatcher, board brief, hook or `done_when` rule calls it, and no test covers it.

No other mechanism on origin/main checks that a plant is red on main before dispatch. The nearest checks are later and narrower:

| mechanism | path | what it proves | what it does not |
|---|---|---|---|
| `live:` rule | `packages/openclinxr/agent-loop/src/done-when-rules.ts:386` | the slice that owns a plant removed its `it.fails` markers | that the plant was red before work started |
| `assert-contract-live.ts` | `tools/openclinxr/openclaw/assert-contract-live.ts` | named titles are live `it(`, not `it.fails(` | the same |
| `measured-before:` rule | `packages/openclinxr/agent-loop/src/done-when-rules.ts:310` | an artifact was written before the product edit | anything about the contract's verdict on main |
| contract-design skill | `.claude/skills/contract-design/SKILL.md` ("The RED - fails today, for the real defect") | the rule as prose for Claude briefs | enforcement |

The rule is therefore retired: it holds only as prose in the contract-design skill. Reinstating it means restoring the file from 784adb939 and wiring it into the dispatch path (board-brief or the dispatcher) so that a vacuous plant refuses the card, with a test that plants a contract green on main and expects the refusal.
