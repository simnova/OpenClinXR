# S1 stop-clip runtime 2026-10-10 — baked root-motion stop in the bedside approach

verdict: `pass_some_rigs`.
verdictReason: distance-indexed stop engages on all three rigs (the phase-match trigger and
speed-steering laws are deleted). Arrival clears baseline + 0.01 on physician (0.109) and
child (0.089); the nurse arrives 0.258 m off because the stance lock chases the take's own
lateral veer during stopping (lock-off control: prescription exact, across 0.000). maxToeStep
clears baseline on nurse (0.075) and child (0.056); the physician reads 0.130 on entry-blend
swing excursion between two different takes. Full pass (engaged + arrival + step) on the
child; the LoopOnce clamp fix from the previous round is kept.

## Stage 1 clips (seed 42, cagematch prompt/constraints; lock refused by the stage)

| rig | clip | full D (m) | duration | entry foot (export) | exit | yaw correction (deg) |
|---|---|---|---|---|---|---|
| physician | openclinxr_retarget_kimodo_stop_physician | 2.543 | 5.5 s, 132 keys, 24 fps | left | both (hold) | 15.036 |
| nurse | openclinxr_retarget_kimodo_stop_nurse | 3.036 | 5.5 s, 132 keys, 24 fps | left-partial | both (hold) | 33.913 |
| child | openclinxr_retarget_kimodo_stop_child | 2.251 | 5.5 s, 132 keys, 24 fps | none at frames 0-1, left from frame 2 | both (hold) | 176.414 |

Full D is net horizontal root travel over the whole take (it opens with 2 s of steady walking).
Scratch GLBs under `.openclinxr/evidence/s1-stop/` carry the shipped walk take plus the stop
take; shipped GLBs are untouched (licence section below).

## Distance-indexed stop (handback fix 3, replaces phase matching)

Phase-matched triggers cannot guarantee engagement: with the clip rate coupled to ground
speed, the phase-matched entry advances at the clip's own speed, so every speed law scales
both sides of the meeting together. The stop clip is now driven by distance remaining:

- At load, per clip, from its own keys: root speed per interval; steady = median first half;
  decel onset = first key at/after 1.0 s below 95% of steady with next-second median
  confirm; hold onset = first time at/after onset below 2% of steady (onset derivation
  unchanged from the previous round).
- R(t) = root XZ path-length-to-end over [tEarliest, end], non-increasing by construction.
  tEarliest = one walk cycle before decel onset, snapped to the latest entry-foot
  stance-window start at or before that time (raw time, then latest pre-onset start, as
  fallbacks). Null (legacy fallback) when the clip never decelerates, no window qualifies,
  or the span deviates from its chord by more than 0.1 m.
- Entry: on the final straight leg, first frame with rDecel <= remaining <= Rmax, at
  t0 = R^-1(remaining). No stance gate. Routes shorter than R(decelOnset) stay legacy.
- Stopping: the slot advances procedurally at the clip's own root path speed at the current
  clip time along the route (slot XZ never overwritten from the clip root); each frame sets
  clip time t = R^-1(remaining), clamped monotone, never rewinding. Pose comes from the
  root-removed take at t (mixer action timeScale 0 with an explicit set per frame; the
  LoopOnce clamp from the previous round is kept). Ends at clip end, at the hold, or at
  remaining zero — whichever comes first — with the legacy settling snapshot.
- Entry crossfade walk -> stop over 0.25 s with BOTH takes advancing (walk by loop rate,
  stop by distance); the stance lock reads walk labels during the fade and the stop take's
  one-shot labels after it.

| rig | decelOnsetS | tEarliestS | holdOnsetS | Rmax = R(tEarliest) (m) | route 1.306 m inside range |
|---|---|---|---|---|---|
| physician | 2.917 | 1.250 | 3.958 | 1.641 | yes |
| nurse | 2.917 | 0.000 | 3.833 | 3.068 | yes |
| child | 2.875 | 0.000 | 3.875 | 2.266 | yes |

