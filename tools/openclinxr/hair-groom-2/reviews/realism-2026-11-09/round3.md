# Round 3 resolution (Elephant), 2026-11-09

Inputs: round3-{comprehension,zoomout,inventive,critic}.md, fresh reviewers on the round-2-revised doc.

Elephant checks:
- cards/light_rig.ts:1-12: directions camera-relative by default, `LightRig { frame?: "camera" | "world" }`, unitless intensities. lighting-rig.py:1-21 materializes run.ts rigs for room bakes. R3C1 confirmed.
- EV/r10/rt-tw35ta15sm2/glb.sha256 = 04371bc4... for the r10 B runtime GLB; EV/sheen3/build/final holds donor.glb + sha256 for BEST3. R3C9 confirmed.
- lighting_design test rigs use room "ward-chain" (designLightingRig). With R3C1 the room rig needs its own world-frame adapter; it leaves P1-P5 and stays with OP1.

Round 3 had 1 Blocker and 21 Majors, so it is not clean. A round 4 runs on the revised doc.

## Blocker

| id | resolution | text applied |
|---|---|---|
| R3C1 | PROPOSE FIX | Rig format = light_rig.ts LightRig. New `cards/light_rig_blender.py` reads it per view (camera frame) and builds Blender lights. lighting-rig.py and its schema change dropped from the plan. |

## Majors

| id | resolution | text applied |
|---|---|---|
| R3Z1, R3Z2, R3C11, R3Z7, R3Z6 | PROPOSE FIX | Phases reordered so the first slice is visible: P1 visible baseline (matched strips, streak-map control, A2C probe, sheen_gate port); P2 hairline, part and scalp; then light/reference, data bake, lobes, transparency, optimize. |
| R3C12 | PROPOSE FIX | Streak-map control runs at spec .3 (one variable) and at spec .15 (matched effective spec), two runs. |
| R3C10 | PROPOSE FIX | A2C probe: opt-in runtime hook sets alphaToCoverage; cutoff sweep .85/.5/.3 (three r184 still discards below cutoff); confirm MSAA in the Playwright capture path first. |
| R3C3 | PROPOSE FIX | Target band row re-measured per view with sheen_gate in P1; the old side-only .49 is removed as a trigger. |
| R3C2, R3U10 | PROPOSE FIX | Parity gate on the fit feature vector (sheen/fit-residuals.json: skin/shirt meanL, lr, tb, spread). Cycles in Standard view with three's tone curve applied in post. Threshold set from the first parity run, recorded with the RoomEnvironment approximation. |
| R3Z4 | PROPOSE FIX | OP5 blocks the light sweep. Parity and strand renders proceed. |
| R3I4 | PROPOSE FIX | Before Cycles renders, rank candidate rigs by closed-form Kajiya-Kay band row from cards.npz tangents (numpy); render the best 2-3. Ranks only. |
| R3Z3, R3C4, R3U5, R3I6 | PROPOSE FIX | Card gate: grader ranks cards closer to the strand reference than BEST3 per view, and per metric abs(card - strand) <= tol, tol = max(p90 pairwise spread over strands seeds 1-3, card rebuild perturbation floor per face-regression calibrate.ts). Proof the gate can fail and pass: in P3, r10 B lit cards scored against it, and strands seed 4 scored against seeds 1-3. Round cap 2 per phase, then report. Target-relative numbers are reported, judged by the grader. |
| R3Z5 | PROPOSE FIX | K8 texel density added (1410 cells 16x170 px, ~1.4 px/mm across, ~0.5 px/mm along, crops ~1.9 px/mm). P4 step 0 probes a shared clump atlas (8-16 tiles, >= 128 px across) vs BEST3 before the data bake commits to unique cells. |
| R3I1, R3C5, R3C8, R3U3 | PROPOSE FIX | ID becomes a per-cell function of u: one texel row per cell (from member root_u, as spec_streaks_png does, transplant_donor.py:121-160). 2048 data map, 1-sample ID render and the equality gate dropped. Gate: per-cell distinct-ID runs across u vs member count, median ratio >= the ratio of today's spec_streaks map (known-good). Shift = (ID - .5) x one global shift range, fitted in P5. --spec-streaks stays until P5; AO goes through occlusionTexture. |
| R3C6 | PROPOSE FIX | Root-tip UV: export render_cards.py CardV (:119-122) in --bake-glb; opt-in UV1 carry in transplant_fitted_brow.py (:23, 240); file added. |
| R3C7 | PROPOSE FIX | ALBEDO=1 runs calib_search with gain fixed at 1 and re-selects specular, so calibration.json and SP exist. |
| R3I2 | PROPOSE FIX | R-a gate: skin leak_check.py Pearson r of albedo luminance vs a Cycles irradiance bake at two key azimuths; albedo atlas r below the r10 lit atlas r. Needs an atlas-space irradiance bake. |
| R3C9, R3Z8 | PROPOSE FIX | P0 ports pt.sh, sp.sh, rtp.sh; gate = rebuild from groom-r9/s1 strands to 04371bc4... and BEST3 build to EV/sheen3/build/final/sha256. Grader judges strand volume vs target before the freeze; a volume miss goes to the operator with OP4. |
| R3I3 | PROPOSE FIX | P5 else-branch ports Galacean two-lobe KK GLSL (MIT) using the skin-shade-loader plugin/fail-closed/read-back test pattern. |
| R3I8 | PROPOSE FIX | P5 probe d: per-cell u function into anisotropyTexture RG. |
| R3U1, R3U2 | PROPOSE FIX | Gated rigs = fitted and default. Room rig moved to OP1. |
| R3U4 | PROPOSE FIX | Superseded by R3I1 (equality gate dropped). |
| R3U6 | PROPOSE FIX | "beats BEST3" measured against the strand reference. |
| R3U7 | PROPOSE FIX | G4 12 MB counts mips. |
| R3U8, R3C13 | PROPOSE FIX | Artifact classes listed (sort pop, card-edge line, edge halo, shimmer, other + note); count vs P1 baseline; split by per-triangle mean texel alpha at the cutoff the P1 sweep picks. |
| R3U9 | PROPOSE FIX | Stray px = silhouette px farther than 2 px from the closed silhouette of the hair mask; same rule for strands and cards. 2 px is a first-run constant in the sensitivity sweep. |

