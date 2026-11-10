# Round 4 resolution (Elephant), 2026-11-09

Inputs: round4-{comprehension,critic}.md. Round 4 ran the two personas that carried round 3's Blocker and
most Majors (critic, comprehension).

Elephant check: isolated-subject-lab.ts:298-305 adds AmbientLight #dceee6 1.45, key #ffffff 2.2 at
(3.2, 5.2, 4.1), fill #b6d8ca 1.1 at (-3.5, 2.8, -2.2) when no override, product or studio rig is set.
R4C1 confirmed.

Round 4: 0 Blocker, 12 Major, all resolved below. Stop decision: the EGM rule asks for 2 consecutive clean
rounds (cap 5). Rounds 3 and 4 were not clean. Round 4's Majors are P0/P1 plumbing (harness fields, masks,
scale, build scripts) and two plan changes (default light description, scalp tint location); no
design-level Blocker has appeared since round 3. Further review moves to the P1 worker brief, where the
contract-design gate applies.

## Majors

| id | resolution | text applied |
|---|---|---|
| R4C1 | PROPOSE FIX | Glossary default light = lab default (ambient + white key + teal fill, world frame, no tone mapping, no environment). light_rig_blender takes it as a second input type. Studio branch named separately. |
| R4C2 | PROPOSE FIX | P0 builds twice first; if shas differ, gate = crop maxAbs 0 (sheen3b repro_maxAbs pattern) and the nondeterministic step is recorded. |
| R4C3 | PROPOSE FIX | P0 names EV/sheen3/tools/s3.sh for BEST3; ports EV/cards-opt2 s2m.py and p1/rtm7b.py where the build needs them; cost/grade steps excluded; worktree path a parameter. |
| R4C4 | PROPOSE FIX | P1 plumbing: MaterialOverride gains alphaToCoverage and alphaTest (material-variants.ts:248); HeadCropSpec gains material override, yaw and background; harness passes yawDegrees and records a webm. lab.ts stays pinned. Files added. |
| R4C5 | PROPOSE FIX | Render mask = hideHair difference mask (seg.py render_masks). Background set through applyRigOverride in isolated-subject-rig-variants.ts. |
| R4C6 | PROPOSE FIX | Runtime crop px/mm derived by a landmark fit (frame_fit-style), recorded in frames.json; check: eye row lands within 2 px of the target eye row after resampling. |
| R4C7 | PROPOSE FIX | sheen_gate first reproduces sheen3b/score.txt peak/base/hf for target, r10 and BEST3 to 3 dp under the old masks, then switches definitions. |
| R4C9 | PROPOSE FIX | Scalp tint moves into the card pipeline: a scalp-coloured underlayer card group. apply_scalp_hair_material_region not used (hm08 rail, #387 retirement, body GLB rebake). Round-3 R3I7 fix withdrawn. |
| R4C10 | PROPOSE FIX | Strand seeds 1-6, reference seed 1; tol = max over seeds 2-5 of abs(m_i - m_1), floored by the card perturbation. Proof: seed 6 passes >= 70% of gated cells (exchangeable draws give P(new <= max of 4) = .8) and r10 B lit cards fail at least one gated metric in >= 2 views. |
| R4C11, R4U14 | PROPOSE FIX | R-a gate: per-cell hair irradiance-correlation probe in atlas_from_members.py (cell luminance vs Cycles irradiance at two key azimuths); both r values below the lit atlas's. leak_check.py dropped. |
| R4U1 | PROPOSE FIX | Gate table added (metric, gated or report-only, phase it counts from). |
| R4U2 | PROPOSE FIX | Perturbation = cards rebuilt at clustering seed 1, 2, 3 from strands seed 1; floor = max pairwise card difference. |
| R4U3 | PROPOSE FIX | Parity threshold = .033 on the fit feature vector (Cycles must sit no farther from three.js than three.js sits from the target; 474d2b3a7). |
| R4U4 | PROPOSE FIX | The swept light replaces the fitted rig in G1 and tol once the grader picks it; default stays. |
| R4U5 | PROPOSE FIX | Galacean licence marked unverified; checked before the port. |

## Nits

| id | resolution |
|---|---|
| R4C8 | PROPOSE FIX: P1 runs only spec .15; spec .3 no-map exists (EV/sheen3b/build/ns, sheen3b-v1). |
| R4C12 | PROPOSE FIX: r10 peak .41-.58. |
| R4C13 | PROPOSE FIX: consumes.json path. |
| R4U6 | PROPOSE FIX: BEST3 crops `K065_s03_a50_scDD-*.png`. |
| R4U7 | PROPOSE FIX: :24-32. |
| R4U8 | PROPOSE FIX: spec map 16.78 MB, 22.4 MB with mips. |
| R4U9 | PROPOSE FIX: control decided by tol-free grader call plus streak reported (no tol exists before P3). |
| R4U10 | PROPOSE FIX: probes relabelled a-c. |
| R4U11 | PROPOSE FIX: T9 tagged on P1. |
| R4U12 | PROPOSE FIX: "default light" only; v3 mask, r10 material, grader, gallery defined. |
| R4U13 | PROPOSE FIX: Quest frame time report-only. |

Open: 0 Blocker, 0 Major unresolved; ESCALATE OP1-OP5.
