# BRIEF::hair-groom-2-sheen-light-match | FORMAT::DENSE_v1 | ROLE::worker
Inherits W, commit rules and the RESULT envelope keys of tools/openclinxr/hair-groom-2/briefs/r14-budget-hem.md except where overridden here.
EV::W/.openclinxr/evidence/hair-groom-2/sheen/<sub>
OP::2026-11-09 "in the test harness can you try to match lighting to determine if hair sheen matches target?"
START::shipped pick r10 B: runtime GLB EV/r10/rt-tw35ta15sm2/donor-sheen.glb (+ donor-sheen.json material), crops via cards/head_crops.ts --body-frame 1.5 -> tools/openclinxr/evidence/isolated-subject-harness.ts renderHeadFocusCrops. Targets: tools/openclinxr/hair-groom-2/targets/target-{front,three_quarter,profile,back}-a1.png (1024^2).

## WHY
Sheen cannot be compared while the harness lighting differs from the target's. Match the light on things that are not hair first, then judge the hair.

## TASK
L1::estimate the target lighting per view from NON-hair regions only (face/neck skin shading direction, shirt shading, cast shadows, background level): key direction (azimuth/elevation), key:fill ratio, ambient/env level, colour temperature. Record method and numbers (sheen/target-light.json).
L2::add an opt-in lighting override to the runtime crop path (head_crops.ts flag -> HeadCropSpec field -> harness; e.g. --light-rig <json> with key dir/intensity/colour, fill, ambient/env intensity, exposure). Default absent = current lighting byte-identical. Do not edit sha-pinned modules (isolated-subject-lab.ts is pinned by an xr-scene test; see 8359c9e3a for how P1 was routed around it). Run the touched package tests.
L3::fit the rig: sweep rig params so the NON-hair regions match the target (per view: skin mean L and shading gradient direction, shirt mean L, background). Report the residual per region before/after. The fit must not use hair pixels (counterweight: tuning light to make hair match proves nothing).
L4::render r10 B with the fitted rig, then measure sheen vs target on hair only, per view: highlight band row position on the crown, band width (rows above 0.8 x peak), peak L, peak-to-base contrast, highlight hue/saturation, highlight continuity (sharp band vs broken streaks). Same mask method as grades (R>G+0.004, L<0.30... adapt for highlights and state it).
L5::if sheen differs, name the material parameter responsible (specular, anisotropy strength/rotation, roughness, sheen colour, atlas albedo) and sweep only that on the runtime material (donor-sheen.json / transplant options, opt-in), with the fitted rig held fixed. Report the best point; do not change geometry.

## GATE
G1::non-hair residual after fit smaller than before in every view, with numbers; fit used no hair pixels.
G2::sheen table per view: target vs r10 B under fitted rig (and best L5 point if any), plus a 1:1 strip target | r10 default light | r10 fitted rig | best L5 per view (sheen/strips/).
G3::default lighting output byte-identical to r10 crops (sha) with the flag absent.

## RESULT envelope (<= 250 words): RESULT / RIG (fitted numbers) / FIT residuals / SHEEN table summary / L5 best / COMMIT / CHANGED / STILL / HARM / NOT TESTED.
END_BRIEF
