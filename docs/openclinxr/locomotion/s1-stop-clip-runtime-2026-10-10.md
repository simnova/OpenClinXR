# S1 stop-clip runtime 2026-10-10 — baked root-motion stop in the bedside approach

verdict: `pass_some_rigs`.
verdictReason: the physician clears every bar numerically without ever engaging (deterministic
phase miss on this route — its row is legacy behavior, not a passing stop); the nurse and
child engage with arrival fixed (0.025/0.036 m, both inside baseline + 0.01) but miss slide
and step bars. No rig demonstrates a passing stop; the t0 fix works where it fires.

## Stage 1 clips (seed 42, cagematch prompt/constraints; lock refused by the stage)

| rig | clip | full D (m) | duration | entry foot (export) | exit | yaw correction (deg) |
|---|---|---|---|---|---|---|
| physician | openclinxr_retarget_kimodo_stop_physician | 2.543 | 5.5 s, 132 keys, 24 fps | left | both (hold) | 15.036 |
| nurse | openclinxr_retarget_kimodo_stop_nurse | 3.036 | 5.5 s, 132 keys, 24 fps | left-partial | both (hold) | 33.913 |
| child | openclinxr_retarget_kimodo_stop_child | 2.251 | 5.5 s, 132 keys, 24 fps | none at frames 0-1, left from frame 2 | both (hold) | 176.414 |

Full D is net horizontal root travel over the whole take (it opens with 2 s of steady walking).
Scratch GLBs under `.openclinxr/evidence/s1-stop/` carry the shipped walk take plus the stop
take; shipped GLBs are untouched (licence section below).

## Runtime entry offset (handback fix 1)

The runtime never replays the take's opening walk. At load time, per clip, from its own keys:

- root speed per key interval; steady speed = median over the first half;
- decel onset = first key time at or after 1.0 s dropping below 95% of steady with the next
  second's median confirming (confirmation skips stride wobble crossing 95% mid-walk);
- hold onset = first time at/after onset below 2% of steady;
- t0 = start of the last entry-foot stance window (one-shot labels) beginning before onset;
  null (legacy fallback) when no window qualifies or the clip never decelerates.

| rig | decelOnsetS | t0S | holdOnsetS | D_eff (m) |
|---|---|---|---|---|
| physician | 2.917 | 2.729 | 3.958 | 0.403 |
| nurse | 2.917 | 2.729 | 3.833 | 0.493 |
| child | 2.875 | 2.729 | 3.875 | 0.353 |

t0 lands on the same calibration-grid sample on all rigs (similar generator cadence, same
seed) — derived per rig, never a constant. D_eff is smaller than the brief's rough estimate
because the last pre-decel left window starts ~0.2 s before onset, not a full stride back.
Playback starts at t0 (action time, label time, prescription origin, no-root freeze key);
the stop ends at clip end. No per-rig constants anywhere in this chain.

## Trigger rule and residual bound

Walking hands to stopping when the actor carries a stop take, remaining route fits inside
D_eff, and the walk loop's stance pair equals the stop take's pair at t0. Phase mismatch keeps
walking. A no-foot entry never fires. The legacy close-range check runs first. The implemented
bound stands: residual past the trigger point is bounded by one full walk-loop cycle of
travel, v_walk * T_cycle; if the pair never recurs the legacy check still ends the walk.

| rig | residual (m) | bound (m) | engaged |
|---|---|---|---|
| physician | n/a (never fired) | 1.370 | no — deterministic miss, see below |
| nurse | 0.0110 | 1.434 | yes |
| child | 0.0011 | 0.851 | yes |

Physician race (design finding): D_eff/v opens a ~0.5 s distance window while the walk cycle
runs ~1.67 s, and on this fixed route/phase alignment no left-only walk sample falls inside
it — the conjunction is unsatisfiable here, so the legacy ending runs (safe fallback, verified
identical numbers). Engagement is alignment-dependent per approach, not rig-dependent; the
wiring itself resolves on all rigs (clip, entry, D_eff reported).

