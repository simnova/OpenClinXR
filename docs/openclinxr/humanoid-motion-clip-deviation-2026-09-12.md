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

## AFTER table (pending Blender run)

TO BE FILLED after running the seated clip bind stage on the two new actors.
The same `clip-channel-deviation.ts` instrument will be re-run to produce this table.

Expected: total candidate clips increase from 22 to ~24 (one per new actor). The
`openclinxr_retarget_seated_talking_cc0` clip should appear with slightly different
max-deviation values reflecting the different body proportions of each actor.

## Captures (pending Blender run)

TO BE FILLED: front_lit captures at several frames for each newly retargeted actor.
The orchestrator grades the pixels.

## Regression test

`tools/openclinxr/evidence/humanoid-motion/the-learner-rail-clips-are-measured-not-quoted.test.ts`
asserts from the committed scan that the learner rail has clips with measurable motion,
preventing silent regression to near-static.