Deleted (not left disabled): the phase-match trigger, the distance-matching speed laws and
rate bounds, entry-candidate competition, `walkSpeedFactor`/`walkStance` plumbing,
`actionTimeToStancePair`, `pairRunStarts`, `stopEntryTimeS`.

## Slot ownership per phase

- walking: executor prescribes along-route advance at walk speed; skeleton plays the walk
  take; stance lock reads walk labels.
- stopping: slot advances procedurally at the clip path speed; the mixer poses the
  tEarliest-frozen root-removed take at the distance-derived time (timeScale 0, set per
  frame); walk fades 1 to 0 while the stop fades 0 to 1 over 0.25 s. Lock reads walk labels
  through the fade, stop labels after. The walk-phase chain claim stays in place.
- settling: entered at clip end/hold/remaining-zero with the legacy snapshot. A 0.3 s
  settle-blend morphs hold into stride (stop fades, walk grows from a zeroed ramp seed,
  consumer stands down, ramp synced at blend end); the clip-driven turn waits out the blend.
  Unchanged code path after.
- No stop take on the actor: the wiring resolves null and every branch keeps legacy
  behavior. Proven headless: stop-disabled control rows on the same scratch bytes match
  pre-fix to 1e-9 (0.00e+00) on arrival and maxToeStep on all rigs.

## Before/after table (headless assay, same instrument both columns)

Bars: engaged on all rigs; arrival <= pre + 0.01; maxToeStep under pre. Slide and
stop-window stance steps reported (slide was already 4-6x over the 0.02 hold bar on the
legacy column; the hold window itself passes everywhere).

| rig | engaged / Rmax / t0S | arrival pre -> post (bar) | maxToeStep pre -> post (bar) | stop stance step | hold window step | slide post |
|---|---|---|---|---|---|---|
| physician | yes / 1.641 / 1.680 | 0.15883 -> 0.10873 (0.16883) PASS | 0.06795 -> 0.13039 FAIL | 0.11341 | 0.00000 | 0.19872 |
| nurse | yes / 3.068 / 1.949 | 0.13021 -> 0.25755 (0.14021) FAIL | 0.11725 -> 0.07490 PASS | 0.06636 | 0.00022 | 0.25809 |
| child | yes / 2.266 / 1.440 | 0.13815 -> 0.08892 (0.14815) PASS | 0.40363 -> 0.05563 PASS | 0.03085 | 0.00055 | 0.12772 |

