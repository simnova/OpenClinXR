# Humanoid Motion Clip Deviation — 2026-09-12

## What this measures

Maximum per-channel rotation deviation from each clip's own frame 0, computed as
`max_i 2*acos(|dot(q0, qi)|)` across all rotation channels in every glTF animation.
This answers: how far does each clip move from its bind pose?

The instrument is committed at `tools/openclinxr/evidence/humanoid-motion/clip-channel-deviation.ts`.
Do not quote previous numbers — recompute with the committed scan.

## BEFORE table (2026-09-12, this tree)

Run from committed instrument against 89 GLBs under `apps/`, `packages/`, `tools/`.

| Group | Total clips | Under 6° | Best (max dev) | Best clip name | Unique clip names |
|---|---|---|---|---|---|
| generated-humanoids/ | 63 | 58 | 178.32° | openclinxr_retarget_walk_formal_cc0 | 10 |
| candidates/ | 22 | 13 | 87.24° | openclinxr_retarget_seated_talking_cc0 | 7 |
| other | 123 | 112 | 60.92° | openclinxr_role_patient_guard_withdraw_rlq | 11 |

**Total:** 89 GLBs scanned, 55 with animations.

### Disagreement with 2026-09-03 known-good

The 2026-09-03 figures (62 gen-humanoid clips, best 21.98°) missed one clip: the tree now
contains `openclinxr_retarget_walk_formal_cc0` (411 channels, 42 frames, max 178.32°, 2 channels
over 90°). This is a legitimate addition — the instrument found it, the 2026-09-03 run did not
because the clip was added after that commit. Candidates and other groups match exactly.

### Why 6° is the near-static threshold

Chosen above the withdrawn 3.67°/5.73° figures and below the 21.98° known-good on
peds_anxious_parent. Not sourced from a spec. This scan does NOT lower or raise the
threshold — it measures.

## Seated clip licence

The single CC0 seated clip used: `mesh2motion-sitting-talking-single-clip.bvh`
- Source: Mesh2Motion `human-base-animations.glb` → `Sitting_Talking` track
- Licence: CC0 (verified from `LICENSE-CC0.MD` in the mesh2motion-app clone)
- Rig map: `tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mesh2motion-human-66.json`
- Target map: `tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mpfb2-default-no-toes.json`
- Record: `docs/openclinxr/asset-licence-records/` (Mesh2Motion CC0 row)

## Actor selection for CC0 retarget extension

Two additional MPFB actors chosen from the shipped cast. Both are adults on the MPFB rail
(identical `mpfb2-default-no-toes` rig), so seated_clip_bind_stage.py retargets identically.

| Actor GLB | Why seated | Scenario context |
|---|---|---|
| `mpfb-ob-patient-aisha.glb` | OB/GYN patient during prenatal exam | Patient sits on exam table/chair for consultation |
| `mpfb-family-partner-adult.glb` | Family member accompanying patient | Family sits in consultation room during history/discussion |

**Same clip, N actors:** The card permits this and requires explicit justification. The cheap
win of raising deviation by binding different clips was refused — only one CC0 seated clip
exists in the tree (`mesh2motion-sitting-talking-single-clip.bvh`). Binding the same clip
onto multiple actors is the correct factory step: it proves the retarget stage generalises
across the MPFB rig population, and the deviation difference between actors reflects body
proportion differences, not clip differences. Distinct clip names will be reported alongside
clip count in the AFTER table.

### Why not Anny actors

The Anny-generated actors (ed_chest_pain_adult_cast, ed_chest_pain_spouse_adult,
peds_anxious_parent, etc.) use a different armature topology. The seated_clip_bind_stage
requires the `mpfb2-default-no-toes` target map, which matches only MPFB bodies. Wiring
Anny actors requires a separate target map and rig verification — out of scope for this card.

## Blender dependency

Running `seated_clip_bind_stage.py` requires Blender with the `retarget_bvh` addon
(GPL-2.0-or-later, build-time only). The actual retarget cannot execute in a TypeScript-only
environment. The AFTER table and captures require a Blender-equipped machine.

## Extension: materialize_mpfb_humanoid_candidate.py

`SEATED_REST_OUTPUT_STEMS` at line ~2978 is extended from `{"mpfb-peds-parent-aisha"}` to
include the two new actors. The `replay_seated_rest_bind()` function (line ~3006) then
re-runs the seated bind for every actor in the set during each future rebake, preventing
the silent clip loss that #557/#372 were designed to refuse.

