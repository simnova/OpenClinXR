# BRIEF::hair-groom-2-groom-r5-shape | FORMAT::DENSE_v1 | ROLE::worker
Inherits every key of tools/openclinxr/hair-groom-2/briefs/groom-loop.md (and through it groom-r1.md) except where overridden here.
EV::W/.openclinxr/evidence/hair-groom-2/groom-r5
START::groom code at HEAD of wt/hair-groom-2 and the recipe of groom-r4/s4 [EV .openclinxr/evidence/hair-groom-2/groom-r4/s4/recipe.json].
OP::2026-11-08 "still hair shape has some issues that might be better to tackle first" — shape before card texture or runtime work.

## DEFECT (shape; preliminary read from the 3-up sheets, re-measure at native resolution before acting)
S1::profile hang. Target profile-a1: hair lies flat on the back of the skull and falls behind the shoulder as one near-vertical sheet to chest height. groom-r4/s4 side.png: mass bulges rearward behind the neck and upper back and the lower hang curves forward over the shoulder.
S2::sideburn / temple wedge. groom-r4/s4 roots in front of the ear form a dark wedge reaching ~30 mm below ear top with blunt comb tips (handoff session 3, MY GRADE); target ~16 mm, soft, ear fully clear. Keep E1 (root coverage) passing: fix length, density falloff and tip taper, not by deleting the roots.
S3::back silhouette. groom-r4/s4 back.png: outline pinches at the neck, then a shelf at the shoulders (D3 2.83%, rows 605-696). Target back-a1: outline widens smoothly from crown to shoulders and tapers inward at the tips.
S4::crown top. Crown outline in front and back vs target (target rounder and lies closer to the scalp).

## METHOD
M1::research first (D5): the shelf and the forward curl are where strands meet the shoulder. A field tweak (relaxIterations 8) cut D3 to 1.48% but broke B2.tq and D5 [handoff]. Try a method that resolves the hang against the body: a gravity drape with body collision (Blender 5.2 geometry-nodes simulation zone or the bundled hair node-group assets), or a guide-curve rule that routes strands behind the shoulder plane before they descend. Record what you tried and why it was kept or dropped.
M2::recipe values and procedural methods only (FORBID per-point edits chosen to match the target).
M3::every sub-round renders all four views (front, three_quarter_left, side, back).

## GATE
G1..G3::as groom-r1. G5::no item that passed in grades/r4-s4-v3 may fail.
G4::self-score with grade.py (v3; if a rubric v4 with S-items lands on the branch while you work, use it — it is written by a separate instrument worker, do not edit grade/ yourself). Also record per sub-round in EV/rounds.tsv: profile rear-silhouette offset vs target per 50-row band, sideburn length below ear top (mm), back outline width per 50-row band vs target.

## ITERATION
Up to 6 sub-rounds. Commit code per landed sub-round (only files under tools/openclinxr/hair-groom-2/groom/; if git reports index.lock, wait 5 s and retry — another worker shares this worktree).

## RESULT envelope (≤ 250 words) as groom-loop, plus SHAPE::S1-S4 one line each with the numbers.
END_BRIEF
