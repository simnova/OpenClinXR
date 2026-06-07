# Operator Open Questions

This file tracks non-blocking operator questions that need a better answer after more evidence. Blockers that require operator action stay in `operator-steering-needed-questions.md`.

## 2026-06-07 garment-hint-v1 aborted per anti-toil gate

Garment-source-geometry-hint-v1 path is **aborted** after skeptic review (subagent 019ea136). Third consecutive zero-visible-delta model-adjacent slice triggered the anti-toil gate. Verdict: 48-face rigid cylindrical tube, sub-pixel at 3.4m viewer distance, no vertex weights (rigid parent), Q1 violation (no sleeve geometry despite `short_sleeve_exam_tshirt` phenotype). **Recommended next: embed-real-garment-region-from-phenotype** — expand `apply_role_clothing_material_regions` to read `phenotype.garmentLayers` and produce weighted torso+shoulder+upper-arm sleeve geometry. The hint-only comparator paths in `main.ts` and tests should be cleaned up as part of this pivot.

- Current answer: Abort hint path. Pivot to real garment region from case phenotype.
- Recommended default: Worker 10/11 `embed-real-garment-region-from-phenotype` via asset-pipeline-lead (general-purpose), then xr-systems-architect cleans up UI-XR bind, then skeptic reviews visible delta.

## 2026-06-06 StableGen/ComfyUI skin cagematch boundary (unchanged)

## 2026-06-04 Local exam Mongo-memory boot profile boundary (unchanged)

## Quest foreground performance capture blocked (unchanged)

## 2026-06-05 Anny local package/source manifest (unchanged)
