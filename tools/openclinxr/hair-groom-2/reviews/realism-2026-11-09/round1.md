# Round 1 resolution (Elephant), 2026-11-09

Inputs: round1-{comprehension,zoomout,inventive,critic}.md against DESIGN-realism.md draft (untracked, 187 lines).
Operator asked for rounds; PROPOSE FIX items are applied to DESIGN-realism.md in the same change.

Evidence checked by the Elephant before resolving:
- groom.py:913 builds one `ShaderNodeBsdfHairPrincipled`; atlas_from_members.py renders Combined only, no view-layer passes (grep for use_pass/view_layer: no hits). Z1/D1 confirmed.
- isolated-subject-assembly.ts:24-58 loads through `createSkinShadeGLTFLoader` (skin-shade-loader.ts:234) on an untyped spec extra; material-tint.ts:92 names the OPENCLINXR_skin_shade hook. D3/Z5 confirmed.
- transplant_donor.py:27-37, 237-256: `--spec-streaks` and `--aniso-alpha-power` already write per-member textures. Z3 confirmed.
- .gitignore:10 ignores `.openclinxr/`; metric scripts live in EV/grades/sheen2-v1/scripts, EV/grades/sheen3-v1/scripts, EV/sheen3/tools/score3.py. D7/Z6 confirmed.
- "+2 pp" and "0.8 x target peak": sheen-3 brief, briefs/sheen-3-dual-light.md:13 (62f68e8db). D7 "unsourced" answered.
- "56 outlier strands": r14 record, older handoff log line 243. r11 brief line 8: seed+1 STRANDS also fail B5.side (34 of 151 tip columns), so K4 is not the only cause.
- EV/grades has sheen2-v1, sheen3-v1, sheen3b-v1; no sheen-v1. C4/D9 confirmed.

## Blockers

| id | resolution | text applied |
|---|---|---|
| Z1, D1 | PROPOSE FIX | P1 step 0 probe: one card cell rendered with Diffuse Color, Glossy Color, and an AOV, to multilayer EXR; record which are non-zero. Expected: Diffuse Color empty. Albedo source if so: emission bake (no lights) with colour = one recipe hair RGB x per-strand variation from Curves Info Random, strength 1; coverage from film alpha. Colour scale set once by a one-scalar baseColorFactor fit (Z2). |
| D2 | PROPOSE FIX | ID channel rendered separately at 1 sample, pixel filter width 0.01 (front-most strand at each pixel centre), resampled nearest, not premultiplied, written only where coverage > 0.05. Gate: crown ID histogram std >= 0.2 (uniform random std .289; an averaged channel collapses toward .5). |

## Majors