## Nits

| id | resolution |
|---|---|
| R3U11 | PROPOSE FIX: SP = run_cards.sh:36 specular from calibration.json kept.specular. |
| R3U12 | PROPOSE FIX: Problem 3 sentence rewritten. |
| R3U13 | PROPOSE FIX: full path, rim light named. |
| R3U14 | PROPOSE FIX: superseded by R3C6 (CardV). |
| R3U15 | PROPOSE FIX: tangent sentence reworded, line 302. |
| R3U16, R3C14 | PROPOSE FIX: surface-meter path. |
| R3U17 | PROPOSE FIX: superseded by R3C12. |
| R3U18 | PROPOSE FIX: 62,996 = cards-opt2 build, 63,024 = r10 B. |
| R3U19 | PROPOSE FIX: covered by R3C9. |
| R3U20 | PROPOSE FIX: grade/target-masks/ in Files. |
| R3I5 | DECLINE: room-albedo-ao-bake places world-frame probe lights; R3C1 shows the fitted rig is camera-relative. |
| R3I7 | PROPOSE FIX: P2 tries apply_scalp_hair_material_region (garment_ops.py:280) with the groom melanin colour; the scalp_placeholder_retired_for rule must allow it under fitted hair. |

Open after round 3: 0 Blocker, 0 Major unresolved; ESCALATE OP1-OP5 (OP5 now blocks the light sweep).
