# Round 2 resolution (Elephant), 2026-11-09

Inputs: round2-{comprehension,zoomout,inventive,critic}.md, fresh reviewers on the round-1-revised doc.

Elephant checks:
- EV/sheen/fitted-rig.json: key az -40.1 el 2.39 int 2.42; fill az 60.1 el 5 int 1.38; hemisphere 2.28; environment room .37; AgX, exposure .74. Both direct lights within 5 deg of horizontal. R2Z2 rig facts confirmed.
- R2C1 measured the r10 B atlas: per-cell p95/p50 along v median 1.078 (crown 1.088). The lit atlas does not carry a band along v (azimuth dropped, atlas_from_members.py:24-31). R-a is demoted as the band cause; the rig (R2Z2) and the shader (R-b) become the candidates. R-a still covers baked colour and occlusion.
- Target mask source exists: EV/sheen/tools/seg.py:43 `target_masks(img)`.
- packages/openclinxr/factory-stations/src/lighting_design/lighting-rig.py exists; line 11 says runtime key/fill consumption is follow-up work. R2I2/R2I3 confirmed.
- `git log --oneline origin/main..HEAD | wc -l` = 74 (doc said 76).
- xr-asset-loading/src/generated-loaders.ts exists (R2U9).

Threshold rule applied (contract-design): every appearance threshold now comes from a measured known-good. Card gates use the strand seed spread: |metric(strands seed 1) - metric(strands seed+1)|, same rig, same view, measured before any card edit. Numbers without a known-good are report-only or decided by a graded sweep.

## Blocker

| id | resolution | text applied |
|---|---|---|
| R2C1 | PROPOSE FIX | P1 gate a (p95/p50 <= 1.10 along v) deleted. R-a rewritten: the lit atlas is near-flat along v (1.078), so it is not the band cause. The bake phase is gated card-vs-strand under two rigs instead. |

## Majors

