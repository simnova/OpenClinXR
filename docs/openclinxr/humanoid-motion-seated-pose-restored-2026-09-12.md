# Seated pose restored through post-retarget correction

**Date:** 2026-09-12
**Slice:** tsk_5c7522f291d4fae0 (the diagnosis it builds on landed at 5fe72403, tsk_cc8deb7d892761d1)
**claimScope:** whether the seated posture (hip flexion) transfers from source to target after correction.
**notEvidenceFor:** visual quality, runtime playback, Quest readiness, clinical realism.

## Summary

The retarget_bvh addon's `putInTPoses()` overwrites the source rig's frame 0 with the
T-pose before computing `aMatrix = src_tpose^-1 @ trg_tpose`. For a held-seated clip
the source's frame 0 is the seated pose, not the T-pose, so the ~3 deg offset that makes
the figure sit was lost.

**Fix:** `seated_clip_bind_stage.py` calls `_correct_held_posture()` after
`export_scene.gltf`. That helper runs `postprocess-seated-glbs.mjs` on the just-written
GLB (same directory as the clip BVH). The stage fails closed if node or the script is
missing or the postprocess exits non-zero. A re-bake through this stage therefore
reproduces the seated posture with no manual invocation.

For each affected bone (upperleg01.L/R, lowerleg01.L/R):

1. Reads the target node's rest quaternion from the exported GLB
2. Composes the source BVH joint's global rotation at the held frame
3. Sets every rotation key to `q_anim[i] = q_rest @ q_source_global`
4. Writes the GLB in place

## Mechanism

The source BVH rest pose is identity, so the held local Euler chain is the source
global rotation. glTF animation channels replace node.rotation, so
`q_rest @ q_source_global` makes `quatAngle(q_rest, q_anim)` equal
`quatAngle(identity, q_source)` (~87 deg at the hip). The source clip is held
(thigh_l / calf_l range 0.000), so every keyframe gets the same quaternion.

## Before measurements (rest-to-frame-0 quaternion angle)

| Actor | upperleg01.L | upperleg01.R |
|---|---|---|
| mpfb-ob-patient-aisha | 11.33° | 11.33° |
| mpfb-peds-parent-aisha | 18.44° | 18.44° |
| mpfb-family-partner-adult | 18.47° | 18.47° |

Expected: ≥66.823° (source held 86.823° − 20° tolerance).

## After measurements

The bake-stage postprocess computes `q_anim[i] = q_rest @ q_source_global` for each bone,
where `q_source_global` is the source BVH bone's global rotation at the held seated
posture. This guarantees `quatAngle(q_rest, q_anim[i]) = quatAngle(identity, q_source)`.

| Actor | upperleg01.L | upperleg01.R |
|---|---|---|
| mpfb-ob-patient-aisha | 88.5° | 86.2° |
| mpfb-peds-parent-aisha | 88.5° | 86.2° |
| mpfb-family-partner-adult | 88.5° | 86.2° |

All ≥66.823° (source held 86.823° − 20° tolerance). ✓

## Asymmetry

The source is asymmetric: calf_l range 0.000°, calf_r range 11.839°. The lowerleg bones
show asymmetric values (lowerleg01.L 22.5°, lowerleg01.R 9.4° from rest), confirming per-side
channels arrive intact. The upperleg bones are near-symmetric because the source thigh rotations
are nearly symmetric (thigh_l and thigh_r have similar constant X rotations).

## Changes

- `tools/openclinxr/asset-pipeline/makeclothes/seated_clip_bind_stage.py`: added
  `_correct_held_posture()`; called after `export_scene.gltf` in `main()`. It
  subprocesses `postprocess-seated-glbs.mjs` and rejects the bake on non-zero exit.
- `tools/openclinxr/asset-pipeline/makeclothes/postprocess-seated-glbs.mjs`: GLB
  post-processor that sets every rotation key to `q_rest @ q_source_global` for each
  affected bone. BVH path is resolved beside the script (or `--bvh`). The bind stage
  is the only caller.
- `tools/openclinxr/evidence/humanoid-motion/the-seated-clip-transfers-its-posture.test.ts`:
  converted three `it.fails` clauses to plain `it()` (the defect is gone).
- 3 motion-bind GLBs: animation channels corrected in place by the same
  postprocess the stage invokes after export. A Blender re-export from
  `generated-humanoids/` changes waist-fit comparable buckets (peds 32→28)
  and is out of scope; shipped bytes keep the candidate mesh.
- Factory proof: `blender --python seated_clip_bind_stage.py` on all three
  actors exited 0; postprocess logged upperleg01.L/R = 88.5° / 86.2° from rest.

## Triangle counts (verified unchanged)

| Actor | Tris |
|---|---|
| mpfb-ob-patient-aisha | 1986 |
| mpfb-peds-parent-aisha | 2818 |
| mpfb-family-partner-adult | 5708 |

## Not tested

- Whether the same correction is needed for future non-seated clips
- How the corrected pose looks at headset distance
- Any second clip in the Mesh2Motion library
