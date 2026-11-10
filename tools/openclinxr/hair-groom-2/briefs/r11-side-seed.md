# BRIEF::hair-groom-2-r11-side-seed | FORMAT::DENSE_v1 | ROLE::worker
Inherits every key of tools/openclinxr/hair-groom-2/briefs/cards-r10-defects.md except where overridden here.
EV::W/.openclinxr/evidence/hair-groom-2/r11/<sub>
START::strands groom-r9/s1 (4dd343917); cards EV/r10/tw35ta15sm2 (cards --max-twist-deg 35, atlas --cut-tip-spread 0.15 --tip-spread-all, simplify --tol-mm 2; d35d0f0e1 + 9ef4966dc) [grades/r10-v4: 41/41 independent, PICK B]. Fallback A = r10/tw35sm2. Runtime head_crops --body-frame 1.5; 2048 atlas.

## DEFECT (grades/r10-v4 + r10 producer)
V2::side view stepped silhouette at the shoulder (runtime and offline). r10 ray probe (r10/v1/side_rays.json) puts cards 273/546/22/236 at v 0.36-0.48 on the step: mid-card, not tips. Edge rms 5.61 px at side rows 590-700, cols 605-690 (r10/v2edge.py); steps >= 4 px: 7.
V4::seed+1 strands fail B5.side: 34 of 151 tip columns (needs >= 170). r10 cause probe: ~300 strands rooted x72 y13-20 z66-84 mm (above/behind the ear) reach the shoulder top at y~45 mm in s1, ~26 mm in seed+1 (r10/proj-*-side.npz). 10 recipe overrides tried in r10/rounds-strands.tsv; best behindYMm 62 reached 165.
V5::thin margins on B: S1 band 950 3.0 mm, S1 band 900 angle 6.4 deg (sm2 2.5), S2 edge 1.45 mm, A3 0.8 mm, S3 L550 9.2.

## TASK
T1::V4 first (strands). Find why that root group's route depends on the seed (which random draw moves them: guide placement, interpolation weights, clump assignment) and make that route deterministic or robust in the groom code, procedural only. Recipe tuning alone was exhausted in r10; do not repeat its 10 overrides.
T2::V2 (cards). Find what makes cards 273/546/22/236 bend or overlap at v 0.36-0.48 (station spacing after simplify, twist limit, cluster mixing two strand routes, layer order) and fix at its source. Check the step in the strands first: if the strands have it, it is a groom fix.
T3::every landed sub-round: strands at seed and seed+1, cards with the B recipe, runtime crops, rtm7b counts, V2 edge rms.

## GATE
G1::strands 41/41 (v4 + I19) at seed and seed+1.
G2::cards from the chosen strands 41/41; V1 notch <= 70 px; no V5 margin shrinks vs B; drawn tris <= 66,000.
G3::V2 edge rms and >=4 px step count before/after at the same crop coords, and a 1:1 side strip.

## RESULT envelope (<= 250 words): RESULT / SUBROUNDS / BEST / SELF_SCORE / V2 V4 V5 one line each with numbers / COST / COMMIT / CHANGED / STILL / HARM / NOT TESTED.
END_BRIEF
