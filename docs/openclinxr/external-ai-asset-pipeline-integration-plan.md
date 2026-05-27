# External AI Asset Pipeline Integration Plan

Date: 2026-05-25

## Goal

Make the encounter asset and scene generation factory entirely driven by encounter details, while allowing generated assets to be reused through a shared asset library with LRU caching. External AI providers may be evaluated only through explicit provider gates and metadata-only work orders until execution is approved.

## Non-negotiable boundaries

- Encounter definitions, actor roles, clinical scenario requirements, visual-QA blockers, and runtime evidence gates are the only valid inputs for generation work.
- Runtime scene code must not hardcode encounter-specific assets.
- Paid/cloud APIs, external network calls, provider secrets, production deployment, Quest-readiness claims, clinical-validity claims, scoring-validity claims, and production-readiness claims remain disabled until explicitly approved.
- Every generated or reused asset must preserve provenance, license posture, evidence-gate compatibility, and `notEvidenceFor` caveats.

## Integration order

1. Provider registry metadata

   Add provider candidates to the capability/provider gate surface as planned-only routes:

   - `hunyuan3d_local`: local/open-source candidate for equipment, room props, non-humanoid meshes, and possible humanoid base mesh experiments.
   - `meshy_cloud_requires_approval`: cloud/provider candidate for humanoid mesh, rigging, and basic animation experiments.
   - `tripo_cloud_requires_approval`: cloud/provider candidate for fast draft props or reference-image-to-3D comparisons.
   - `vlm_adversarial_reviewer_requires_approval`: multimodal reviewer candidate for screenshot/video critique and AAA-realism gap detection.

2. Shared asset library and LRU reuse

   Each work order must include:

   - deterministic semantic lookup key derived from encounter details, actor role, required asset kinds, evidence signals, clinical room grammar, and visual-QA blockers;
   - shared Blob prefix under `shared-encounter-assets/`;
   - Mongoose/Mongo collection `shared_encounter_asset_library`;
   - LRU policy with `lookup_before_generate`, `least_recently_used`, recency update on hit, and evidence-gate compatibility checks.

3. Work-order routing

   Route work orders by target kind:

   - `role_specific_humanoid_glb`: character-generation, prefer local/open-source experiments first; Meshy only after explicit approval.
   - `role_idle_animation_glb`: animation-generation, prefer local Blender/animation worker first.
   - `facial_lipsync_gaze_animation`: animation-generation, generated from dialogue, phoneme/viseme map, affect timeline, and gaze target requirements.
   - `medical_equipment_glb`: medical-equipment-generation, prefer Hunyuan3D/local or deterministic fixture expansion first.
   - `visual_feedback_closure`: asset-bake, consumes adversarial multimodal findings and keeps blockers open until new visual evidence closes them.

4. Provider execution adapters

   Implement adapters in this order, each behind explicit gates:

   - deterministic mock adapter for repeatable CI and schema validation;
   - local Blender/Python adapter for asset cleanup, scale normalization, GLB packaging, and simple generated fixtures;
   - local Hunyuan3D adapter for non-humanoid equipment/prop trials;
   - cloud Meshy adapter only after explicit approval, credentials, cost controls, and provider ToS/license review;
   - VLM adversarial reviewer adapter only after explicit approval and claim-boundary safeguards.

5. Evidence-gated refinement loop

   For each encounter:

   - build work orders from encounter details;
   - check shared asset library for compatible cached assets;
   - generate only cache misses;
   - publish scene manifest and learner runtime bundle;
   - capture screenshot/video evidence;
   - run adversarial multimodal review;
   - convert blockers into remediation work-order refs;
   - reuse or regenerate assets until visual-QA gates pass for the approved claim scope.

## Current completed slice

- Work orders now carry shared asset-library lookup metadata, Blob/Mongoose storage refs, and LRU reuse policy.
- Provider execution remains metadata-only and disabled by default.

## Next slices

1. Add planned provider registry entries for Hunyuan3D, Meshy, Tripo, and VLM adversarial review.
2. Surface shared asset-library reuse metadata in publication dry-run and worker execution reports.
3. Add a deterministic in-memory shared asset library resolver for tests.
4. Add a local asset-cache evidence report that proves cache hits/misses and LRU eviction behavior without generating real assets.
5. Add provider-gate tests proving cloud/provider routes cannot execute without explicit approval.
