# Operator Open Questions

This file tracks non-blocking operator questions that need a better answer after more evidence. Blockers that require operator action stay in `operator-steering-needed-questions.md`.

## 2026-08-03 BVH→Anny locomotion retarget hardening (non-blocking)

Context: `tools/openclinxr/asset-pipeline/anny/apply_bvh_to_anny_full.py` hardened with fail-loud diagnostics + gates (`asset:bvh-retarget:smoke` / `:lab-smoke`). Three open product questions:

| # | Question | Recommended default |
|---|----------|---------------------|
| 1 | **Seated exam body vs walking motion.** The base mesh is `seated-adult-bod`; locomotion (walk/run) is retarget-validation, not an obvious clinical need. Where (if anywhere) does a *walking* patient belong in the Step 2 CS station flow? | Do **not** auto-wire a walking patient into a seated station. Ship the capability + clean asset; product owner decides placement. Locomotion stays lab/validation until a station needs it. |
| 2 | **License for the shippable clip.** MB-Lab walk/run is the highest-quality result but **AGPL** (local-validation only). CMU (`cmu_07_01_walk`) is license-clean (free-all-uses) and now passes all safety gates (explode ~1.0, torso pitch ~10°, 0 unweighted). | For any product-facing locomotion, use **CMU** (license-clean). Keep MB-Lab as the local quality reference only. |
| 3 | **CMU arm over-swing (cosmetic).** CMU torso is at parity with MB-Lab (measured back-pitch 13.7° max vs 10.2°), but CMU upper-arm delta reaches ~96° (arms swing up higher than natural). Not gated (cosmetic); MB-Lab arms are more natural. | Acceptable for validation now. Before product ship, tune CMU arm mapping (upperarm delta clamp / rest-axis) to MB-Lab-like swing. Tracked follow-on. |

- Guards: `pnpm asset:bvh-retarget:smoke` (bake + diagnostics + `--assert-deterministic` + `--product` license gate) and `pnpm asset:bvh-retarget:lab-smoke` (three.js explode/motion/torso-pitch). Both green 2026-08-03.

## 2026-08-02 arena-physics realbind epic (ACTIVE — BOD pivot)

**Supersedes** prior “post-epic defer WASM/UI-XR” defaults. BOD 2026-08-02 incorporated Desktop `Xxxyyy-arena.md.md` → epic `arena-physics-clinical-touch-realbind-v1` + brief `docs/openclinxr/arena-physics-clinical-touch-realbind-2026-08-02.md`. Residual product lane was empty; explicit queue pivot (not silent preemption).

| Id | Decision | Frozen (epic OD) |
|----|----------|------------------|
| OD-1 | Required real engine | **Rapier** (`@dimforge/rapier3d` deterministic) |
| OD-2 | `bodyMechanics` home | Extend canonical phenotype type at real def site, additive+optional |
| OD-3 | Cross-platform C5 | **`determinismScope: "local"`** accepted |
| OD-4 | Immersive/headset physics | R7 operator-gated; desktop/`foreground_ready` suffices for DoD |
| OD-5 | Per-slice thrash | **90 min** agentic → escalate, never abandon objective |

Still non-blocking (unchanged from v1):

| # | Question | Recommended default |
|---|----------|---------------------|
| 3 | IWSDK MCP config location? | Arena-scoped optional; InputLog remains replay SSOT (MADR 0029). |
| 4 | Fixed step 60 Hz vs 72 Hz? | **60 Hz** |
| 5 | Capture tool `capture=` for physics visuals? | Extend enum only if R3/R4 needs it; keep existing modes byte-identical. |
| 8 | Website / skeptic marketing of physics? | **No** until dual visible evidence + skeptic sign-off on realbind close. |

- Current answer (2026-08-02 autonomous close path): R1–R5 delivered (real Rapier + factory + UI-XR bind + measured metrics + arena cagematch). R6 successor MADR records PROVEN under local determinism; **all production/Quest/clinical/scoring gates remain false** until a human flips the named gate.
- **R7 (OD-4) pre-declared deferral:** immersive/headset physics re-run is **not required for epic DoD**. Desktop/`foreground_ready` evidence suffices. Re-open R7 only with operator headset + explicit queue pivot. Recorded 2026-08-02 fully-autonomous close.
- Recommended default: after R6+R7 deferral, epic complete; product Next may return to non-physics backlog without garment thrash.

## 2026-06-07 garment-hint-v1 aborted per anti-toil gate

Garment-source-geometry-hint-v1 path is **aborted** after skeptic review (subagent 019ea136). Third consecutive zero-visible-delta model-adjacent slice triggered the anti-toil gate. Verdict: 48-face rigid cylindrical tube, sub-pixel at 3.4m viewer distance, no vertex weights (rigid parent), Q1 violation (no sleeve geometry despite `short_sleeve_exam_tshirt` phenotype). **Recommended next: embed-real-garment-region-from-phenotype** — expand `apply_role_clothing_material_regions` to read `phenotype.garmentLayers` and produce weighted torso+shoulder+upper-arm sleeve geometry. The hint-only comparator paths in `main.ts` and tests should be cleaned up as part of this pivot.

- Current answer: Abort hint path. Pivot to real garment region from case phenotype.
- Recommended default: Worker 10/11 `embed-real-garment-region-from-phenotype` via asset-pipeline-lead (general-purpose), then xr-systems-architect cleans up UI-XR bind, then skeptic reviews visible delta.

## 2026-06-06 StableGen/ComfyUI skin cagematch boundary (unchanged)

## 2026-06-04 Local exam Mongo-memory boot profile boundary (unchanged)

## Quest foreground performance capture blocked (unchanged)

## 2026-06-05 Anny local package/source manifest (unchanged)
