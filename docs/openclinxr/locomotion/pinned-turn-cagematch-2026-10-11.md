# Pinned-turn cagematch: Kimodo in-place arrival turn with every planted step pinned (2026-10-11)

Verdict: REJECT. No runtime code changed. Evidence: `.openclinxr/evidence/pinned-turn/`
(`control.json`, `rest-pose-physician.json`, `pass1/`, `pass2-seed*/`, `row-pass1.json`,
`row-pass2-seed1.json`, `report.json`).

## Why this slice exists

The in-place arrival turn (62.67 deg on the SC-05 bedside route) is where every approach
design loses its slide budget, and the room cannot fit a path that arrives facing the
patient (`arrival-turn-cagematch-2026-10-11.md`). Kimodo-baked turns dragged the pivot foot
0.10-0.25 m because nothing pinned it (`approach-take-2026-10-11.md`). In the
transition-table cagematch, per-frame foot pins cut drag sharply on most phases
(`transition-table-cagematch-2026-10-11.md`). Hypothesis: generate the turn as a
standalone take with frame 0 pinned to the arrived pose and every contact window pinned
at its window-start position, then play it in place of the settling turn.

## Control (known-good column, bit-identical to the arrival-turn assay)

| rig | residual (deg) | settling slide (m) | whole slide (m) | max toe step (m) |
|---|---|---|---|---|
| physician | 62.67 | 0.1200 | 0.1200 | 0.0679 |
| nurse | 62.15 | 0.1360 | 0.1364 | 0.1172 |
| child | 62.95 | 0.0827 | 0.4580 | 0.4036 |

Arrival probe: first settling frame 92, arrival point (-0.799, 1.132), arrival heading
117.33 deg = travel heading, delta +62.67 deg. The runtime snaps settling-entry markers
to the walk-clip rest frame (verified to ~1 mm in world space), so frame 0 is that pose.
Rest sampler toes match the SC-00 decoder to 5 decimals. Inverse round-trip pose error:
max 0.0315 m, mean 0.0158 m over 30 SOMA joints; loader round-trip 1.35e-06.

## What was built

- `build-pinned-turn-constraints.py`: imports the transition-table MPFB->SOMA inverse
  (single source of truth); assembles frame-0 EE pin + dense constant root2d with a
  cosine heading ramp (stand 0.5 s, turn 1.8 s, hold 1.2 s, 105 frames) + optional
  per-window foot-subclass pins (frozen frame-0 locals, root rigidly translated so FK
  lands exactly on the window-start foot; verified per window to ~1e-6).
- Turn request negated for the approach-take bind yaw-mirror calibration; sign verified
  after the bind (pass-1: source -90.0 deg -> bound +98.6 deg, mirror holds in sign).
- `pinned-turn-harness.ts`: replays the production walk bit-identically, plays the bound
  take at the arrival point/heading with a 0.1 s inertialized entry, then holds. Facing
  follows the pelvis (hip-vector) yaw: the MPFB root rotation does not carry the turn
  (pass-1 root net +14.2 deg vs hips +98.6 deg), so a root-rotation proxy was refused.

## Numbers (physician)

| take | turn slide (m) | whole (m) | resid (deg) | drift (m) | max step (m) | eligible |
|---|---|---|---|---|---|---|
| pass-1 (unpinned, seed 1) | 0.2987 (14.9x) | 0.2987 (3.3x) | 35.94 (18x) | 0.669 (6.7x) | 0.0614 pass | no |
| pass-2 (pinned, seed 1) | 0.0790 (3.9x) | 0.0997 (1.1x) | 64.01 (32x) | 0.830 (8.3x) | 0.0614 pass | no |

Bars: turn-phase per-window slide <= 0.02, whole <= control - 0.03 (0.09),
residual <= 2 deg, max step <= control + 0.02 (0.0879), drift <= 0.10 m.
Parentheses give measured/bar ratios. Pins cut slide 0.30 -> 0.08 m but collapsed
the turn (source -90.0 -> -0.7 deg) and left drift at 0.83 m. Seeds 2-4 eliminated
source-side (turns +1.96/+4.34/-1.60 deg, drift ~1.02 m); the eligible set is empty.

## Why it fails (three floors, all measured)

1. The frame-0 EE pin is honored only to 0.36 m (entry offset, both takes): generation
   treats the arrived pose as a suggestion, so the take opens with a 0.1 s,
   0.36 m inertialized morph — the entry-morph slide pattern from the approach take.
2. Pass-1 walks the root 0.83 m despite a static root2d path, so window-start pins sit
   up to 1.10 m apart with 0.15-0.19 m toe residuals at build time: the pin set bakes
   the walk in and contradicts itself plus the root path. The diffusion resolves the
   fight by dropping the heading ramp (all four pinned seeds turn ~0 deg).
3. The bind shears the turn into the legs (root +14 vs hips +99 deg): even the
   over-turned pass-1 take is a leg-scissor around a near-fixed root, not a body turn.

## Decision

REJECT. The physician fails four of five bars by more than 2x on both takes; per the
slice stop rule the nurse and child were not run. No runtime, package, or shipped-GLB
change. Prompt, seeds, and selection rule are recorded in `report.json`.
