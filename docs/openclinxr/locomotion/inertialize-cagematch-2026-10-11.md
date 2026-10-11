# Inertialize cagematch (walk-to-stop transition) — 2026-10-11

## Outcome

REJECT. Inertialization helps (treatment B beats the linear crossfade on every rig and
both bars' instruments), but the full package — inertialized switch plus inertialized
foot lock plus two-bone IK (treatment C) — fails the physician kill-test bars by more
than 2x on drag (0.284 m vs <0.05 m, 5.7x) and 2.7x on single-frame step (0.218 m vs
<=0.08 m). Per the slice instruction the approach is closed on the decision rig; nurse
and child ran once and are reported, not adopted. No runtime, package, or shipped-GLB
change. Headless, deterministic (two runs bit-identical), isolated harness.

## Treatments (same switch frame, 16-frame / 0.25 s window at 60 Hz)

- A: linear 0.25 s crossfade of local pose (current behaviour).
- B: inertialized switch only (per-bone quaternion + root position/velocity offsets,
  critically damped decay, halflife 0.1 s).
- C: B plus per-foot inertialized contact lock (pin while the stop take's own label is
  on, inertialized release, unlock radius 0.2 m) enforced with analytic two-bone IK.

Switch frames are the runtime assay's `stopEntryTimeS` phases; contacts come from the
takes' own motion (loop labels for walk, one-shot labels for the stop take).

## Numbers (world space, GLB scene frame)

| rig | A drag / step / rot | B drag / step / rot | C drag / step / rot |
| physician | 0.334 / 0.084 / 5.8 | 0.290 / 0.053 / 8.9 | 0.284 / 0.218 / 37.0 |
| nurse | 0.136 / 0.085 / 7.1 | 0.106 / 0.062 / 7.4 | 0.016 / 0.062 / 7.4 |
| child | 0.093 / 0.057 / 7.0 | 0.093 / 0.033 / 7.4 | 0.026 / 0.033 / 37.4 |

Drag = switch-contact toe travel while labelled contact (m). Step = max single-frame toe
move, either foot (m). Rot = max per-bone rotation rate (deg/frame). Bars: C drag < 0.05
and step <= 0.08 on the physician.

## Why C fails on the physician

The walk-to-stop pose gap at the assay switch phase is largest on the physician (A drag
0.334 vs 0.136/0.093 — same ordering as the independent slide-decomposition: 0.572 /
0.315 / 0.158). The B-output foot travels 0.29 m inside the window, past the ported
0.2 m unlock radius, so the lock gives up mid-window exactly as the reference logic
dictates, and the inertialized release from a pinned point to a fast-moving input
produces the 0.218 m pop. The pin never meaningfully holds (C drag ≈ B drag). On nurse
and child the morph stays inside the radius, the pin holds, and C clears both bars
(0.016/0.062, 0.026/0.033) — reported, not adopted, per the kill-test instruction.

## What survives this

- Inertialized blending (B) strictly dominates the linear crossfade on drag and step on
  all three rigs. Any future transition work should start from B, not A.
- The port (`tools/openclinxr/evidence/foot-plant/inertialize/inertialize.ts`, MIT,
  `github.com/orangeduck/Motion-Matching` `spring.h` + `controller.cpp`) and the harness
  (`cagematch.ts`) are verified: FK parent-compose invariant 0.0000 deg on all 149 nodes,
  two-run bit-identical output, A-magnitudes consistent with slide-decomposition.
- Two harness bugs found and fixed during the slice, recorded here so they stay fixed:
  (1) `quatFromMatrix` Shepperd x/y/z-largest branches had scrambled component slots
  (trace branch was correct, which is why it hid); (2) the first IK port assumed the
  knee's direct parent is the hip — the MPFB leg has intermediate segment nodes
  (upperleg02, lowerleg02), so the knee local converts through its direct parent's
  post-rotation world orientation.

## Follow-ups (not done here)

- The physician failure is a morph-size problem at the switch phase, not a lock-tuning
  problem: re-sweeping take entry phase (the stop-take doc's own follow-up) or switching
  at a more phase-aligned frame are the honest next moves, not larger unlock radii.
- Child C shows a 37 deg/frame knee rate with passing foot metrics — deep but smooth
  flexion to hold the pin; any adoption case should budget leg-bend plausibility, not
  just toe metrics.

## Artefacts

- `.openclinxr/evidence/inertialize/report.json` (schema
  `openclinxr.inertialize-cagematch.v1`, verdict + per-treatment metrics + method meta;
  git-ignored generated evidence, as are the three copied stop GLBs beside it).
- `tools/openclinxr/evidence/foot-plant/inertialize/inertialize.ts` (the port),
  `cagematch.ts` (the harness; rerun with
  `npx tsx tools/openclinxr/evidence/foot-plant/inertialize/cagematch.ts`).
