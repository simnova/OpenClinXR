# Anny-Compatible Stub + Headless Blender Character Asset Pipeline

Authority note: this document is an archive-candidate implementation note, not an active control surface. The current checked-in peds GLBs are B runtime candidates from an Anny-compatible stub mesh stage plus Blender procedural rigging/material fallback. They are not evidence of real Anny weights, a B+ visual realism gate pass, Quest readiness, production readiness, clinical validity, or scoring validity. Use the sidecar manifests in `apps/ui-xr/public/generated-humanoids/*.provenance.json` and the active queue in `PROJECT_COORDINATION_INDEX.md` / `AUTONOMOUS_WORK_PLAN.md` for current provenance decisions.

This directory contains the local, OSS-first implementation of the pipeline described in the user query for generating rigged, textured humanoids (role_specific_humanoid_glb) from case-driven parameters.

## One-liner / CLI usage (exactly as proposed)

```bash
# 1. Mesh stage (<5s target)
python generate_mesh.py \
  --params '{"age": 8, "body_profile": "pediatric_school_age", "pose": "standing_neutral", "phenotype": {"skin_tone": "warm_light_child", "hair_color": "light_brown", "build": "slender_asthma"}}' \
  --output /tmp/anny-peds.obj \
  --manifest /tmp/anny-peds-manifest.json

# 2. Headless Blender stage (import + rig + StableGen/ComfyUI texturing + hair/eyes + export)
blender --background --python automate_blender.py -- \
  --input-mesh /tmp/anny-peds.obj \
  --input-manifest /tmp/anny-peds-manifest.json \
  --output-glb /tmp/peds_asthma_patient_rigged_textured.glb \
  --case-id peds_asthma_parent_anxiety_v1 \
  --actor-role patient \
  --prompt "hyper-realistic 8-year-old Caucasian child skin with subtle freckles, visible pores, medical exam lighting, standardized patient for pediatric asthma scenario"
```

The final GLB is ready for:
- Unity / Godot / iMSTK medical simulators
- OpenClinXR runtime (ui-xr loader expects the canonical armature, morph targets for viseme/emotion/gaze, skin weights, etc.)
- Review packets / admin surfaces (via the generated-human-rigging-artifacts report)

## ComfyUI / StableGen backend (unattended)

- Run ComfyUI (with ControlNet, IPAdapter, and your preferred model: SDXL, FLUX.1-dev, Qwen-Image-Edit, etc.).
- StableGen (or any ComfyUI-Blender addon) can be called from the bpy script via its Python API or by the script submitting a prepared workflow directly to the ComfyUI HTTP API (`--use-comfy`).
- StableGen "builds the full ComfyUI workflow automatically" from the multi-view renders (depth/normal) + reference + prompt.
- Scene Queue in StableGen supports batch/overnight generation of many patients exactly as described.

The `automate_blender.py` script contains the hook and comments for the real ComfyUI path. The current implementation falls back to a safe local procedural + bake so the rest of the factory (rigging contract, runtime consumption, review surfaces) can be exercised without waiting for the license exception on StableGen/ComfyUI diffusion models.

## Integration with the OpenClinXR factory

- `tools/openclinxr/factory/generated-human-rigging-artifacts.ts` already defines the contract (ANNY_SOURCE_OBJ, canonical bones, morph targets for lip-sync/gaze/expression, skin weights report, realism manifest, etc.).
- The encounter asset generation worker / materialization pipeline can invoke this Python stage for `role_specific_humanoid_glb` work orders when the shared asset library has a cache miss.
- Phenotype scalars (age, shape, skin tone, build, etc.) are derived from the scenario case spec / actor description in the runtime-selection review packet (blueprint-driven).

## Current license / approval posture (do not bypass)

Per `docs/openclinxr/asset-generation-pipeline.md` (tool matrix) and the active external-ai-asset-pipeline-integration-plan:

- Anny-compatible stub mesh output + Blender (rig, cleanup, bake, procedural fallback) are authorized local/open-source implementation scaffolds; real Anny output requires a manifest proving real model/weights use.
- **StableGen + full diffusion (ComfyUI with Flux/SDXL/Qwen etc.) is blocked until an explicit license exception exists.**
- This implementation respects the block: the diffusion step is behind `--use-comfy` + documented comments. The procedural bake fallback always works and produces a loadable artifact for the rest of the system.

When the exception is granted, only the texture stage in `automate_blender.py` (and/or a small ComfyUI workflow helper) needs to be activated.

## M1 Max 64GB posture

- Mesh stage is CPU-light (stub or real Anny forward pass on CPU/MPS).
- Heavy diffusion work is offloaded to a ComfyUI server (can be the same machine or remote).
- Everything is local, no cloud calls in the default path.

## Next / related

See the asset-pipeline-lead agent memory and the current worker-backlog for how this fits the broader materialization + shared asset library LRU story.
