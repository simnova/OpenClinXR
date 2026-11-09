# Round 1, zoom_out-1-1 (Goldfish), raw findings, unresolved

- Z1 Blocker (P1, T1, Files): Cycles hair BSDFs are glossy/transmission closures, so a Diffuse Color pass is likely empty for strands (UNVERIFIED); atlas_from_members.py L34-36 docstring says the albedo/lighting split needs per-card relighting (VERIFIED). Falsifier: render one card cell with Diffuse Color + Glossy Color passes, check non-zero. Fallback: bake with emission at the recipe melanin colour, coverage from film alpha.
- Z2 Major (P1 gate): "base error halves vs BEST3 with no re-fit" is ill-posed (BEST3 fitted on lit atlas + global gain; back base already .133 vs .132). Fix: allow one-scalar base-colour re-fit; gate on light-rotation test + the 3 views with real error.
- Z3 Major (R-c, T2, P1): "no per-strand variation channels" is false: --spec-streaks (specularTexture) and --aniso-alpha-power (anisotropyTexture) exist (transplant_donor.py L27-37, L121-128). Plan adds a third 2048 map (K5 33.6 -> ~50 MB). Fix: P1/P2 ID channel replaces the spec-streaks map; say so in Files.
- Z4 Major (P1 bundling): ID/root-tip/AO channels have no consumer until P2; stock material reads glTF occlusion from R not B. Fix: P1 = albedo only (tests R-a alone); aux map moves to P2.
- Z5 Major (P2, Files, Q2): existing pattern ignored: GLB-declared shader hook OPENCLINXR_skin_shade in Aisha's GLB, preserved by packages/openclinxr/xr-asset-loading/src/material-tint.ts L91-97; xr-scene/src/eye-shader/eye-cornea-fresnel.ts chains onBeforeCompile. hair_lobes.ts under tools/ never reaches the app. Fix: declare OPENCLINXR_hair_lobes in the GLB, hook in xr-asset-loading like skin_shade; harness inherits.
- Z6 Major (sheen_gate.py, G1): metrics exist as scripts: grades/sheen2-v1/scripts/v3mask.py, grades/sheen3-v1/scripts/{rescore,parting,streakhf,sidepeak}.py, sheen3/tools/score3.py. Promote them. Settle the scalp-parting confound (target parting not removed) before band-row/peak gates count.
- Z7 Major (P0 sequencing): seed search is shape work ahead of appearance; numeric grade.py can return INCONCLUSIVE items scored visually (grade.py L743, L1047), so numeric-only search cannot certify 41/41. Fix: P0 = record seed 1 and freeze; defer seed_search.py.
- Z8 Nit: "~37% less diffuse light" holds at K 1.0 only (sheen3-v1 C3: side .84, back .76 at K .4).
- Z9 Nit: "BEST3 closes brightness" overstates (front peak .398 vs .282; side base .135 vs .086). Quote residuals.
- Z10 Nit: name the Q1 decision owner before P2.
- Z11 Nit: cheapest R-b falsifier is BEST3 without streak map at matched spec (.15); run before P2.
