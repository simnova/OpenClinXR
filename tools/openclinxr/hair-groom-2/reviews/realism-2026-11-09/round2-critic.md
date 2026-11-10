# Round 2, critic + implementation readiness (Goldfish), raw findings, unresolved

- R2C1 Blocker [P1 gate a] control "r10 lit atlas must exceed 1.10" likely fails: EV/r10/tw35ta15sm2/strand-atlas.png per-cell alpha-weighted row-mean L along v, p95/p50 median 1.078 all cells, 1.088 crown cells (top quartile root z), IQR 1.078-1.100. Cause atlas_from_members.py:24-31: members flat in card frame, sun azimuth dropped, R lobe does not travel along v. VERIFIED (atlas). Fix: run the control first; re-test R-a as the band cause.
- R2C2 Major [P1 rigs] rig_to_blender must reproduce RoomEnvironment IBL, HemisphereLight, AgX/exposure (fitted-rig.json: hemisphere 2.28, env room .37, AgX, exposure .74); default rig is ACES, RoomEnvironment, coloured key/fill (isolated-subject-rig-variants.ts:29,238-253). Fix: parity gate, grey diffuse sphere/card in both renderers.
- R2C3 Major [P1 calib] run_cards.sh reads kept.specular from calibration.json and passes calib/strand-atlas-cal.png; flags reach it via env vars only (run_cards.sh:13-16,35-40). Fix: state SP and atlas sources; ALBEDO=1 env.
- R2C4 Major [P1 albedo] no recipe RGB exists (melanin .6, redness .7); step 5 reads via PIL which cannot read multilayer EXR (atlas_from_members.py:353-381). Fix: melanin->RGB rule or fit to strand render; bpy image load.
- R2C5 Major [P2 data map] ID std gate passes on per-texel noise (uniform std .289). Fix: gate along-v ID constancy (share of v-adjacent equal pairs) and across-u change rate.
- R2C6 Major [P2/P4 transport] carry_material accepts only embedded PNG, LANCZOS-resizes above --max-texture (transplant_library_hair.py:86-105,174-175); no KTX2Loader in xr-scene/xr-asset-loading/ui-xr src; runtime mips average IDs. Fix: add transplant_library_hair.py + KTX2 loader to Files; nearest resample, nearest/no-mip sampler for data map.
- R2C7 Major [P2 shader] three r184 sets vertexTangents only with normalMap or anisotropy > 0 (WebGLPrograms.js:303); plan silent on whether GGX aniso lobe stays (double specular). Fix: keep anisotropy > 0 or normalMap, or derive tangent from UV derivatives; disable physical specular when lobes active.
- R2C8 Major [P2 files] isolated-subject-harness.ts (HeadCropSpec has no loader flag, :1252-1265) and head_crops.ts (:21-29) missing. Fix: add both with opt-in hairLobesLoader.
- R2C9 Nit [P2 files] material-tint.ts already carries onBeforeCompile/customProgramCacheKey for fall-through materials (:90-97). Fix: drop row or test only.
- R2C10 Major [P2 step 0] falsifier has no decision rule.
- R2C11 Major [P3 split] alpha .85 varies per texel in a triangle; existing --fringe-blend/--fringe-triangles already builds MASK core + BLEND fringe (transplant_library_hair.py:220-266). Fix: per-triangle rule or extend flags; say which branch the headless harness exercises.
- R2C12 Major [P3 flyaways] zero cards passes the flyaway gate. Fix: outline metric vs target or strand render.
- R2C13 Major [P0] r10 B chain runs through gitignored EV/r10/sp.sh, rtp.sh; "GLB sha" ambiguous (donor 45196c44... vs runtime); BEST3 args not recorded. Fix: tracked script, name gated sha, record BEST3 args.
- R2C14 Nit [Metrics] target mask source unnamed.
