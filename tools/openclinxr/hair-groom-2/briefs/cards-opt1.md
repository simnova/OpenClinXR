# BRIEF::hair-groom-2-cards-opt1 | FORMAT::DENSE_v1 | ROLE::worker
Inherits W, ITERATION rules, G4 and the RESULT envelope keys of tools/openclinxr/hair-groom-2/briefs/cards-r4.md except where overridden here.
EV::W/.openclinxr/evidence/hair-groom-2/cards-opt1/<sub>
START::cards-r7/s1 at 33d5a2719 [grades/cards-r7-s1-v4 = 40/41 independent, PICK r7/s1].
OP::2026-11-08 "find the most realistic match, then work on optimizing it". This is the optimize step.

## BASELINE (cards-r7/s1, measured by producer and grader)
1,429 cards; 65,734 unique tris drawn twice (MASK 0.85 core + BLEND fringe); 2 hair draw calls; atlas 2048 PNG 6.0 MB (cells 16x170); runtime GLB ~29.6 MB.

## TASK
O1::sweep, do not pick a number up front. Axes: card count (cluster k), segments per card (stations), atlas size (2048 / 1024 / 2048 as KTX2 or JPEG+alpha if three.js in apps/ui-xr loads it — cite the loader file), and the second fringe pass (on / off / fringe drawn only on silhouette-facing cards). Run each axis alone from the baseline first, then combine the cheapest settings that hold quality.
O2::quality for each point: rubric v4 + I19 numeric (grade.py), F1, the runtime artifact counts from grades/cards-r7-s1-v4 (side rear L>0.35, tq behind-ear L>0.5, tq tips L>0.8) and the S2 flip margin. A point holds quality if the numeric PASS set equals r7/s1's and the S2 flip margin is ≥ 3 px.
O3::record a cost table per point: cards, unique tris, drawn tris, draw calls, atlas bytes, GPU texture bytes (w*h*4 for PNG; actual for KTX2), GLB bytes, and if feasible a frame time from the repo's existing runtime perf harness (find it; do not write a new one unless none exists — record which).
O4::output: the Pareto set (cost vs quality) plus a recommended point; render runtime head crops for baseline and the recommended point.
O5::side defects seen by the grader, fix only if they fall out of the sweep: front stripe parallel to the part (467 px right, 70 left) that reads as a crease; crown highlight band 8-9 px wide and hard-edged.

## GATE
G1::recommended point holds quality per O2 and cuts drawn tris or GPU texture bytes by ≥ 30% vs baseline; if no point does, report the Pareto table and say so.
G4::determinism on the recommended point.

## RESULT envelope (≤ 250 words): RESULT / SUBROUNDS / PARETO table (≤ 8 rows) / RECOMMENDED with numbers / QUALITY vs r7/s1 / COMMIT / CHANGED / STILL / HARM / NOT TESTED.
END_BRIEF
