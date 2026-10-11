# Transition-table cagematch (phase-indexed walk->stop clips) — 2026-10-11

## Outcome

REJECT (second confirmation, round 2). With the switch-contact foot pinned over its full
remaining contact window and both feet pinned through the hold, physician worst-phase
drag is 1.103 m vs the <0.05 m bar (22.1x) and the best phase (7, treatment B) is
0.069 m (1.4x). Per the slice stop rule the nurse was not run. No runtime, package, or
shipped-GLB change. Headless, deterministic inputs (seed 1 throughout).

Round 1 (frame-0-only pins, no finger carry-through) also rejected at 21.4x; its
per-phase numbers are preserved in git history. Round 2 below supersedes it.

## Treatments (same switch frame per phase, 30-frame / 0.5 s window at 60 Hz)

- A: hard cut from the walk loop to the phase's transition clip (no alignment; the
  hypothesis under test IS frame-0 continuity).
- B: 0.1 s inertialized entry (per-bone quaternion + root position/velocity offsets,
  halflife 0.1 s, the inertialize.ts port) into the same clip.

## Numbers, round 2 (world space, GLB scene frame)

f0err = clip frame 0 vs walk pose at the switch, per-joint position error (max/mean over
22 mapped bones, m). Drag = switch-contact toe travel from its switch anchor over 0.5 s
(m). Step = max single-frame toe move, either foot (m). Rot = max per-bone local-rotation
angle from walk(S-1) to treatment output frame 0 (deg). Bars: drag < 0.05, step <= 0.08.
K = window-pin clip frames for the contact foot.

| phase | foot | K | f0err max/mean | A drag / step / rot | B drag / step / rot |
| 0 | R | 0 | 0.099 / 0.049 | 0.977 / 0.099 / 46.4 | 0.978 / 0.057 / 1.5 |
| 1 | R | 0 | 0.107 / 0.067 | 1.102 / 0.098 / 47.0 | 1.103 / 0.059 / 5.3 |
| 2 | L | 19 | 0.123 / 0.083 | 0.117 / 0.122 / 47.3 | 0.097 / 0.046 / 5.4 |
| 3 | L | 13 | 0.132 / 0.075 | 0.099 / 0.109 / 45.7 | 0.078 / 0.064 / 7.4 |
| 4 | L | 6 | 0.130 / 0.057 | 0.235 / 0.125 / 45.7 | 0.235 / 0.044 / 3.2 |
| 5 | R | 0 | 0.101 / 0.054 | 0.082 / 0.098 / 46.8 | 0.077 / 0.055 / 6.3 |
| 6 | R | 14 | 0.115 / 0.058 | 0.107 / 0.120 / 47.1 | 0.084 / 0.047 / 5.5 |
| 7 | R | 7 | 0.103 / 0.050 | 0.092 / 0.104 / 45.7 | 0.069 / 0.055 / 7.3 |

Treatment B clears the step bar on all 8 phases (0.044-0.064) and keeps rotation at
1.5-7.4 deg, but drag matches or only slightly beats A on every phase.

## The 86.8 deg bone (handback defect 1 — found, fixed, re-measured)

Named: `finger1-3.L` / `finger1-3.R` at exactly 86.82 deg on all 8 phases, with every
other fingertip segment at 77.12 deg. It is NOT an axis-convention or Hips-basis bug:
the bind drives only root + swing_pairs, so finger bones keep the exporter's baked MPFB
rest, while the walk loop holds a static grasp (measured 0.000 deg/frame over the loop;
Hips/root gap is 2.5 deg — basis exonerated). SOMA has no finger joints, so the fix
rides the MPFB side: the walk grasp stamped as constant rotation tracks post-bind
(`stamp-walk-fingers.ts`, 30 bones per phase). A maxRotDeg after fix: 45.7-47.3 deg
(driven-chain mismatch: spine04 ~47, forearm ~39 deg); B unchanged at 1.5-7.4 deg.
Frame-0 position error did NOT drop (0.099-0.132 max vs 0.097-0.125 round 1): fingers
are outside the 22 mapped bones, so the carry-through cannot move the reported metric.
Stated because the handback expected a drop.

## Why it still fails (round 2 deltas vs round 1)

The window pins are partially honored (foot deviates 7-16 cm over the window against
the pin; hold pins hold at 1-2 cm over 36 frames with 0.008 m/s final root speed) and
mid phases improve (phase 3 B drag 0.319 -> 0.078; phase 7 B 0.548 -> 0.069; phase 6 B
0.106 -> 0.084). Two structural floors remain:

