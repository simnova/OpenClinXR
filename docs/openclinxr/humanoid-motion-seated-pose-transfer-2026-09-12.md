# Seated pose transfer: retarget_bvh drops the source's held hip flexion

**Date:** 2026-09-12
**Slice:** tsk_cc8deb7d892761d1 (issue #0)
**claimScope:** whether the seated posture (hip flexion) transfers from source to target.
**notEvidenceFor:** visual quality, runtime playback, Quest readiness, clinical realism.

## Summary

The retarget_bvh addon transfers rotations **relative to the T-pose**, not absolute rotations.
The source's held seated posture (-86.823° Xrotation on thigh_l) is only 3.177° from the source's
T-pose (-90°). After retarget, the output shows 11-18° rest-to-frame-0 hip flexion instead of
the expected ~87°. The held offset is lost.

## 1. Reproduced measurements

### Source BVH

File: `tools/openclinxr/asset-pipeline/makeclothes/mesh2motion-sitting-talking-single-clip.bvh`

| Joint | Channel | Frame-0 (deg) | Range (deg) |
|---|---|---|---|
| thigh_l | Xrotation | -86.823 | 0.000 |
| thigh_l | Yrotation | -10.044 | 0.000 |
| calf_l | Xrotation | +80.378 | 0.000 |
| calf_r | Yrotation | 5.715 | 11.839 |

89 frames, 396 channels. Top 15 largest-moving joints are all fingers (max middle_03_l
Yrotation range 76.238°). The clip is a seated figure talking: sitting is held posture,
motion is hands and fingers.

### Baked GLBs (rest-to-frame-0 quaternion angle)

| Actor | upperleg01.L | upperleg01.R | lowerleg01.L | lowerleg01.R |
|---|---|---|---|---|
| mpfb-ob-patient-aisha | 11.33° | 11.33° | 19.98° | 19.98° |
| mpfb-peds-parent-aisha | 18.44° | 18.44° | 23.70° | 23.70° |
| mpfb-family-partner-adult | 18.47° | 18.47° | 23.64° | 23.64° |

Sitting needs roughly 90° of hip flexion; 11-18° arrived.

### Excursion over the clip (anim[1])

| Actor | upperleg01.L | upperleg01.R | lowerleg01.L | lowerleg01.R |
|---|---|---|---|---|
| mpfb-ob-patient-aisha | 21.46° | 22.05° | 68.82° | 66.73° |

Source calf_l range = 0.000°. Output lowerleg01.L shows 68.82° excursion. This is not
real knee motion.

## 2. Where the constant offset is lost

**Mechanism (traced through retarget.py:267-298):**

1. `putInTPoses()` (retarget.py:197-205) sets frame 0 and puts both rigs in T-pose.
   `autoTPose()` (t_pose.py:266-299) calls `setKeys(pb)` which overwrites frame 0 of
   the source rig's animation with the T-pose rotation.

2. `getTPoseMatrix()` (retarget.py:267-272) reads the T-pose rotations and computes:
   ```
   aMatrix = src_tpose.inverted() @ trg_tpose
   ```

3. `retarget(frame)` (retarget.py:274-298) for each frame:
   ```
   trgMatrix = srcMatrix @ aMatrix
   ```
   This transfers the source's rotation **relative to its T-pose** onto the target's T-pose.

**The constant offset is lost because:**
- Source T-pose: thigh_l at -90° Xrotation (from `TPose` dict, t_pose.py:225)
- Source seated pose: thigh_l at -86.823° Xrotation
- Offset from T-pose: 3.177°
- Target T-pose: upperleg01.L at -90° Xrotation (same)
- Retargeted frame 0 = T-pose + 3.177° offset ≈ -86.8° in T-pose space
- But the GLB exports this relative to the **rest pose**, which is 104.85° Xrotation
- The rest-to-frame-0 angle (11.33°) is the quaternion angle between rest (104.85°)
  and the retargeted pose — not the source's held flexion

**The bone maps are correct and symmetric** (checked: mesh2motion-human-66.json maps
thigh_l→thigh.L and calf_l→shin.L; mpfb2-default-no-toes.json maps upperleg01.L→thigh.L
and lowerleg01.L→shin.L). ik-bones is [] on both sides.

## 3. The 85° knee: rest-orientation artefact, not real motion

The 85.32° lowerleg01.L excursion is the quaternion angle between frame 0 and frame 89 —
not motion through the clip.

**Evidence (anim[1] per-bone frame analysis):**

lowerleg01.L has **2 unique quaternions** across 90 frames:
- Frame 0: 19.98° from rest (the retargeted pose)
- Frames 1-89: 68.82° from rest (all identical to hundredth of a degree)

upperleg01.L has **2 unique quaternions** across 90 frames:
- Frame 0: 11.33° from rest
- Frames 1-89: 21.46° from rest (all identical)

The retarget_bvh addon creates keyframes only when the source has motion. The source's
calf_l has 0.000° range, so the addon produces only 2 keyframes for the left shin:
frame 0 (the retargeted T-pose) and frame 1 (the rest-pose difference). Frames 2-89
are interpolated copies of frame 1.

The "excursion" of 85.32° is `angle(frame0, frame89)` = `angle(frame0, frame1)` —
the rest-orientation difference between the retargeted pose and the T-pose difference,
not actual knee motion.

## 4. Asymmetry loss

Source is asymmetric: calf_l range 0.000°, calf_r range 11.839°. The output is
**symmetric to the hundredth of a degree** on all actors (upperleg01.L and upperleg01.R
show identical rest-to-frame-0 angles).

Lowerleg01.L has 2 unique quaternions (frozen). Lowerleg01.R has 89 unique quaternions
(per-frame motion from the source's calf_r range). The left side is frozen because the
source has 0 range; the right side has interpolated motion from the 11.839° range.

This confirms per-side channels are not arriving intact through the retarget.

## 5. Test output

```
 FAIL  the-seated-clip-transfers-its-posture.test.ts
   × mpfb-ob-patient-aisha: rest-to-frame-0 hip flexion within 20 deg of source held value
     AssertionError: expected 11.32553662213726 to be greater than or equal to 66.823
   × mpfb-peds-parent-aisha: rest-to-frame-0 hip flexion within 20 deg of source held value
     AssertionError: expected 18.444558081076924 to be greater than or equal to 66.823
   × mpfb-family-partner-adult: rest-to-frame-0 hip flexion within 20 deg of source held value
     AssertionError: expected 18.46760834128902 to be greater than or equal to 66.823
```

Tolerance: 20° (source range 0.000° + measurement margin for quaternion/Euler differences
and rest-pose variance between rigs). Source held value 86.823° − 20° = 66.823° minimum.
All three GLBs fail this.

## 6. Not tested

- Whether retarget_bvh has a setting that preserves a constant source offset.
- Whether the 85° knee excursion is a rest-orientation artefact of the quaternion
  measure rather than real motion. (Settled: it IS an artefact — 2 unique quaternions
  across 90 frames, no per-frame variation on the left side.)
- What the clip looks like at headset distance.
- Any other clip in the Mesh2Motion library.
