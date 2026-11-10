# BRIEF::hair-groom-2-groom-loop | FORMAT::DENSE_v1 | ROLE::worker
Inherits every key of tools/openclinxr/hair-groom-2/briefs/groom-r1.md (W, B, BPY, ASSETS, RULES, FORBID, SCOPE, METHOD, STOP) except where overridden here.
EV::W/.openclinxr/evidence/hair-groom-2/groom-<round-id>   # round-id given in the dispatch prompt
START::the groom code at HEAD of wt/hair-groom-2 (tools/openclinxr/hair-groom-2/groom/) and the recipe of the round named in the dispatch prompt.

## DEFECT
D1::the failing rubric items listed in the dispatch prompt, from the latest grader score.json [meas:.openclinxr/evidence/hair-groom-2/grades/<id>/score.json].
GOAL::raise the rubric score (tools/openclinxr/hair-groom-2/briefs/accuracy-rubric.md) toward ≥ 26/28 without losing any item that passed.

## GATE (self-check is evidence; a separate grader scores)
G1..G3::as groom-r1 (determinism, clearance ≥ 0 mm vs body, renders + stats).
G4::self-score every rubric item you can measure, all three views, with the rubric's numeric rules; record per sub-round in EV/rounds.tsv.
G5::no item that PASSED in the input score.json may FAIL in your best round (regression guard).

## ITERATION
Up to 6 sub-rounds. Change recipe values or the procedural method only (FORBID per-point edits chosen to match the photo). Stop early when your self-score ≥ 26/28 with G5 holding. Commit code per landed sub-round.

## STOP (complete list)
- any groom-r1 STOP condition.
- 6 sub-rounds done.
- a fix needs a change outside SCOPE (for example body or garment geometry): report it as BRIEF_MISSING with the evidence, do not make it.

## RESULT envelope (≤ 250 words)
RESULT::<round-id> / SUBROUNDS::n / BEST::EV/<sub> / SELF_SCORE::n/28 with FAIL ids / G1,G2,G5::PASS|MISS / COMMIT::<sha> / CHANGED::recipe keys or method changes, one line each / STILL / BRIEF_MISSING / HARM
END_BRIEF