1. Frame-0 floor (~10-13 cm max, 5-8 cm mean, slightly up from round 1 on some phases
   from the window-pin's smooth-root tension). The best pinned phase can only track
   its offset.
2. Zero-window phases (0, 1, 5: K = 0 — the contact ends at or before the switch) get
   no window pin by construction, and their clips step ~1 m with the wrong foot
   (drag 0.98-1.10 m). A phase-indexed table cannot constrain a foot it cannot pin.

## What was built (pose source, stated per the correction)

No inverse solver existed; the shipped walk loop (`openclinxr_retarget_walk_source`, a
mesh2motion library retarget, not Kimodo) has no SOMA source take. Built the directed
inverse from the named pieces only: MPFB FK at phase p -> canonical via
`mpfb2-default-no-toes.json` -> SOMA via `kimodo-soma-skeleton30.json`; limb directions
from the MPFB pose with SOMA rest lengths (exact inverse of the bind's swing retarget);
girdle links (Hips->Spine1/Legs, Chest->Shoulders) keep SOMA rest direction because
MPFB `root` sits level with the thigh heads and yields horizontal non-limb vectors
(measured 0.43 m fk error before this fix); hip-height scale undone about the root
(ratio 0.9447729 from the shipped physician bind report); Hips orientation from the
MPFB pelvis basis; Chest Kabsch over its 3 outgoing; glTF->Blender (x,-z,y) mapping
verified bit-exact against a headless-Blender import.

Constraint form round 2: generic `end-effector` dict at frame 0 pinning
Hips/LeftFoot/RightFoot/LeftHand/RightHand (+ chains), PLUS the switch-contact foot
pinned at its frame-0 SOMA position over every frame of its remaining walk-contact
window (dedicated foot-subclass dicts, K = round(walkFrames/2): 0,0,19,13,6,0,14,7),
PLUS both feet pinned at standing-rest offsets from the path-end root over hold frames
42..77, plus the full root2d path (walk 0.3 s at 1.03 m/s, cosine decel 1.1 s, hold
1.2 s, translated to the frame-0 root). Head is not pinnable (expand_joint_names
supports only the five bases; read from kimodo/skeleton/base.py). Locals in the EE
dicts come from the swing math against the SOMA rest skeleton (from_dict FKs
local+root, so full locals are required). Known tension, stated: the window pin's EE
side-effect holds smooth_root_2d frozen while root2d moves it over frames 1..K.
8 clips, seed 1, 20 diffusion steps, 5 constraint sets each; bound with root motion
kept, no foot lock (2026-10-09 refusal rule), yaw from net root travel (phases 3 and 4
rebound at -7.1/-5.5 deg under the station pattern; rest single-pass), walk-finger
carry-through post-bind.

## What survives this

- The directed inverse (`build-frame0-constraints.py`) is verified: fk reconstruction
  ~3 cm worst, loader round-trip 1e-6, all 8 phases. Reusable wherever a walk pose must
  enter Kimodo-space.
- Kimodo honors static foot pins well in the hold (1-2 cm) and partially over the
  window (7-16 cm against a moving root). The hold-pin pattern is sound; the window
  pin fights root motion by construction.
- Treatment B (0.1 s inertialized entry) clears step and rotation on all phases in both
  rounds. Any future transition work starts from B, not A.
- The undriven-finger rest fallback is now a named, measured trap (86.82 deg constant
  across phases) with a working carry-through fix.

## Follow-ups (not done here)

- The binding constraint is clip-trajectory control for the stepping foot, not
  blending: the zero-window phases have nothing to pin, and the best pinned phase
  still fails 1.4x on the frame-0 floor.
- Determinism rerun (two-run bit-identity, per the inertialize precedent) was not done.

## Artefacts

- `.openclinxr/evidence/transition-table/report.json` (schema
  `openclinxr.transition-table-cagematch.v1`, round 2 verdict + per-phase table;
  git-ignored generated evidence, as are the 8 npz / joints / bound GLBs beside it).
- `tools/openclinxr/evidence/foot-plant/transition-table/` (sampler, constraint
  builder, bind driver, finger stamp, harness; tracked).
- Rerun: builder (kimodo venv python) -> generate x8 -> bind driver (exports, binds,
  stamps) -> `mise exec -- tsx .../transition-cagematch.ts`.
