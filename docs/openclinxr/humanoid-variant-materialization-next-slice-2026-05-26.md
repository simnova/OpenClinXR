# Humanoid Variant Materialization Next Slice - 2026-05-26

## Purpose

Move beyond semantic cue overlays by making actor-specific generated humanoid variants the next product-advancement lane for the encounter factory.

## Evidence that triggered this slice

- WebXR-only screenshots show scenario identity is now visible in-scene, but actors still share the same low-fidelity mannequin body and similar stance.
- Cue overlays help multimodal review, but they should be treated as temporary scaffolding rather than the target visual state.

## Implementation order

1. Extend encounter factory output with per-actor `humanoidVariantProfile` entries derived from encounter actor definitions.
2. Add profile fields for age band, body scale, hair silhouette, clothing layer, clinical role artifacts, face/eye/lip rig requirement, idle pose requirement, and locomotion requirement.
3. Persist variant profiles beside each learner runtime bundle so UI-XR does not infer identity from hardcoded scenario ids.
4. Route UI-XR actor rendering through the variant profile before applying temporary cue overlays.
5. Keep cue overlays visible only as fallback/evidence markers when true generated actor-specific meshes are not available.
6. Re-run WebXR-only screenshot contact sheets and compare actor distinguishability without using the right-side UI panel.

## Acceptance evidence

- Each encounter has actor-specific variant metadata in its generated runtime bundle.
- Patient, clinician, and family/observer actors have different silhouettes or clothing/role artifacts before semantic cue overlays are considered.
- WebXR-only screenshots make scenario and actor roles recognizable without the right-side UI panel.
- No production, Quest, clinical, or scoring readiness is claimed.

## Recommended next worker

Use a focused asset-pipeline worker to add variant profile metadata to generated runtime bundles, then a UI-XR worker to consume it in actor rendering.
