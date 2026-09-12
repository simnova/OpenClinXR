# SC-05 follow-up — terminal turn replants without stance-foot drag

Card `tsk_acc431bda6914e71`. This is an SC-05 quality follow-up. It does **not** claim browser A08
closure.

Execution revision at measurement: `b4d6215f8acfe536a32db6d94866c74885ca44de` (worktree HEAD before
this slice's commit; bind the landing SHA after integrate). Producer-owned hashes of the motion
code this slice changed:

| path | sha256 |
|---|---|
| `packages/openclinxr/xr-humanoid-animation/src/settling-step-turn-mod.ts` | `9bad3b7754df24cdfffa65a5ace2a23936449a25511da1ebbe56fab32ac62e87` |
| `packages/openclinxr/xr-humanoid-animation/src/case-owned-approach-runtime-mod.ts` | `6724787df44ebf98ce15f562c651ddb73de89fd7655b12da7e295133b60b384a` |
| `packages/openclinxr/xr-humanoid-animation/src/stance-lock-mod.ts` (unchanged) | `415cd6dc3af6e240431819b99491e9ebbb7222316c5b83073290eb3ac5d0f892` |

`stance-lock-mod.ts` remains the walk-interval slot XZ translator. It is still disabled when
locomotion is zero. The turn does not add a second root translator.

## RED (a02f3b1b, `measureShippedApproach()`, 60 Hz, shipped physician)

| interval | foot-slide | observed |
|---|---|---|
| walk | SATISFIED | both toes 0 m total and 0 m worst frame |
| stop | SATISFIED | 0 m |
| terminal turn | VIOLATED | left total 0.17512 m, right total 0.21127 m, right worst frame 0.03615 m |
| whole run | VIOLATED | only because of the turn |

Arrival 0.01474 m, heading 0 deg, stopped 7.183 s, root travel 0 m. Walk and stop already behaved.
The defect was confined to the terminal turn: rest-pose toes stayed in the 0.06 m contact band while
the slot yawed.

## Treatment

No rights-cleared stepping/turn take is on the shipped physician (`openclinxr_retarget_walk_formal_cc0`
only; CMU walk retired SC-04; Mesh2Motion clip library is CC0 on disk but no turn clip is bound into
this GLB). Orange Duck GenoView-InverseKinematics is first-party MIT and was not imported as a
dependency this slice.

The settle phase now poses an explicit alternating release and replant after mixer/rest evaluation:
one toe stays at a world XZ anchor by writing **local** plant pose; the swing toe is lifted above
the contact band (`FOOT_CONTACT_HEIGHT_METERS + 0.05`). Slot XZ is not written. Chain claim uses
the locomotion owner if that owner already holds the bones, otherwise `openclinxr.settling-step-turn`.
A second owner id does not overlap. `solveArmChain` is not the leg API.

Walk-to-turn and turn-to-stop seams break contact with one airborne frame so a rest-pose snap is
not scored as planted-foot travel.

## GREEN (`measureShippedApproach()`, same instrument, unchanged SC-00 limits)

| interval | foot-slide | observed |
|---|---|---|
| walk | SATISFIED | both toes windows=4 total=0.00000 m worst=0.00000 m |
| terminal turn | SATISFIED | both toes windows=3 total=0.00000 m worst=0.00000 m |
| stop | SATISFIED | both toes windows=1 total=0.00000 m worst=0.00000 m |
| whole run | foot-slide SATISFIED | failedMetrics remain `support-contact`, `support-penetration` only (standing physician; not support metrics) |

Arrival 0.01474 m (<= 0.05), heading 0 deg (<= 10), stopped 7.183 s (>= 2), root travel 0 m (<= 0.005).
Walk 187 frames, settle 101 frames. Turn contact labels are not all-airborne: each toe has 3 plant
windows and airborne swing frames.

## Browser capture

Ordinary `ui-xr-bedside-approach-capture.ts` was rerun on 2026-09-12 in this worktree
(`waitTimedOut: true`, 240 s). The page booted the matching bundle
(`scene_closure_supine_bedside_v1`) and loaded generated humanoids, then published bedside
telemetry with `driveSource: null`, `phase: null`, 0 skeleton samples. Arrival/heading/stop were
therefore unmeasured on that run. Foot-slide outcome `not_gradeable` (0 usable intervals). This
worktree does not carry a complete UI-XR evidence checkout; node observations do not substitute
for rendered browser samples. Historical SC-05 retained capture remains ~8 Hz with max/median
frame-gap 2.82 against a frozen limit of 2, so browser A08 stays open. This card does not close A08.

## SC-07-09 handoff

The SC-07-09 bounded source lists currently omit `stance-lock-mod.ts`,
`case-owned-approach-runtime-mod.ts`, `settling-step-turn-mod.ts`, and the bedside execution
modules. An impact note does not authenticate omitted logic. This card does not edit those
contracts.

## notEvidenceFor

Browser A08 foot-slide verdict; Quest readiness; clinical gait validity; that a rights-cleared
turn/stepping take exists to import.