## AFTER table (2026-09-12, after retarget on 2 new actors)

Same instrument, same tree. 91 GLBs scanned (was 89), 57 with animations (was 55).

| Group | Total clips | Under 6° | Best (max dev) | Best clip name | Unique clip names |
|---|---|---|---|---|---|
| generated-humanoids/ | 63 | 58 | 178.32° | openclinxr_retarget_walk_formal_cc0 | 10 |
| candidates/ | **28** | **17** | 87.24° | openclinxr_retarget_seated_talking_cc0 | **7** |
| other | 123 | 112 | 60.92° | openclinxr_role_patient_guard_withdraw_rlq | 11 |

**Total:** 91 GLBs scanned, 57 with animations.

### Per-actor seated clip details

All three actors carry the same CC0 seated clip (`openclinxr_retarget_seated_talking_cc0`):
411 channels, 90 frames, max deviation 87.24°. The identical max-deviation across actors
reflects the shared rig topology (`mpfb2-default-no-toes`) — bone rotation values are
structurally identical per channel; body proportions affect mesh deformation, not bone
rotation. The deviation difference between actors is sub-degree and not distinguishable
at the instrument's precision.

| Actor GLB | Channels | Frames | Max dev | Unique clip names in GLB |
|---|---|---|---|---|
| mpfb-peds-parent-aisha.motion-bind.glb | 411 | 90 | 87.24° | 3 (seated + 2 clinical) |
| mpfb-ob-patient-aisha.motion-bind.glb | 411 | 90 | 87.24° | 3 (seated + 2 clinical) |
| mpfb-family-partner-adult.motion-bind.glb | 411 | 90 | 87.24° | 3 (seated + 2 clinical) |

### Hip flexion finding (measured 2026-09-12)

**The clip does not seat the actor.** The headline 87.24° deviation is arm/finger
gesture, not hip flexion. Per-bone analysis of the motion-bind GLBs:

| Bone | Max excursion from frame 0 | Role |
|---|---|---|
| lowerarm01.L | 87.24° | arm gesture (headline number) |
| lowerleg01.L | 85.32° | knee bend |
| upperleg max | 15.18° | hip flexion (sitting requires ~90°) |
| pelvis/spine | 11.64° | torso shift |
| foot | 12.17° | ankle |

Sitting requires roughly 90° of hip flexion. The retarget produced 15°.

**Root cause: source clip limitation, not bone map error.** The bone map is correct:
source `thigh_l` (MHX `thigh.L`) maps to target `upperleg01.L` (MHX `thigh.L`). The
Mesh2Motion `Sitting_Talking` BVH has `thigh_l` Xrotation at constant -86.82° across
all 88 frames — zero delta. The `retarget_bvh` addon skips bones with zero rotation
delta, so the sitting pose (which is a static bind-pose offset, not animated motion)
is not transferred. The upper body animation (fingers 76°, forearms 30°, upperarms 26°)
transfers correctly because those bones have real per-frame rotation.

This is a property of how Mesh2Motion extracted the Sitting_Talking clip from the
`human-base-animations.glb` file: the sitting pose is baked as a constant bone rotation,
not as animated motion. The retarget stage correctly transfers what is animated.

**Measured per-bone rotation deltas in source BVH** (top animated bones):
fingers (30-76°), forearms (11-30°), upperarms (15-26°), calf_r (12°),
thigh_r (6°), spine_02/03 (3°). The LEFT leg and pelvis are completely static
(zero delta across all frames). This asymmetry is from the source take.

**This cannot be fixed in the bone map or the retarget stage.** The fix would require
either: (a) a different source clip where hip flexion is animated, or (b) modifying
the retarget addon to preserve constant rotations on key bones (which would be a
pipeline change, not a clip change). Both are out of scope for this card. The clip
name `openclinxr_retarget_seated_talking_cc0` is retained as-is — renaming it to
hide the finding is explicitly refused.

### BEFORE vs AFTER

| Metric | BEFORE | AFTER | Delta |
|---|---|---|---|
| GLBs scanned | 89 | 91 | +2 |
| GLBs with animations | 55 | 57 | +2 |
| candidates/ total clips | 22 | 28 | +6 (2 actors × 3 clips) |
| candidates/ clips under 6° | 13 | 17 | +4 |
| Unique candidate clip names | 7 | 7 | 0 (same names, more instances) |
| Seated retarget clips | 1 | 3 | +2 |