| id | resolution | text applied |
|---|---|---|
| R2Z2, R2Z9 | PROPOSE FIX + ESCALATE | New P1 "light and reference" phase, first build slice: Cycles render of r10 B strands under the translated fitted rig; measure crown band row. If no band, sweep key elevation with the hair highlight row as a constraint, graded. "photo" -> "reference image"; OP5 asks the operator whether the targets are renders and, if so, for their light setup. |
| R2Z3, R2C2 | PROPOSE FIX | Rig parity gate in P1: hairless body in Cycles and three.js under each rig; skin/shirt L RMS <= .033 (the fitted rig's own residual vs target, 474d2b3a7). RoomEnvironment, hemisphere, AgX/ACES named as the parts to port. |
| R2I2 | PROPOSE FIX | Rigs written as openclinxr.lighting-rig.v1 JSON and built by lighting_design/lighting-rig.py; schema gains a hemisphere/environment entry. rig_to_blender.py dropped. |
| R2I3 | PROPOSE FIX | OP1 names the lighting_design per-room rig as the candidate production light; P1 renders strands under one shipped-room rig as the third light. |
| R2Z4 | PROPOSE FIX | Covered by R2C1 fix: the bake is compared to the strand render's profile, so a correct root-tip gradient passes and a flat albedo fails. |
| R2Z5, R2I1 | PROPOSE FIX | P1/P2 bakes merged: one Shader-AOV multilayer EXR bake (albedo, AO, depth, coverage) plus a 1-sample ID render. AO is in the first bake. |
| R2I5 | PROPOSE FIX | Root-tip v emitted as TEXCOORD_1 from card_uv v (cards_from_strands.py:36,664); data map G = depth. |
| R2C4, R2Z10 | PROPOSE FIX | Albedo colour and per-strand variation amplitude fitted to the Cycles strand render (fitted rig), read with bpy image load; no recipe RGB claimed. |
| R2C3 | PROPOSE FIX | run_cards.sh gains env ALBEDO=1: skips calib_search gain, keeps SP from calibration.json kept.specular, passes the albedo atlas path to render_cards. |
| R2C5, R2U11 | PROPOSE FIX | ID gate: along-v adjacent-pair equality share after resampling >= share in the 1-sample render before resampling - .02 (known-good = the unresampled render). IDs uniform [0,1]. std gate deleted. |
| R2C6 | PROPOSE FIX | Files add transplant_library_hair.py (data map: no LANCZOS resize, nearest sampler, no mips) and a KTX2 loader for P6. |
| R2I7 | PROPOSE FIX | P6 precondition: KTX-Software (Apache-2.0) installed; toktx absent today (finalize-equipment-glb.ts:38). |
| R2C7 | PROPOSE FIX | Shader keeps anisotropy > 0 so three builds vertex tangents (WebGLPrograms.js:303); physical specular set to 0 where the lobes run. |
| R2C8, R2U9 | PROPOSE FIX | Files add isolated-subject-harness.ts and head_crops.ts (opt-in hairLobesLoader), xr-asset-loading generated-loaders.ts, surface-meter.test.ts and consumes.json admission. |
| R2C10, R2U7 | PROPOSE FIX | Shader step 0 decision rules written (see P3). |
| R2I4, R2I10 | PROPOSE FIX | P3 step 0 adds two stock-material probes before any extension: per-strand normalTexture tilt + anisotropyTexture jitter; clearcoat as second lobe with opposite tilt. If either meets the P3 gate, no extension and OP2 is withdrawn. |
| R2C11, R2I8 | PROPOSE FIX | Transparency starts with alphaToCoverage on the existing MASK material (lab renderer antialias: true, isolated-subject-lab.ts:271); then extend existing --fringe-blend/--fringe-triangles per triangle by mean texel alpha only if artifacts remain. Headless harness exercises the MSAA branch; Quest 4x not tested until a Quest harness exists. |
| R2C12 | PROPOSE FIX | Flyaway gate: side and back outline stray-strand pixel count, card vs strand render, within strand seed spread; zero added cards fails because the card outline lacks the strands' strays. |
| R2C13 | PROPOSE FIX | P0 ports EV/r10/sp.sh and rtp.sh into tracked build_shipped.sh; gate = runtime GLB sha; SHIPPED.json records BEST3 material arguments. |
| R2Z1 | PROPOSE FIX | Metrics resample target and render to a common px/mm at the head plane (grade/frames.json) before any metric. |
| R2Z6 | PROPOSE FIX | New P4 hairline and part phase: wisp cards from members at the hairline, scalp tint under the part. Gate on part width and hairline edge falloff vs strand render within seed spread. Part columns no longer removed from the P4 metrics. |
| R2Z7 | PROPOSE FIX | Gating captures on a background matched to the target's mean background L; outline alpha-falloff width metric; erosion applies to interior metrics only. |
| R2Z8 | PROPOSE FIX | Turntable webm (MSAA on/off) graded in P3 and P5 gates. |
| R2U1 | PROPOSE FIX | G1 = the P3 gate in all four views plus independent judgement. |
| R2U2 | PROPOSE FIX | Crown = top 30% of hair-mask rows per column (count from the mask, not a fixed box); smoothing = 5-row box. Both report-only constants until a sensitivity sweep (0/3/6/9 px erosion, 3/5/9-row box) runs in sheen_gate's first run. |
| R2U3, R2C14 | PROPOSE FIX | Target mask = seg.py target_masks, frozen to tracked PNGs. |
| R2U4 | PROPOSE FIX | G4 cap applies at the end of P6; P4 may add tris, recorded per round. "+10%" removed. |
| R2U5, R2U6 | PROPOSE FIX | Superseded by the card-vs-strand gate: measured on runtime renders; direction = abs(card - strand) <= seed spread. |
| R2U10 | PROPOSE FIX | "beats BEST3". |

## Nits

| id | resolution |
|---|---|
| R2U12 | PROPOSE FIX: 1.25 peak ceiling marked new, report-only (no known-good). |
| R2U13 | PROPOSE FIX: header cites the review folder. |
| R2U14 | PROPOSE FIX: 74, with the command. |
| R2U15 | PROPOSE FIX: glossary adds HUANG, A3, censored card round, B5.side, rubric D5, K. |
| R2U16 | PROPOSE FIX: escalations renamed OP1-OP5. |
| R2U17 | PROPOSE FIX: Problem notes the numbers are v3-mask and will be re-measured by sheen_gate.py. |
| R2U18 | PROPOSE FIX: hue/sat and band width marked report-only. |
| R2U19 | PROPOSE FIX: "hair median L at spec 0". |
| R2C9 | PROPOSE FIX: material-tint.ts row removed (already carries onBeforeCompile, :90-97). |
| R2I6 | PROPOSE FIX: P6 option, atlas RGB dropped for single-colour hair (albedo = baseColorFactor x f(ID, AO)), measured against the P3 gate. |
| R2I9 | DECLINE: strand seed spread is the noise floor; calibrate.ts not needed. |

Open after round 2: 0 Blocker, 0 Major unresolved; 5 ESCALATE (OP1-OP5).