## Slot ownership per phase

- walking: executor prescribes along-route advance; slot follows prescription; skeleton plays
  the walk take; stance lock reads walk labels.
- stopping: the stop take owns slot XZ from t0 (slot = trigger + span travel rotated by the
  span-net yaw; heading stays travel heading). The mixer plays a t0-frozen root-removed clone
  at rate 1 while the slot carries the travel. Walk fades 1 to 0 over 0.25 s while the stop
  fades 0 to 1; the walk take itself is never stopped, so its time stays continuous for the
  settling turn. The stance lock reads the stop take's one-shot labels. The walk-phase chain
  claim stays in place.
- settling: entered at clip end with the legacy snapshot. A 0.3 s settle-blend morphs hold
  into stride (stop fades, walk grows from a zeroed ramp seed, consumer stands down, ramp
  synced at blend end); the clip-driven turn waits out the blend so it never pivots on
  morphing poses with a fresh pin, then starts on converged poses. Unchanged code path after.
- No stop take on the actor: the wiring resolves null and every branch keeps legacy behavior.
  Proven headless: stop-disabled control rows on the same scratch bytes match pre-fix to 1e-9
  on all rigs.

## Before/after table (headless assay, same instrument both columns)

Bars: arrival <= pre + 0.01; yaw <= 2 deg; plantedSlide <= pre + 0.005; stop-stance step
<= 0.02; maxToeStep <= pre + 0.02.

| rig | arrival pre -> post (bar) | yaw | slide pre -> post (bar) | stop stance step (bar) | hold window step (bar) | maxToeStep pre -> post (bar) |
|---|---|---|---|---|---|---|
| physician (legacy) | 0.15883 -> 0.15883 (0.16883) PASS* | 0 PASS | 0.12002 -> 0.12002 (0.12502) PASS* | n/a | n/a | 0.06795 -> 0.06795 (0.08795) PASS* |
| nurse | 0.13021 -> 0.02534 (0.14021) PASS | 0 PASS | 0.13603 -> 0.21020 (0.14103) FAIL 1.5x | 0.05619 (0.02) FAIL 2.8x | 0.02000 (0.02) PASS | 0.11725 -> 0.29156 (0.13725) FAIL 2.1x |
| child | 0.13815 -> 0.03623 (0.14815) PASS | 0 PASS | 0.08271 -> 0.13981 (0.08771) FAIL 1.6x | 0.02087 (0.02) FAIL 1.04x | 0.00471 (0.02) PASS | 0.40363 -> 0.22781 (0.42363) PASS |

\* vacuous: the feature never engaged; values are the legacy path. Settle durations:
nurse 2.233 / child 1.983 s. Stop frames: 164 each (~2.73 s played span).

Post arrival on engaged rigs lands within centimeters of the trigger point plus residual
(nurse 0.025, child 0.036): the prescription lands along-track and the overrun is gone.

## Snap localization (handback fix 2)

Max-jump frames before (full-D run) and after (t0 run):

| rig | snap before (frame/value/phase) | snap after (frame/value/phase) |
|---|---|---|
| physician | 338 / 0.3569 / settling | n/a (never engaged; max 0.068 walk stepping) |
| nurse | 338 / 0.4146 / settling | 220 / 0.2916 / settling entry |
| child | 338 / 0.3375 / settling | 273 / 0.2278 / settling entry |

The maxima were never the walk-to-stop crossfade: stopping-phase steps stay <= 0.069 m on
every rig (the 0.25 s entry blend is smooth; entry needed no fix). Both before and after, the
max sits on the stopping-to-settling edge — an instrument fade-branch pin/IK settle on fresh
state, the same artifact class as the budgeted walk-to-settling snap. Fix taken: the
time-aligned crossfade (settle-blend + turn suppression + close-driven settling, assay
mirrors production weights), not walk-loop phase alignment — the brief's other option, stated
here. Phase alignment at entry was declined: entry steps already pass comfortably and waiting
for phase would cost arrival on an already-tight D_eff window.

