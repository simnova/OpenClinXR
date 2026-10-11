# Transition-table cagematch (phase-indexed walk->stop clips) — 2026-10-11

## Outcome

REJECT. Per-phase baked transition clips do not fix the walk-to-stop foot drag on the
physician. Worst-phase drag is 1.068 m vs the <0.05 m bar (21.4x) and the best phase
still fails at 0.089 m (1.8x). Per the slice stop rule (fail by more than 2x on the
worst phase) only per-phase numbers are reported; the nurse was not run. No runtime,
package, or shipped-GLB change. Headless, deterministic inputs (seed 1 throughout).

## Treatments (same switch frame per phase, 30-frame / 0.5 s window at 60 Hz)

- A: hard cut from the walk loop to the phase's transition clip (no alignment; the
  hypothesis under test IS frame-0 continuity, so aligning would hide the mismatch).
- B: 0.1 s inertialized entry (per-bone quaternion + root position/velocity offsets,
  halflife 0.1 s, the inertialize.ts port) into the same clip.

## Numbers (world space, GLB scene frame)

f0err = clip frame 0 vs walk pose at the switch, per-joint position error (max/mean over
22 mapped bones, m). Drag = switch-contact toe travel from its switch anchor over 0.5 s
(m). Step = max single-frame toe move, either foot (m). Rot = max per-bone local-rotation
angle from walk(S-1) to treatment output frame 0 (deg). Bars: drag < 0.05, step <= 0.08.

| phase | foot | f0err max/mean | A drag / step / rot | B drag / step / rot |
| 0 | R | 0.099 / 0.059 | 0.905 / 0.098 / 86.8 | 0.905 / 0.055 / 2.0 |
| 1 | R | 0.106 / 0.069 | 1.067 / 0.102 / 86.8 | 1.068 / 0.058 / 5.2 |
| 2 | L | 0.115 / 0.079 | 0.118 / 0.109 / 86.8 | 0.118 / 0.059 / 5.4 |
| 3 | L | 0.125 / 0.076 | 0.319 / 0.103 / 86.8 | 0.319 / 0.064 / 7.3 |
| 4 | L | 0.113 / 0.061 | 0.825 / 0.112 / 86.8 | 0.825 / 0.054 / 3.1 |
| 5 | R | 0.097 / 0.059 | 0.089 / 0.100 / 86.8 | 0.089 / 0.056 / 6.3 |
| 6 | R | 0.104 / 0.067 | 0.106 / 0.107 / 86.8 | 0.106 / 0.061 / 5.5 |
| 7 | R | 0.103 / 0.054 | 0.548 / 0.114 / 86.8 | 0.548 / 0.055 / 7.3 |

Treatment B clears the step bar on all 8 phases (0.054-0.064) and keeps rotation at
2-7 deg, but drag is identical to A on every phase: inertialization smooths the switch
and cannot recover a static offset or a clip that walks the foot away.

## Why it fails (two modes)

1. Frame-0 floor (~10 cm max, 5-8 cm mean on all 8 phases). The bake chain does not
   start exactly at the walk pose. Measured links: directed-inverse solve residual
   ~3 cm (fk reconstruction), Kimodo frame-0 EE adherence ~3 cm mean on pinned joints,
   remainder from the bind-back approximation. The best phase (5) still drags 0.089 m,
   tracking its 0.097 m frame-0 offset almost exactly.
2. Clip-trajectory mismatch (phases 0, 1, 4, 7: drag 0.55-1.07 m, far above their
   ~0.10 m frame-0 offsets). The contact foot at the switch becomes the swing foot in
   the generated stop motion and steps ~1 m. Pinning frame 0 constrains neither which
   foot stays planted through the stop nor the clip's subsequent foot trajectory, and
   a walk-phase-indexed clip cannot know it.

A-rot reads exactly 86.8 deg on all 8 phases: one systematic single-bone discontinuity
under the hard cut (unidentified in this slice; treatment B removes it). It is not the
drag driver (B fixes rot, drag unchanged).

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

Constraint form: ONE generic `end-effector` dict at frame 0 pinning
Hips/LeftFoot/RightFoot/LeftHand/RightHand (+ chains) plus the full root2d path
(walk 0.3 s at 1.03 m/s, cosine decel 1.1 s, hold 1.2 s, translated to the frame-0
root). Head is not pinnable (expand_joint_names supports only the five bases; read
from kimodo/skeleton/base.py). Locals in the EE dict come from the swing math against
the SOMA rest skeleton (from_dict FKs local+root, so full locals are required). The
planted foot is pinned at frame 0 only: a remaining-window pin is unstatable without
per-frame IK (moving root under a fixed foot), stated in the builder. 8 clips, seed 1,
20 diffusion steps, ~46 s each; bound with root motion kept, no foot lock (2026-10-09
refusal rule), yaw from net root travel (all 8 within [-1.07, +1.12] deg of the -0.86
convention, no rebind).

## What survives this

- The directed inverse (`build-frame0-constraints.py`) is verified: fk reconstruction
  ~3 cm worst, loader round-trip 1e-6, all 8 phases. Reusable wherever a walk pose must
  enter Kimodo-space.
- Kimodo honors frame-0 EE pins to ~3 cm mean on pinned joints (phase-0 adherence
  probe). Generation adherence is not the blocker; the frame-0 floor and the
  trajectory mismatch are.
- Treatment B (0.1 s inertialized entry) clears step and rotation on all phases. Any
  future transition work starts from B, not A.

## Follow-ups (not done here)

- The binding constraint is take-entry continuity plus clip-trajectory control, not
  blending: constraining which foot stays planted through generation, or switching at
  a phase-aligned frame of a single stop take, are the honest next moves.
- The 86.8 deg systematic bone under the hard cut is unidentified; one grep over the
  per-bone discontinuity would name it.
- Determinism rerun (two-run bit-identity, per the inertialize precedent) was not done.

## Artefacts

- `.openclinxr/evidence/transition-table/report.json` (schema
  `openclinxr.transition-table-cagematch.v1`, verdict + per-phase table; git-ignored
  generated evidence, as are the 8 npz / joints / bound GLBs beside it).
- `tools/openclinxr/evidence/foot-plant/transition-table/` (sampler, constraint
  builder, bind driver, harness; tracked).
- Rerun: builder (kimodo venv python) -> generate x8 -> bind driver -> `mise exec --
  tsx .../transition-cagematch.ts`.