| id | resolution | text applied |
|---|---|---|
| C1, D8, Z7 | PROPOSE FIX (Z7) | P0 = record r10 B (recipe groom-r9/s1, seed 1, card flags, grades/r10-v4 41/41) in a tracked `SHIPPED.json`; no seed search now. numeric grade.py can return INCONCLUSIVE items scored visually (grade.py:743, 1047) and B5.side fails on seed+1 strands, so a numeric seed search cannot certify 41/41. CUJ3 moves to Non-Goals until a seed pass rate exists. |
| C2, Z2, D5 | PROPOSE FIX | P1 is albedo only. Gate (a): spec 0, ambient-only light, crown luminance along card v, p95/p50 <= 1.10; the r10 lit atlas measured as control must exceed it (shows the baked band). Gate (b): one-scalar baseColorFactor re-fit allowed; report base/peak residuals per view vs target and BEST3; gate = not worse than BEST3 by more than .02 L in any view. "band moves under 30 deg" removed (GGX moves either way). |
| C3, D6, D7, Z6 | PROPOSE FIX | Metrics section added: port v3mask, rescore, parting, streakhf, sidepeak, score3 into tracked grade/sheen_gate.py; mask from each render's hair alpha (not fixed .npy); parting columns removed from target and render alike; peak = p98 of L on the eroded hair mask; band = per-column crown row profile (row, width, continuity); streak = streakhf ratio; back runs/row dropped. P2 control = BEST3 with streak map; P2 must beat it on band row and streakhf. G2 adds a peak ceiling of 1.25 x target. |
| C4 | PROPOSE FIX | Glossary defines BEST3 and lists grade dirs by full EV path; "sheen-v1" replaced by the sheen round record (EV/sheen). |
| C5 | PROPOSE FIX | Rubric items written "rubric D5"; operator directives written "directive D13". |
| C6 | PROPOSE FIX | P3 step 1 measures the baseline: 12-azimuth turntable of the current two-pass at 1:1, grader marks sort and edge artifacts. Gate: A2C count <= baseline, no new artifact class. |
| C7 | PROPOSE FIX + ESCALATE | Provisional budget stated: drawn hair tris <= 63,024 (r10 B), hair GPU texture <= 12 MB, draw calls <= 2. Frame time deferred until a Quest harness exists. Operator confirms the numbers (E3). |
| C8 | PROPOSE FIX | Glossary: I19 = grader rule 798886448 (A3 on censored card rounds measured from card-borne member tips); visual items pass by the independent grader's call against the rubric text at native resolution. |
| D3, Z5 | PROPOSE FIX | Hair shader becomes a GLB-declared extension OPENCLINXR_hair_lobes, installed by a GLTFLoader plugin next to createSkinShadeGLTFLoader; opt-in through an untyped spec extra in isolated-subject-assembly.ts (lab module stays sha-pinned); material-tint.ts preserves the hook as it does skin_shade. Files table updated; tools/ hair_lobes.ts dropped. |
| D4 | PROPOSE FIX | Aux texture lives in OPENCLINXR_hair_lobes.auxTexture (textureInfo), carried by transplant --carry-extensions (carries *Texture keys inside extensions), resolved in the plugin with parser.getDependency('texture', i). Not in extras. |
| I1, Z3 | PROPOSE FIX | One data map. P2 aux map (R strand ID, G root-tip v, B AO, A shift amount) replaces the --spec-streaks specularTexture; streak weight derived in the shader from R. Coverage only in atlas alpha. Hair stays at two 2048 maps. Data channels sampled linear, UASTC under P4. |
| I2 | PROPOSE FIX | Two-stage appearance reference: (1) strands vs photo under the fitted rig tunes the recipe melanin/roughness; (2) cards vs Cycles strands in matched frames under each rig (fitted, harness default) fits card material. Q1 stops blocking P1-P2. Needs the three.js rigs translated to Blender lights (light_rig.ts -> Blender), stated as P1 work. |
| I3 | PROPOSE FIX | P3b: flyaway / hem-tip card group from members dropped by clustering. Gate: B5.side on seed+1 cards >= 170 tip columns, tri increase <= 10%. Sequenced after P2 (appearance first). Note: seed+1 strands also fail B5.side (r11 brief line 8), so P3b alone may not pass it. |
| Z4 | PROPOSE FIX | P1 albedo only; aux map moves to P2 where it has a consumer. |

## Nits

| id | resolution | text applied |
|---|---|---|
| C9, D9, Z8 | PROPOSE FIX | "~37%" cited to EV/sheen3/probe3.json F2 at K 1.0 (side .63, back .61); at K .4, .84/.76. |
| C10 | PROPOSE FIX | Problem 3 cites r14: 56 outlier strands form the front tip columns, card means drop them; r11: seed+1 strands also fail. |
| C11, I5 | PROPOSE FIX | K5: 2 x 2048^2 x 4 B = 33.6 MB without mips, 44.7 MB with. P1 records the sampler filter; gates run with the shipped filter. |
| C12, Z10 | ESCALATE | Q1 production lighting: owner = operator (E1). I2 removes it as a P1-P2 blocker. |
| C13 | PROPOSE FIX | "indistinguishable" cited to grades/cards-opt2-v4. |
| C14 | DECLINE | Reviewer scope; prior-art.md exists. |
| D10 | PROPOSE FIX | Files adds run_cards.sh (gain skip) and render_cards.py; aux A is not coverage; P3/P4 gates numbered. |
| I4 | PROPOSE FIX | P3: core vs fringe split into two primitives at build time; A2C on MSAA, sorted fringe otherwise. |
| Z9 | PROPOSE FIX | Problem 1 quotes BEST3 residuals (front peak .398 vs .282; side base .135 vs .086). |
| Z11 | PROPOSE FIX | P2 step 0: BEST3 without streak map at spec .15. |

## ESCALATE to operator

- E1. Q1: which light is production for encounter scenes (harness default, fitted rig, or scene rig from the environment blueprint).
- E2. Q2: a GLB-declared custom hair shader extension (precedent OPENCLINXR_skin_shade) is acceptable in the factory.
- E3. G4 provisional budget: tris <= 63,024, hair GPU texture <= 12 MB, draws <= 2.
- E4. Open from before: ship r10 B and stop the seed chase (P0 assumes yes); texture size 2048 kept until P4.

Open after round 1: 0 Blocker, 0 Major unresolved (all PROPOSE FIX applied); 4 ESCALATE.
