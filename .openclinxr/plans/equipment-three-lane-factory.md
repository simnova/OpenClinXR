# Plan — Equipment three-lane factory (14 blueprints)

**Status:** IN MOTION  
**Date:** 2026-08-12  
**MADRs:** 0054 (lanes), 0055 (catalogue)  
**Q-gates:** Q1 (case/prose → resolved equipment → runtime), Q5 (validate + inventory)  
**claimScope:** factory routing + catalogue + structure validation for scenario-bank equipment.  
**notEvidenceFor:** clinical accuracy, Quest readiness, photoreal match.

## Goal

Put the three-lane doctrine into an **OpenClaw-style loop** that covers all scenario-bank blueprints
(14 scenarios, ~37 equipment ids, ~68 prose labels) with inventory, validation, gap fill, and
optional OSS bank candidates — without requiring LLM geometry authoring.

## Horizon (iterations)

| Iter | Name | Done when |
|------|------|-----------|
| **0** | Spine | MADRs landed; catalogue schema + inventory CLI; validate runs; all builder ids have a provisional lane |
| **1** | Blueprint map | Every scenario lists resolved equipmentIds; unmapped prose enumerated with recommended id |
| **2** | Bank hygiene | Every `REAL_EQUIPMENT_GLTF_BY_ID` file exists + provenance note; missing GLBs flagged |
| **3** | Lane 1 fills | Prioritized bank targets (bed/stretcher/monitor gaps) — promote or stage OSS only if licence green |
| **4** | Lane 2 harden | Thin parametric families: structure checklist smoke for top deck surfaces |
| **5** | Lane 3 ECG | Integrate Approach B kit from worktree as modular_kit for `12_lead_ecg_machine_equipment` only |
| **6** | Pack grade | Multi-view harness for top 5 learner-visible props |
| **7+** | Multi-case dark run | `dark-factory-multi-case` style pass: all 14 scenarios resolve equipment without fallback |

## OpenClaw loop (each tick)

```
1. pnpm factory:equipment:catalog:inventory
2. pnpm factory:equipment:catalog:validate   # exit 0 or recorded allowlist
3. Read gaps from report (unmapped prose, missing glb, fallback-only)
4. One fill action only:
     - map prose → id, OR
     - assign/correct lane, OR
     - stage OSS candidate (ledger + refuse if unspecified), OR
     - promote GLB, OR
     - kit wire (lane 3 ECG only until more recipes)
5. Re-validate
6. Append checkpoint (PROJECT_STATUS or integration-events)
7. Dequeue next gap (no propose-and-wait)
```

## Priority order for fills (learner-visible first)

1. Stretcher / hospital bed / post-op bed / pediatric stretcher (deck SSOT)
2. Bedside monitor / wall clock (already partial bank)
3. IV pole / IV pump
4. 12-lead ECG (lane 3 kit)
5. Chairs / exam table
6. Screens / trays / small devices

## Stop conditions

- Explicit pause in PROJECT_STATUS
- All scenarios resolve with zero `fallback` and zero unmapped prose
- Or blocked only on licence/operator hardware

## Worktree note

ECG kit lives on `feature/equipment-kit-approach-b` until iter 5 integration. Main catalogue treats
ECG as `thin_parametric` or `modular_kit` provisional based on main tree until merge.

## Iter-5 merge blocker (tick 18, 2026-08-12)

Merge is NOT blind-ready — the branch is stale vs main (predates the 15m loop and its 17 ticks).
Measured conflict surface (merge-tree):

1. **package.json** — branch REPLACES the `factory:equipment:catalog:{inventory,validate,report,loop,status}`
   script family with kit scripts. Merging as-is deletes the catalogue CLI the loop runs on. Rebase
   must keep both (catalogue scripts + new `equipment:kit:*` scripts).
2. **station-equipment-families.ts** — branch removes the shared helpers `equipmentMat` /
   `tagEquipmentRootShared` and the family-union members added by ticks 4-16; my family modules
   import those helpers. Rebase must preserve both the branch's kit wiring AND the helpers/union.
3. 7,393 insertions (27 files) — mostly additive `equipment-kit/` modules + evidence; requires
   typecheck + architecture-fitness + kit tests after rebase.

**Action:** rebase `feature/equipment-kit-approach-b` onto current main, resolve the two conflicts
preserving both sides, verify gates, then merge as a dedicated slice (not inside the 15m tick).
