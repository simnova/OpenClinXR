# Round 4, critic + implementation readiness (Goldfish), raw findings, unresolved

- R4C1 Major [Glossary default light, G2, P3] rig-variants.ts:238-253 is the studio branch (only with rigOverride.studio). Real default lab.ts:298-305: ambient #dceee6 1.45, white key 2.2, teal fill 1.1, no tone mapping, no environment; sheen "-def" passes no rigOverride. VERIFIED. Fix glossary; light_rig_blender must also convert this world-frame ambient+directional NoToneMapping rig.
- R4C2 Major [P0 gate] only cards.npz reproduction on record (ba10717a); atlas/donor/runtime byte reproduction never shown. Fix: build twice first; else crop maxAbs 0 (sheen3b repro_maxAbs pattern).
- R4C3 Major [P0 port] rtp.sh calls gitignored EV/cards-opt2/p1/rtm7b.py and cost.py; pt.sh/sp.sh call EV/cards-opt2/s2m.py; worktree paths hardcoded; BEST3 build script is EV/sheen3/tools/s3.sh. Fix: name s3.sh, exclude or port grading/cost, parameterise W.
- R4C4 Major [P1 A2C] HeadCropSpec (harness:1252-1265) has no material/yaw/background field; MaterialOverride (material-variants.ts:248) has no alphaToCoverage/alphaTest; cutoff baked .85 in GLB; harness never passes yawDegrees; no webm capture; lab.ts sha-pinned (8359c9e3a). Fix: plumbing via spec-params + material-variants, yaw/video, add files.
- R4C5 Major [P1 masks/capture] renderer has no alpha (lab.ts:271); background constant #18211d in the pinned module; render masks are the hideHair difference mask (seg.py render_masks). Fix: use hideHair mask; background via applyRigOverride (rig-variants, not pinned).
- R4C6 Major [P1 scale] frames.json fits target to the Cycles canonical frame only; no px/mm for runtime --body-frame 1.5 crops. Fix: derive runtime px/mm, record, known-good check (eye row).
- R4C7 Major [P1 sheen_gate port] no port check. Fix: reproduce sheen3b/score.txt peak/base/hf for target, r10, BEST3 to 3 dp under old masks before switching definitions.
- R4C8 Nit [P1 streak control] spec .3 no-map control exists: EV/sheen3b/build/ns, grades/sheen3b-v1 (BEST3 wins 3/4 fitted; NS hf .032-.038 vs .045-.061). Fix: run only spec .15.
- R4C9 Major [P2 scalp] apply_scalp_hair_material_region serves the hm08 library rail (body_class.py:638-641); Aisha built by tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py; re-enabling reverses #387 retirement and rebakes the body GLB (breaks P0 sha, body pins); def at :278. Fix: scalp tint in the card pipeline (shell or underlayer cards).
- R4C10 Major [P3 tol] 3 seeds = 3 pairs, p90 ~ max; seed 4 passing all cells likely fails by chance; reference seed unnamed. Fix: >= 6 seeds or leave-one-out; name reference seed.
- R4C11 Major [P4 gate] leak_check.py is skin-only (MakeHuman UV, facecore mask, body UV bake). Fix: per-cell hair irradiance-correlation probe in atlas_from_members.py.
- R4C12 Nit [Problem 1] r10 peak .41-.58 (side .576).
- R4C13 Nit [Files] consumes.json at packages/openclinxr/xr-asset-loading/consumes.json.

Verified correct: commit shas, .gitignore:10, runtime sha 04371bc4, BEST3 args, fitted-rig numbers, residuals, probe3 F2, brief :13, K5, R-tex arithmetic, A2C discard, WebGLPrograms.js:302, line refs, skin_shade getDependency precedent, toktx absence, lighting-rig.py:11.
