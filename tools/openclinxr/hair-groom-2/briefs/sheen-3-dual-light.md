# BRIEF::hair-groom-2-sheen-3-dual-light | FORMAT::DENSE_v1 | ROLE::worker
Inherits every key of tools/openclinxr/hair-groom-2/briefs/sheen-2-streaks.md except where overridden here.
EV::W/.openclinxr/evidence/hair-groom-2/sheen3/<sub>
START::r10 B runtime; streak map + roughness 0.4 from sheen2 (3818b2b7c --spec-streaks seed 0 amp 0.5 sigma 0.5 rho 0). Fitted rig EV/sheen/fitted-rig.json fixed. Grade grades/sheen2-v1 (grade.md, scripts/, rescore*.json).

## DEFECT (grades/sheen2-v1)
D1::default app light: hair px below L .06: best 30/34/67/84% (f/tq/s/b), S1-only 25/27/62/63%, r10 0%, target 19/10/16/0.4%. Best peak under default .17-.19 vs target .25-.33. Back crown rows 190-450 x 400-640 renders black (N1).
D2::sheen2.py mask drops 808-3,366 px/view of bright opaque crown hair (N2). Use the grader's v3 mask (grades/sheen2-v1/scripts) for all scoring; report sheen2 alongside.
D3::front highlight saturation .08-.10 vs r10 .21 (N3; crown rows 195-260).
D4::back peak .239 under fitted rig vs target .313.

## TASK
F1::re-fit albedo scale, specular, specular colour, anisotropy with streak map and roughness 0.4 held, scoring BOTH lights in one objective: fitted-rig sheen distance (v3 mask) AND default-light black share per view <= target share (+2 pp) AND default-light peak >= 0.8 x target peak.
F2::if no material point meets both, say so with the Pareto table, and measure why: compare the default rig vs fitted rig light reaching the hair (render a grey diffuse probe card or the hair with spec 0 under both) so the report states whether the app's default light is the cause.
F3::D3/D4: check whether the specular colour tint causes the desaturation; check the back crown under both lights.

## GATE
G1::a point with fitted-rig sheen closer to target than r10 in all 4 views AND default-light gates met in all 4 views; or F2 Pareto + light-cause measurement.
G2::1:1 strips both lights: target | r10 | best.
G3::hair tris unchanged (63,024 drawn); GPU texture bytes reported.

## RESULT envelope (<= 250 words): RESULT / BEST / per view fitted (peak/base/runs) and default (black share, peak) target | r10 | best / F2 light cause / D3 / COST / COMMIT / CHANGED / STILL / HARM / NOT TESTED.
END_BRIEF