stopStanceStepM after the fix (0.056/0.021): entry-blend excursion between two different
takes (walk mid-stance vs stop@t0 late-walk poses morphed over 0.25 s) plus walk-portion
stepping. The hold windows themselves pass (0.0200/0.0047 vs 0.02).

## One-shot labeling findings (product changes)

Loop-tuned stance labels misread a walk-to-stop take three independent ways; all three are
fixed without touching the loop path (control rows prove it):

1. Wrap poison: central differences across the cycle wrap read the full clip travel as one
   frame's foot speed and unlabel both end samples. One-shots differentiate one-sided at the
   ends (`cyclic: false`, default true keeps loops identical).
2. Median inversion: the sample median over a stop take is the standing hold (~0.02 m/s),
   which unlabels the whole walk portion as overspeed. One-shots label against an explicit
   [0, +inf) band under their own envelope height cut: a stopping foot steps, stands, or
   reverses at touchdown/liftoff. (A walk-band transfer was tried first; the stop walk
   portions outrun the shipped walk band on two rigs.)
3. Hold forward: the longest near-floor run is the hold, a noise direction. One-shot forward
   is the net root-travel vector (span vector for rotation).

Measured frame-0 backward speeds along net travel (m/s): physician L 0.88 / R 0.27; nurse L
1.01 / R 0.77; child L 0.72 / R 0.65 — all three start in genuine left stance by motion
(the child export's all-zero frames 0-1 are stricter than the motion).

Assay mirror rules: synthetic stop toes are travel-removed (decoded world minus root XZ
travel, index-wise with a count-mismatch refusal; index 0 subtracts nothing). Replaying
world toes under the moving slot double-counts travel (measured: a 2.44 m single-frame
teleport). Post-stop, the assay leaves markers mixer- and close-driven (no manual rest) so
the production arrival close converges them gradually instead of snapping; walk-case runs
keep byte-for-byte behavior.

## Locomotion orders

Order-driven walkers instantiate the same producer (`createCaseOwnedApproachForOrder` through
`advanceCaseOwnedBedsideApproach`/`applyCaseOwnedStanceLock`), so they inherit the stop
wherever the actor carries a stop take; the order-active flag covers stopping. Not exercised
headless in this slice.

## Stage 4 capture (physician, GLB override)

`foot-plant-video-capture.ts --humanoid=.openclinxr/evidence/s1-stop/physician-stop.glb` served
the scratch bytes (sha 7c542f46, 6 requests) without touching shipped assets. Phases
walking -> settling -> arrived: the stop did not engage in the browser either (same
deterministic phase miss on this route). Artifacts under `.openclinxr/evidence/s1-stop/`:
feet-side.mp4 + feet-side.webm (+ slow + three-quarter + contact sheet + report JSON) and 6
native-resolution stills spanning the approach end. They document the legacy path with the
stop GLB loaded, not a stop. No visual verdict here.

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

The stopping phase, t0/onset/hold measurement, one-shot labels, entry/settling blends, turn
suppression during the blend, the assay mirror rules and close-driven settling, the
before/after numbers, the race analysis, and the licence block.
notEvidenceFor: gait realism, clinical plausibility, Quest performance, browser behavior
beyond the one capture, any other motion source, production readiness of the clips, or
redistribution clearance.

## Files and commits

Stage 0: pre-fix.json (c3f9c6bf0). Stage 1: scratch stop GLBs + provenance (uncommitted,
gitignored). Stage 2: stopping phase, wiring, consumer gates, phase-machine unit tests
(ecef2aefc). Stage 3: one-shot labels, assay rows, first measurements (5fca60423). Handback:
t0 machinery, settle-blend, assay fidelity, capture, this write-up (this commit).
