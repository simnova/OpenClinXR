# BRIEF::hair-groom-2-r14-budget-hem | FORMAT::DENSE_v1 | ROLE::worker
Inherits every key of tools/openclinxr/hair-groom-2/briefs/r13-card-fidelity.md except where overridden here.
EV::W/.openclinxr/evidence/hair-groom-2/r14/<sub>
START::strands r12/strands/lh + lhg; cards r13 pA/pAg (chord 0.5:2, root-offset-scale 0 on cards >= 150 mm, tip-fan 35:0.85:300, atlas --anchor spread, sm2; commit 7a754e6c8) = 31/32 at both seeds, 97,356 drawn tris. In-budget variant q1/q1g 29/32. Per-item cost table EV/r13/cost-table.tsv. Shipped pick stays r10 B.

## DEFECT
H1::B5.side tip columns: strands lh 176 / lhg 171 (need 170); every card build loses 5-8 columns (pA 170/166). The strand margin at seed+1 is 1 column; cards cannot fit inside it.
H2::tri budget: chord stations keep median 19 of 24 stations after sm2 (even 13) -> 97,356 drawn, gate 66,000.
H3::seed: S1 950 angle 10.56 from one fanned card tip at side rows 945-955 (fan wisp).

## TASK
T1::H1 at the strand stage: find which front columns (r13 says 5-6 front columns) the side hem loses and give the strands >= 178 tip columns at both seeds, procedural/recipe, without shrinking other lh margins. Then check how many columns the r13 card recipe keeps.
T2::H2: spend stations only where chord error needs them (chord tolerance sweep, chord stations only on crown/silhouette cards, fewer cards via cluster k, sm2 slip limit). Target drawn tris <= 66,000 with S4.front <= 6 and S3 <= 9 at both seeds.
T3::H3: cap fan on silhouette tip cards or fix the one card; native-res side strip rows 900-1000 before/after.
T4::every point as r13: numeric at seed and seed+1, drawn tris, notch, runtime tail rows 850/860/866.

## GATE
G1::cards 32/32 numeric + self visual 9/9 at both seeds; drawn tris <= 66,000; S1 950 offset >= -22 mm; notch <= 70 px; tail tapered.
G2::on a miss after 6 sub-rounds: update the cost table with strand / card / delta per item for the best in-budget point and stop.
T0 still holds: commit the lh recipe (and any strand change) only if the final pick uses it.

## RESULT envelope (<= 250 words): RESULT / SUBROUNDS / BEST / SELF_SCORE / H1-H3 one line each with numbers / COST / COMMIT / CHANGED / STILL / HARM / NOT TESTED.
END_BRIEF
