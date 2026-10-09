# Foot-inertialize evaluation, 2026-10-09

Question: was unmerged branch `wt/foot-inertialize` beneficial and heading the right way.
Answer: shelve both commits. The spring fixes stance jumps on every rig but regresses
planted slide on every rig. The anchor follow-up only improves arrival.

## Variants (all on today's main, commit 7d370459e)

- A = main.
- B = main + 3cef23f9d only (spring foot-lock release), on branch `foot-eval-B`
  (49f298d20). Cherry-pick applied with zero conflicts.
- C = main + both commits (B + 41566d921 anchor tracking), on branch `foot-eval-C`
  (657701773). Cherry-pick applied with zero conflicts.

## Method

Headless assay `tools/openclinxr/evidence/foot-plant/foot-inertialize-variant-measure.ts`:
production SC-05 approach run (`runApproach`, no browser) driven by each rig's real decoded
walk-clip toe tracks, graded by the existing `computeTurnQuality`. Same-day baseline, all
three variants rebuilt (`turbo build`) and measured one at a time. Per-variant raw files sit
beside this report (`foot-inertialize-variant-{a,b,c}-2026-10-09.json`).

Caveats: absolute numbers differ from the 2026-09-26 browser captures (different instrument:
headless world tracks, not displayed pixels). Relative deltas are the verdict basis.
`maxToeStepPerFrameM` is identical across variants: it is the harness walk-to-settling pose
snap on an unlabelled foot, not product code. Toe world-Y rides ~0.05-0.08 m above the
origin in this harness, so floor/step-lift rows carry a datum offset; they are equal across
variants and excluded from the verdict.

## Results

| variant | rig | plantedSlideM | maxToeStepM | stanceJumps | arrivalErrM | duty | toeExc |
|---|---|---|---|---|---|---|---|
| A | physician | 0.12002 | 0.06795 | 5 | 0.15883 | 0.475 | 0 |
| A | nurse | 0.13603 | 0.11725 | 5 | 0.13021 | 0.538 | 0 |
| A | child | 0.08271 | 0.40363 | 5 | 0.13815 | 0.550 | 0 |
| B | physician | 0.12772 | 0.06795 | 0 | 0.13226 | 0.475 | 0 |
| B | nurse | 0.15685 | 0.11725 | 0 | 0.11162 | 0.538 | 0 |
| B | child | 0.09872 | 0.40363 | 0 | 0.12720 | 0.550 | 0 |
| C | physician | 0.12679 | 0.06795 | 0 | 0.12288 | 0.475 | 0 |
| C | nurse | 0.15376 | 0.11725 | 0 | 0.10437 | 0.538 | 0 |
| C | child | 0.09948 | 0.40363 | 0 | 0.10970 | 0.550 | 0 |

Stance-step max (supporting detail): A 0.0388/0.0444/0.0263 m, B and C identical at
0.0156/0.0135/0.0076 m. Duty, excursions, settle seconds, yaw error identical across
variants. No variant wins plantedSlide on any rig; B and C win stance jumps and arrival
on all three rigs.

## Verdicts

- 3cef23f9d (spring release alone): SHELVE. It eliminates one-frame stance jumps (5 to 0
  on all rigs, stance-step max down 60-70 percent) and improves arrival 11-27 mm, but
  regresses the metric it targeted: plantedSlideM rises on every rig (+8 mm physician,
  +21 mm nurse, +16 mm child). A change that improves jumps while worsening slide on all
  three rigs is not a land. Revisit only after the mid-hold drift is fixed, then re-measure.
- 41566d921 (anchor tracking): SHELVE. Against B it moves plantedSlide by noise
  (-0.9/-3.1/+0.8 mm) and stance not at all; its only consistent gain is arrival
  (another 7-9 mm over B on all rigs). Benign but marginal, and it has no base to land on
  while B is shelved. Re-measure its arrival benefit if B is ever revived.

B did not win on all three rigs, so no commit was prepared. Variant code stays on local
branches `foot-eval-B` / `foot-eval-C`, unpushed.

## Superseded on main

No. Both cherry-picks applied with zero conflicts, and `git log --since 2026-09-26` on
`packages/openclinxr/xr-humanoid-animation/src` shows only dialogue/face refactors, no
stance-lock or settling-turn changes. Main gained nothing that supersedes either commit.

## Not tested

Browser foot-plant-video captures, worn-headset evidence, gait realism, clinical validity.