Stop frames 131/105/141; walk frames 1 (entry on the first walking frame: the whole route
is the final straight leg and starts inside R's range); yaw error 0 everywhere.
Per-phase slot decomposition: nurse veers +0.250 across-route DURING stopping (settling
adds 0.008); physician/child stop on-route (across <= 0.008) and the settling turn carries
them +0.126/+0.104 along-route past the stop-end point.

## Why the two misses are take-bound, not tuning

- Nurse arrival: with the stance lock disabled the prescription ends the stop on-route
  (across 0.000, arrival 0.015 on all three rigs — R and the advance are exact). With the
  lock on, it follows the take's lateral motion sideways (+0.250). The take veers in its own
  frame; the lock is correct to keep planted feet planted, and the slot pays for it. No
  runtime law changes take content (regeneration is out of scope: generation killed,
  licence blocked).
- Physician maxToeStep: the 0.130 maximum is swing excursion across the entry morph
  (walk pose vs stop@t0 differ by ~0.7 m on the right foot; the 0.25 s morph at full rate
  steps ~0.11-0.13/frame). Production shows the same morph with the same weights — the
  assay mirrors them exactly (see below) — so this is the honest cost of switching takes
  without phase alignment, which the design forbids reintroducing.

## One-shot labeling findings (kept product changes)

Loop-tuned stance labels misread a walk-to-stop take three independent ways; all three are
fixed without touching the loop path (control rows prove it):

1. Wrap poison: central differences across the cycle wrap read the full clip travel as one
   frame's foot speed and unlabel both end samples. One-shots differentiate one-sided at the
   ends (`cyclic: false`, default true keeps loops identical).
2. Median inversion: the sample median over a stop take is the standing hold (~0.02 m/s),
   which unlabels the whole walk portion as overspeed. One-shots label against an explicit
   [0, +inf) band under their own envelope height cut.
3. Hold forward: the longest near-floor run is the hold, a noise direction. One-shot forward
   is the net root-travel vector.

Assay mirror rules (production weights, same advancing takes): synthetic stop toes are
travel-removed then re-based onto root(tEarliest), matching the frozen production clone
(raw travel removal teleports 0.9 m at entry); the entry morph blends walk->stop over 0.25 s;
the settle-blend morphs hold->stride at production weights (0.4 leg weight, remainder on
the rest-frame bound proxy); post-blend turn stepping poses at the 0.4 mix; the drive-0
fade morphs to rest. Walk-case runs keep byte-for-byte behavior (all new branches gate on a
decoded stop take plus a fired stop).

## Locomotion orders

Order-driven walkers instantiate the same producer (`createCaseOwnedApproachForOrder` through
`advanceCaseOwnedBedsideApproach`/`applyCaseOwnedStanceLock`), so they inherit the stop
wherever the actor carries a stop take; the order-active flag covers stopping. Not exercised
headless in this slice.

## Stage 4 capture (physician, GLB override)

The previous round's capture (`foot-plant-video-capture.ts --humanoid=physician-stop.glb`,
sha 7c542f46) documented the legacy path with the stop GLB loaded (deterministic phase
miss then). Under this design the stop engages on the assay route from the first walking
frame, so a recapture should show walking -> stopping -> settling -> arrived; it also
exercises the browser-only distance-driven mixer path (timeScale 0 + per-frame set), which
the headless assay never creates. Capture runs after this commit; artifacts land under
`.openclinxr/evidence/s1-stop/`.

## Shipping blocked on licence decision

The verdict above is about motion behavior in scratch only. Per
docs/openclinxr/scene-closure-2026-09-09/evidence/sc-10.md, the Kimodo SOMA-RP training-data
terms are unpublished, and clearing generated output for shipped bytes is an operator
decision (taken to the operator separately). The NVIDIA Open Model License §2.4 (version
2025-10-24) states "NVIDIA claims no ownership rights in outputs," which does not settle
redistribution clearance for this project. The graft tooling refused the publish at the
SC-04 licence gate; the publish was reverted; shipped GLBs carry no stop take. The runtime
path is inert until a stop take ships in an actor GLB with a cleared licence record.

## claimScope

The R(t) curve and tEarliest derivation, stance-free entry, procedural stopping advance
with monotone R^-1 clip time, distance-driven mixer action with the LoopOnce clamp,
stance-after-fade lock discipline, the assay mirror rules, the before/after numbers, the
lock-off and decomposition analyses, the deleted matcher record, and the licence block.
notEvidenceFor: gait realism, clinical plausibility, Quest performance, browser behavior
beyond the one capture, any other motion source, production readiness of the clips, or
redistribution clearance.

## Files and commits

Stage 0: pre-fix.json (c3f9c6bf0). Stage 1: scratch stop GLBs + provenance (uncommitted,
gitignored). Stage 2: stopping phase, wiring, consumer gates, phase-machine unit tests
(ecef2aefc). Stage 3: one-shot labels, assay rows, first measurements (5fca60423).
Handback t0 + distance matching + LoopOnce clamp (0a79a28cf). This commit: distance-indexed
redesign (R curve, stance-free entry, procedural advance, matcher deletion), mixer
distance-drive test, assay fidelity blends, this write-up.
