# BRIEF::hair-groom-2-cards-opt2 | FORMAT::DENSE_v1 | ROLE::worker
Inherits every key of tools/openclinxr/hair-groom-2/briefs/cards-opt1.md except where overridden here.
EV::W/.openclinxr/evidence/hair-groom-2/cards-opt2/<sub>
START::cards EV/groom-r9/cards-mr8 (strands groom-r9/s1, commits 4dd343917 + 695d61b77) [grades/r9-cards-mr8-v4 = 41/41 independent, new PICK]. Runtime EV/groom-r9/rt-mr8 (2048 atlas; texture size is an operator decision, keep 2048).
WHY::cards-opt1 found every geometry cut failed S1 band 950 at a 0.31 mm margin. The r9 cards have a 5.9 mm S1 margin, so rerun the geometry axes.

## PRE-STEP (instrument)
P1::cards/head_crops.ts frames from the body silhouette, so new hair moves the crop (r9 crop 1.34x larger; rtm7 fixed regions now count shirt). Make the crop frame independent of the hair (body without hair, or a fixed head landmark), opt-in flag, default unchanged. Re-crop cards-r7/rt-s1 and groom-r9/rt-mr8 with it and re-locate the rtm7 regions so they cover hair again; report the new counts for both.

## TASK
O1::geometry sweep from r9-mr8: card count (cluster k), stations per card, fringe on a card subset (silhouette-facing). One axis at a time, then combine.
O2::quality per point: v4 + I19 numeric PASS set equal to r9-mr8 (41/41 offline needs visual too: self-score the 9 visual items at native resolution), S2 flip ≥ 3 px, S1 margin ≥ 2 mm, runtime counts with the P1 regions.
O3::cost table as opt1 (cards, unique tris, drawn tris, draw calls, GPU texture bytes, GLB bytes).
O4::visual defects from the grade, fix only if cheap and in passing: back black notch near row ~600 col ~335 (grew 67 -> 229 px); side stepped tips at the shoulder; back tail ends flat and opaque.

## GATE
G1::recommended point holds O2 and cuts drawn tris ≥ 30% vs r9-mr8 (129,720 drawn); else report the Pareto table.
G4::determinism on the recommended point.

## RESULT envelope (≤ 250 words) as opt1, plus P1 counts and O4 one line each.
END_BRIEF
