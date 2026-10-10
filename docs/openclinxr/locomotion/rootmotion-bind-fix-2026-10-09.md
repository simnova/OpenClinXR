# Root-motion bind fix 2026-10-09 — the generator's plant survives the bind

Input: `docs/openclinxr/kimodo-stop-oneshot-cagematch-2026-10-09.md` (verdictLock and
verdictNoLock both `fail_all_rigs`). Same prompt, seed 42, constraints, rigs. Outputs
under `.openclinxr/evidence/rootmotion-bind/` (scratch, gitignored): per-rig stop GLBs
(lock clip now bound with the lock refused, plus identical `_nolock` clips), provenance
sidecars, metrics JSON, render strips.

## Cause (defects b and c): armature-space delta assigned to a bone-rest-frame field

`motion_bind_from_positions_stage.py`, `apply_pose`: the root was posed with
`root_pb.location = local_pos - rest_local_pos`, where the right side is an
ARMATURE-space offset. `PoseBone.location` is expressed in the bone's own rest frame,
so the achieved offset is `R_rest @ location`. Every rig's hips rest rotation is a
near-180-degree flip about X with a per-rig tilt error; forward travel leaked into the
vertical by `sin(tilt) * travel`, growing with distance walked:

| rig | tilt from flip (deg) | travel (m) | predicted leak (m) | measured drop (m) |
|---|---|---|---|---|
| physician | 8.79 | 2.51 | 0.38 | 0.42 |
| nurse | 0.27 | 3.04 | 0.01 | 0.00 |
| child | 16.43 | 2.15 | 0.61 | 0.67 |

The falsifier ordered the rigs nurse < physician < child, matching the drops, and the
leak magnitudes match within 4-6 cm (remainder: the source's own first-to-last hips
change plus walking bob). Blender-measured: the location-to-armature map equals the
rest rotation to 6e-7 on all three rigs; the rotation path (`world = rest @ basis`) was
already correct; `location = R_rest^-1 @ delta` round-trips to 4.5e-8 m. The same
misrotation also mirrored travel direction, which explains the cagematch's off-convention
natural yaws: with the fix, rigid yaw corrections of 15.04 / 42.44 / 176.41 deg all
closed exactly on the -0.86 deg convention (-0.859 / -0.861 / -0.859 re-measured), so
the cagematch's yaw-rebind fault does not reproduce on the fixed path.

Fix: root-motion path premultiplies by the inverse rest rotation; the strip-flag path
keeps the historical statement verbatim. Strip regression (physician stop joints,
loop-station inputs with the strip flag, pre-fix vs post-fix stage): root and toe tracks
identical, worstDeltaM = 0.

## Defect (a): the foot lock is refused on kept-root clips, with a log line

With the root fixed, the base bind already plants feet (medians 0.007-0.018 m, hold
0.004-0.009 m), while the bake-time world pin ADDED hold drift (0.020-0.048 m: the pin
is captured mid-settle and the 2-bone IK chain fights the travelling root) without
removing any jump (max step identical with and without it). The stage now logs
`foot_locking_skipped=root_motion_kept` plus the reason and skips the pin; the
historical implementation is retained dead under `elif False:` for a future rework that
can pin without fighting root travel. Same remedy class as the round-13 in-place skip:
planting at playback belongs to the runtime's stance lock. `footLockingApplied=false` in
all three bind reports. `kimodo_stop_oneshot_station.py` needed no new flag.

## After (bound, lock refused; source as knownGood, this run's own joints)

| rig | slide median (src) | hold L/R | max step (src true) | final speed (cap) | root first->last (src change) | min toe |
|---|---|---|---|---|---|---|
| physician | 0.0184 (0.0134) | 0.0087 / 0.0086 | 0.146 (0.144) | 0.014 (0.103) | 0.897->0.926 (+0.030) | 0.005 |
| nurse | 0.0107 (0.0140) | 0.0069 / 0.0074 | 0.152 (0.155) | 0.015 (0.119) | 0.912->0.953 (+0.040) | 0.006 |
| child | 0.0075 (0.0122) | 0.0035 / 0.0041 | 0.105 (0.152) | 0.008 (0.129) | 0.619->0.658 (+0.039) | -0.014 |

Bars: median <= 0.02 and <= source+0.005 passes all rigs (physician margin 6e-5);
hold <= 0.02 passes; final speed <= 10% passes; root last within 0.05 of first plus
source change passes exactly on all rigs; min toe >= -0.01 passes physician/nurse,
child misses by 4 mm (bind sinks ~3 cm vs the source floor of 0.016 m; reported, not
tuned per rig).

## Two findings the bars tripped over, neither a bind defect

1. `maxToeStepPerFrameM <= 0.08` fails on the SOURCE itself under correct axes
(0.144 / 0.155 / 0.152 m true-horizontal swing steps at 30 fps). The cagematch's source
column (0.039 / 0.047 / 0.044) is reproduced exactly by reading horizontal+vertical
(`measure_stop_oneshot.ts` `measureSource` builds `{x:p0, y:p1, z:p2}` from the Z-up
export, then `xz()` consumes x,z). The bound reproduces the generator's swing speed
faithfully (physician 0.146 vs 0.144). The 0.08 bar comes from a turn metric and does
not fit this walk-to-stop source; judging the bind source-relatively, it preserves the
input to 0.002 m. The measure tool was NOT modified here; the axis finding is recorded
for the orchestrator.
2. Child min toe -0.014 m: 4 mm below the bar, the only per-rig miss. No per-rig
tuning was applied.

## Strips

EEVEE side views from `render_stop_strip.py` (fixed world camera, full body, 0.1 m
floor ticks), per rig, after the fix. No visual verdict here; grading belongs to the
orchestrator.

## claimScope / notEvidenceFor

claimScope: the two-line stage change (location-frame conversion; lock refusal) with
the strip regression at worstDeltaM = 0, the six measured clips with source-relative
preservation on all rigs, the falsifier numbers, and the axis-swap finding in the
measure tool.
notEvidenceFor: gait realism, clinical plausibility, Quest performance, runtime
behavior (no consumer was built), any other motion source, or the historical foot-lock
implementation ever being correct on kept-root clips.