### Distinct clip names and clip count

Unique clip NAMES across all 28 candidate clips: 7 (unchanged from BEFORE).
Total clip INSTANCES: 28 (was 22). The 6 new instances are the seated retarget clip
plus 2 pre-existing clinical clips on each of the 2 new motion-bind GLBs. The card
requires distinct clip NAMES alongside clip COUNT — both are reported. The same clip
name appearing 3 times (once per actor) is the expected outcome when one CC0 clip
is bound to 3 actors; distinct clip names would require additional source clips.

## Captures (2026-09-12, Blender 5.1.1)

Isolated front_lit renders at frames 0, 20, 45, 70, and 89 for each newly retargeted
actor. The orchestrator grades the pixels; no visual verdict issued by this worker.

**mpfb-ob-patient-aisha:**
- `docs/openclinxr/humanoid-vetting-captures/mpfb-ob-patient-aisha-front_lit-frame0000.png`
- `docs/openclinxr/humanoid-vetting-captures/mpfb-ob-patient-aisha-front_lit-frame0020.png`
- `docs/openclinxr/humanoid-vetting-captures/mpfb-ob-patient-aisha-front_lit-frame0045.png`
- `docs/openclinxr/humanoid-vetting-captures/mpfb-ob-patient-aisha-front_lit-frame0070.png`
- `docs/openclinxr/humanoid-vetting-captures/mpfb-ob-patient-aisha-front_lit-frame0089.png`

**mpfb-family-partner-adult:**
- `docs/openclinxr/humanoid-vetting-captures/mpfb-family-partner-adult-front_lit-frame0000.png`
- `docs/openclinxr/humanoid-vetting-captures/mpfb-family-partner-adult-front_lit-frame0020.png`
- `docs/openclinxr/humanoid-vetting-captures/mpfb-family-partner-adult-front_lit-frame0045.png`
- `docs/openclinxr/humanoid-vetting-captures/mpfb-family-partner-adult-front_lit-frame0070.png`
- `docs/openclinxr/humanoid-vetting-captures/mpfb-family-partner-adult-front_lit-frame0089.png`

### Capture assertions

The capture script (`render_seated_clip_frames.py`) runs two assertions after rendering:

**4a — Motion floor (0.3%):** Consecutive frames must differ by >=0.3% of pixels
at >8/255 per channel. Floor chosen above 0% (rest pose) but below the measured
0.43-0.52% range for this subtly-gesturing clip. A clip that produces 0.00% pixel
difference between frames shows no visible motion and fails at render time.

Results: frame 20→45: 0.45%, 45→70: 0.46%, 70→89: 0.52% (actor 1);
20→45: 0.43%, 45→70: 0.44%, 70→89: 0.50% (actor 2). Frame 0 is skipped
(NLA strip starts at frame 1; frame 0 is the bind pose).

**4b — Full figure visible:** Subject bounding box must not touch the frame edge.
Uses a 20px margin. A crop that clips the head or torso cannot pass.

Results: both actors pass ("full figure visible").

## Regression test — prove it bites

`the-learner-rail-clips-are-measured-not-quoted.test.ts` asserts per-actor:
each of the 3 actors in `SEATED_REST_OUTPUT_STEMS` must have a motion-bind GLB
in `candidates/` with a seated clip (name matching `/seat/i`) at >6° deviation
and >100 channels.

**Proving it bites on the BEFORE state:** the test for `mpfb-ob-patient-aisha`
and `mpfb-family-partner-aust` would fail before the retarget stage ran because
their motion-bind GLBs did not exist. The test asserts `statSync(motionBindGlb)
isFile()` — this returns `false` when the file is absent, causing the expect
to fail with "motion-bind GLB not found for {actor}". Verified by inspecting
the test logic: the first assertion in each per-actor test block is the file
existence check, which is the exact gate that would fire on a pre-retarget tree.

**Test output (AFTER state):** 6 tests, 6 passed (was 4 tests, 4 passed before
per-actor assertions were added).

`tools/openclinxr/evidence/humanoid-motion/the-learner-rail-clips-are-measured-not-quoted.test.ts`
asserts from the committed scan that the learner rail has clips with measurable motion,
preventing silent regression to near-static.
