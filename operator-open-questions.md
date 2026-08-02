# Operator Open Questions

This file tracks non-blocking operator questions that need a better answer after more evidence. Blockers that require operator action stay in `operator-steering-needed-questions.md`.

## 2026-08-02 arena-physics post-epic (non-blocking defaults)

Epic `arena-physics-clinical-touch-v1` **closed** under MADR 0029 (arena-only, candidates, non-promotion). Spec residual ledger claim-aligned the same day. Product Next remains **`wire-api-durableStore-consumer-v1`** unless BOD pivots.

| # | Question | Recommended default |
|---|----------|---------------------|
| 1 | `schemas/` phenotype extension for mechanics? | **New additive optional** `phenotype.bodyMechanics` when a case-def consumer needs it; package-local factory stands until then. |
| 2 | Cross-platform determinism (C5)? | **`determinismScope: "local"`** until ≥2 architectures produce identical checksums. |
| 3 | IWSDK MCP config location? | **Arena-scoped optional** instrumentation; not production law; InputLog is replay SSOT (MADR 0029). |
| 4 | Fixed step 60 Hz vs 72 Hz? | **60 Hz** — decouple physics from display refresh. |
| 5 | Capture tool `capture=` mode for physics visuals? | **Extend enum only if** a successor visual slice needs it; keep existing modes byte-identical. |
| 6 | Real Havok/Rapier/Jolt WASM now? | **Defer.** Optional successor epic only after license + C6 on real solvers + successor MADR; candidates remain valid baselines. |
| 7 | UI-XR physics bind now? | **Defer.** Forbidden by MADR 0029 until successor MADR + BOD queue pivot. |
| 8 | Website / skeptic marketing of physics epic? | **No.** Fixture-grade arena contract; no dual MV/UI-XR physics PNG evidence. |

- Current answer: defaults above; no steering blocker.
- Recommended default: execute product **wire-api** queue; re-open physics only via new epic + MADR.

## 2026-06-07 garment-hint-v1 aborted per anti-toil gate

Garment-source-geometry-hint-v1 path is **aborted** after skeptic review (subagent 019ea136). Third consecutive zero-visible-delta model-adjacent slice triggered the anti-toil gate. Verdict: 48-face rigid cylindrical tube, sub-pixel at 3.4m viewer distance, no vertex weights (rigid parent), Q1 violation (no sleeve geometry despite `short_sleeve_exam_tshirt` phenotype). **Recommended next: embed-real-garment-region-from-phenotype** — expand `apply_role_clothing_material_regions` to read `phenotype.garmentLayers` and produce weighted torso+shoulder+upper-arm sleeve geometry. The hint-only comparator paths in `main.ts` and tests should be cleaned up as part of this pivot.

- Current answer: Abort hint path. Pivot to real garment region from case phenotype.
- Recommended default: Worker 10/11 `embed-real-garment-region-from-phenotype` via asset-pipeline-lead (general-purpose), then xr-systems-architect cleans up UI-XR bind, then skeptic reviews visible delta.

## 2026-06-06 StableGen/ComfyUI skin cagematch boundary (unchanged)

## 2026-06-04 Local exam Mongo-memory boot profile boundary (unchanged)

## Quest foreground performance capture blocked (unchanged)

## 2026-06-05 Anny local package/source manifest (unchanged)
