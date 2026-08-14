# MADR 0052: MPFB graduation — phases, and the hour-by-hour autonomous schedule

Status: Accepted
Date: 2026-08-11
Issue: #296, #301
Related: MADR 0051 (Anny-reference → MPFB match protocol), MADR 0044 (adopt the MH body for garment fit), D11 (MPFB and Anny both first-class, split by job)

## Context

Operator approved 2026-08-11 01:42 EDT. Direction, in their words across this session: Anny stays the
**phenotype source of truth** because it is anchored in datasets; MPFB becomes the **runtime asset**
because of better viseme mapping, eyes and bones; procedural alignment is preferred and LLM-based
alignment is "not ideal but acceptable". Once body types are mapped, re-enable clothing, hair and
animation on the MPFB-based assets.

Also operator, on cadence: steady progress over 8 hours against **actual clock times**, **one
meaningful tick per hour**, **do not strive for perfection**, then alternate **1 h refinement / 1 h
advancement**.

## Measured starting position (this session, not assumed)

| capability | state |
|---|---|
| Rig | **Done.** 137 joints — finger chains, metacarpals, wrist, jaw, `tongue00–07`, facial muscle bones. The Anny rail has 23, with `hand.L/R`, `index_finger_base.L/R`, `foot.L/R` carrying **zero dominant vertices**. |
| Body from phenotype | **Solvable.** Macro Jacobian measured at the 0.5 operating point, central differences over ±0.2. Well-conditioned. Stature already scaled to the Anny reference by `body_param_stage.py:252-260`. **RE-MEASURED 2026-08-14 03:19 — two corrections and one confirmation.** (a) **The solver does not exist.** `solveMacrosForTarget` is absent, there is no Jacobian/macro-solve code anywhere in `tools/` or `packages/`, and **`body_param_stage.py` is not in the tree at all** — the `:252-260` citation above points at a file that does not exist. **CORRECTED 2026-08-14 05:2x: that file IS in the tree**, at `tools/openclinxr/asset-pipeline/makeclothes/body_param_stage.py`, 3,065 lines. Only the `:252-260` line citation was wrong; the 03:19 re-measurement searched the cited path rather than the tree and concluded absence. ~~What is genuinely absent is still `solveMacrosForTarget` — grep for `solveMacrosForTarget`, `jacobian`, `macro_solve` and `solve_macros` across `tools/` and `packages/` returns **zero files**.~~ **WITHDRAWN 05:3x, same hour, by me.** That grep result is accurate and the conclusion drawn from it was wrong: the NAME is absent, the CAPABILITY is not. `solve_height_macro_from_stature` (`body_param_stage.py:2008`) landed under #329 on 2026-08-11 with a green 4/4 contract and a measured artifact. I criticised the 03:19 pass for searching a cited path instead of the tree, then made the same class of error one paragraph later by searching a guessed name instead of the capability. **The forward half of the solver already exists and wires MPFB's own API**: `apply_macros(basemesh, phenotype)` (`:1446`) sets the eight macro channels through `HumanObjectProperties` and calls `TargetService.reapply_macro_details`, and `stature_meters` (`:178`) reads the result. That framing was right about the shape and wrong about the tense: the inverse was **already written** on top of that forward map, and it does exactly what D1 asks — `solve_height_macro_from_stature` calls the existing evaluator rather than re-implementing it. ~~The 02:00-03:00 schedule tick 'Jacobian solver lands' is genuinely **unstarted**.~~ **It is DONE** — see the status column on the schedule table below. (b) **Macros do not come from the phenotype.** *(05:2x CONFIRMED AGAINST BOTH PATHS, after I doubted it and was wrong.* `body_param_stage.py:2104` builds a local dict **named** `phenotype` and that name is misleading — but it is filled from the CLI body-class list with 0..1 macro defaults (`age: 0.5`), never from `actor-phenotype.v1.json`. The one overlapping key, `age`, means clinical years in the authored phenotype and a 0..1 macro here; nothing joins them, so there is no live unit collision. Claim (b) holds for both materialization paths.) `materialize_mpfb_humanoid_candidate.py` derives the MPFB macro dict from a **tracked Anny reference** (#328) and passes it to `HumanService.create_human(feet_on_ground=True, macro_detail_dict=...)`. The authored phenotype is not an input to that path. (c) **CONFIRMED, and it corrects the standing 'phenotype never reaches a vertex' framing for stature:** authored `height_cm` does reach the mesh. `patient_maya_johnson_v1` authored 125 cm -> measured **122.9 cm** (-1.7%); `nurse_kevin_lee_v1` authored 176 cm -> measured **174.3 cm** (-1.0%). Both within ~2 cm. The phenotype is richly authored (`age`, `height_cm`, `bmi`, `build`, `gender_presentation`) in `scenario-fixtures/generated/actor-phenotype.v1.json` — but **only ONE of the 15 shipped scenarios has an exported phenotype** (`peds_asthma_parent_anxiety_v1`, 3 actors). **BMI is UNRESOLVED, not failed:** a waist-girth/stature proxy returned 0.412 for the BMI-16.5 child against 0.208 for the BMI-23 adult, which is inverted AND implies a 36.2 cm waist on a 174 cm man. That is anatomically impossible, so the instrument is untrustworthy and no claim is made either way. A real BMI check needs the landmark instrument under the MADR preconditions (Y-up, feet at y=0, helper-stripped at 13,380), not a circular-cross-section proxy. |
| Measurement | **Done.** Landmark instrument agrees with `anny.Anthropometry` within 0.83 cm (lean) / 0.45 cm (BMI 45); translation-invariant as of #300. |
| Wardrobe | **CORRECTED 2026-08-13 10:20 — "3 `.mhclo`, all shirts" is stale.** Measured on the shipped GLBs: every actor carries **3 fitted garments across 3 slots** plus 7 hide-mask primitives — aisha `toigo_t_shirt` 2,700 / `cargo_pants.001` 2,782 / `toigo_flats` 57,600; kevin `scrub_shirt` 9,384 / `cargo_pants.001` 2,628 / `culturalibre_male_boots` 30,768; child `toigo_t_shirt` 2,700 / `cargo_pants.001` 2,636 / `toigo_mj_cloth_shoes` 1,004. Trousers and footwear are fitted, not just shirts. ~~**Open defect:** the hide-mask boundary is a sawtooth (#364, located 10:12 — mask ring p95 adjacent-Y 4.5-8.1 mm against the garment hem's 0.9-1.4 mm on the same body).~~ **WITHDRAWN 2026-08-13 17:05 — the hide-mask CANNOT RENDER.** Every `openclinxr_hidden_*` material ships `alphaMode=MASK`, `alphaCutoff=0.5`, `baseColorFactor=[0,0,0,0]`, no texture; glTF discards any fragment below the cutoff, and three.js maps `baseColorFactor[3]` to `opacity` so `diffuseColor.a = 0 < 0.5`. Corroborating: if it drew it would be a black torso band, and no capture shows one. The mask ring measurement was correct and aimed at an invisible object. **The visible sawtooth is the `cargo_pants` WAISTBAND TOP ring** — p95 adjacent-Y **22.9 / 9.6 / 17.3 mm** (aisha/kevin/child) against the shirt hem's **1.40 / 0.89 / 1.35 mm** on the same body, 16-23x. The shirt hem is not the visible edge either: it is tucked **9.6-16.3 mm inside** the trousers across all 20 shared angular buckets, zero z-fighting. Also measured: **7 fully-discarded mask primitives ship per actor** (~4,570 verts on aisha) costing draw calls and vertex shading for nothing. All three actors share `cargo_pants.001`. **RE-MEASURED 2026-08-14 02:19 AND THE SAWTOOTH IS GONE — this row's headline defect no longer exists.** The `cargo_pants` waistband TOP ring, same instrument (7-neighbour circular moving average on Y ordered by angle, 14 mm band), now measures p95 **1.15 mm (aisha) / 1.21 (kevin) / 1.18 (child)** against the recorded 22.9 / 9.6 / 17.3 — a **20x / 8x / 15x** improvement, landed by #373's rim regularization. Against the shirt hem on the same body (1.67 / 0.47 / 1.49) the waistband is now **smoother than the hem on two of three actors** (ratio 0.7 / 2.5 / 0.8), inverting the 16-23x gap this row records. Recorded because a stale defect row is how #368 cost 105 turns: a worker dispatched at work already done. **Still true from this row:** all three actors share `cargo_pants.001`, and 7 fully-discarded `alphaMode=MASK` hide-mask primitives still ship per actor (~4,570 verts on aisha) costing draw calls for nothing. **Also still true:** kevin's trouser/boot overlap was a real defect and was fixed separately by #378 (28/36 buckets, 0 pants-outside, from 5/25). |
| Eyes | ~~`add_mpfb2_eye_rig.py` exists. Unverified at runtime.~~ **VERIFIED AT RUNTIME 2026-08-14 — this row was stale and closed two issues that were already done (#337, #340).** Geometry: all three MPFB actors ship `eye.L`/`eye.R` nodes plus a 172-tri eye primitive with a bound 1024² iris texture (`blue_eye` / `brown_eye`). Least-squares sphere fits give **11.25 mm** (child) and **12.00 mm** (aisha, kevin) — anatomically sized as of #377, down from 29.7–32.1 mm. Drive: `applyGazeToHumanoid` is **called at `apps/ui-xr/src/main.ts:8116`** and rotates `EYE_BONE_LANDMARKS`-resolved bones via `rotateOnWorldAxis` — wired, not merely imported (the #6z check). Lids: 6 eye FACS morphs resolve; `eye-*-closure` seals the palpebral aperture (child 8.05 → **−1.48 mm**, aisha 7.63 → **−1.92**, kevin 7.07 → **−2.44**) and #379 wired the blink clock to them. Contracts green on main: `eyes-have-an-iris` 9/9, `gaze-eye-bones-resolve-on-every-rail` 3/3. **Remaining, measured:** `applyGazeToHumanoid` applies **yaw only** — no pitch, and both eyes share one yaw so there is no vergence. |
| Visemes | **CORRECTED 2026-08-11 — my "absent" claim was wrong.** The 10 *morph targets on the exported GLB* are body macros, but the MPFB install ships **102 expression unit targets** and **110 mouth/lip targets** (`mouth-upperlip-middle-up`, `mouth-scale-horiz-incr`, …). Zero files match `visem`/`phonem`, so **face action units ship and visemes must be COMPOSED from them** — FACS-style. Materially better than absent; not ready-made. **RE-MEASURED 2026-08-11 07:10 on the SHIPPED GLBs, and the rails are inverted from how this row reads:** every Anny-rail morph target is a constant-vector rigid translation (identical magnitude on every moved vertex, sd exactly 0, ONE direction) — `openclinxr_mouth_open` slides 859 verts 2.2 cm, `openclinxr_brow_concern` slides the whole figure including garments and shoes 1.56 cm. The nine `viseme_*` names on that rail are stubs. Meanwhile **both hm08 library bodies already export 32 real FACS morphs** (`mouth-open`: 4,549 verts, 0.1 mm–3.9 cm spread, **653 distinct directions**; `eye-left-closure`: 462 verts, 59 directions), unreachable only because the runtime keys on `openclinxr_*`. So P4's gap is **name resolution plus a bake that loads the targets**, not missing capability — and the Anny rail is NOT the fallback it appears to be. Detail and method (magnitude spread + direction count, since coherence alone cannot separate a stub from a jaw-drop) on #224. **RE-MEASURED 2026-08-12 21:20 and this row is now wrong in TWO places.** (a) The bake half is DONE: the 32 FACS targets are not only on the hm08 library bodies — all three **shipped MPFB actors** (aisha, nurse Kevin, child) export them on **7 primitives each**, 13 of them mouth/lip/jaw. So the gap is name resolution ALONE, not "resolution plus a bake". (b) The remaining gap is speech-only: calling the real runtime resolver against each body's dictionary, the two canonical expressions resolve **2/3** (`openclinxr_mouth_open`->`mouth-open`, `openclinxr_brow_concern`->`eyebrows-left-inner-up`; `cheek_tension` is a deliberate null, no cheek target ships) while **0 of 9 visemes resolve** — every one of `viseme_sil AA E IH OH OU FV TH L` returns null on all three actors. `morph-target-resolver.ts` carries exactly two alias entries and no speech row, and its header reasons that "no `viseme_*` targets, so no viseme alias can exist" — which does not follow from this row's own "visemes must be COMPOSED from action units". Thirteen mouth action units ship. Contract: `tools/openclinxr/evidence/mpfb-actors-can-speak.test.ts`. **RE-MEASURED 2026-08-13 17:25 AND THIS ROW IS NOW STALE IN ITS HEADLINE: name resolution is DONE.** Calling the real `resolveMorphTarget` against each shipped actor's own morph dictionary (32 names each) resolves **13 of 14** canonical names on **all three** actors — all nine visemes (`sil`->`mouth-compression`, `AA`->`mouth-open`, `E`->`mouth-retraction`, `IH`/`TH`->`mouth-part-later`, `OH`->`mouth-eversion`, `OU`->`mouth-protusion`, `FV`->`mouth-elevation`, `L`->`mouth-parling`), both expressions, and both eye-closure names. The single NULL is `openclinxr_cheek_tension`, the deliberate null (no cheek target ships). #353 wired the speech rows and #354 the eye rows. **The runtime chain is also wired end to end**, not just the map: `main.ts:8857` phonemes -> `driveVisemeTimeline` -> `applyVisemeWeights` -> `resolveMorphTarget` -> live mesh morphs, with a per-actor `phonemeMap` asset (`source: "local_dialogue_phoneme_viseme_mapping"`). **The remaining P4 gap is neither naming nor wiring — it is deterministic phoneme TIMING from audio** (D9's Rhubarb station); the runtime cue already scopes itself `notEvidenceFor: "production phoneme timing"`. **SUPERSEDED 2026-08-14 (#382), and the Rhubarb half was wrong twice over.** (a) **Rhubarb is NOT APPLICABLE** — the licence ledger already records it: it consumes AUDIO and this repo has **zero** audio assets and no TTS provider (0 `.wav`/`.mp3`/`.ogg` under `apps/` and `packages/`), so the named station presumed a pipeline that does not exist. (b) **Timing never required audio.** #375 landed CMUdict-backed `phonemesForText`, so text → phones → durations → timeline is fully deterministic and offline, with no model in the loop — which is D9's actual answer; Rhubarb was one implementation of it and the blocked one. **#382 landed duration-weighted dwell:** `mapDialoguePhonemesToCues` assigns per-phone dwell (vowels 0.24 s, nasals 0.12 s, stops 0.08 s, fricatives/glides/sil 0.16 s) and `pickFrame` selects by cumulative time instead of `floor(progress × frameCount)`. Measured on main over a 42-phoneme shipped-bank utterance: **vowel:stop dwell ratio 1.00 → 2.80**, dwell coefficient of variation ~0 → **0.444**, minimum dwell 4 samples (no phoneme dropped). **Still open, measured:** the dwell constants are class averages, not corpus-derived; CMUdict stress (`AA1` vs `AA0`) is available and unused; no coarticulation; no graded capture of a mouth mid-utterance exists. |
| Hair | **CORRECTED 2026-08-13 11:22 — "absent on every rail" is stale for coverage, still true for geometry.** #359 ported the Anny scalp **material region** to the MPFB rail: dark hair now covers the full scalp symmetrically and wraps behind both ears on 3/3 actors, graded in pixels, and the floating crown artifact is gone. But the structure pass shows **zero hair geometry** — the scalp is bare mesh and the coverage is texture. **Open defect:** the hairline is a hard stair-step on 3/3. **MEASURED 2026-08-13 17:15, and it is now the top visible face defect** — graded at 1024x1024 head framing (`.openclinxr/evidence/mpfb-scalp/mpfb-head-front-child.png`), the stair-step reads harder than the flat skin does. The scalp is a **material region on the body mesh**, so vertices whose positions appear in BOTH the scalp and skin primitives are exactly its boundary ring (183/151/201 verts). Forehead sector (±55° of +Z), ordered by angle about the head axis, natural arch removed by a 7-neighbour moving average: high-frequency residual **9.80 / 16.37 / 14.31 mm median** and **55.6 / 69.5 / 54.6 mm p95** on a 113-155 mm arch — **10-12x the mesh's own median edge length** (4.7-6.0 mm), so this is NOT simple quantisation to topology, which would give ~1x. Suspected mechanism (hypothesis, not measured): a material-assignment boundary on body topology with no alpha to soften it. Instrument caveat: an earlier pass ordering the seam by X was an invalid traversal of a curve that wraps the head; treat the p95 as indicative and the pixels as the finding. ~~**Geometry hair remains blocked on acquisition, re-verified 11:20:** no `hair` path under `mpfb/data`, and no `.mhclo` hair asset anywhere on this machine.~~ **WITHDRAWN 2026-08-13 21:25 — WRONG IN BOTH HALVES, and it would have sent an hour at a licence chase that is already finished.** (a) **25 hair `.mhclo` files ARE cached** at `.openclinxr-local/provider-cache/hair/sources/makehuman-hair01/extracted/hair/` — acquired 2026-08-11 (#330). (b) The licence question is **settled and machine-gated**: `hair-licence-classify.ts` parses every staged `.mhclo`'s OWN header, giving 10 x AGPL3 (hard refusal), 6 x CC0, 2 x CC-0, 2 x CC-BY, 4 unlicensed (refused). Usable subset = the six `toigo_*` bobs, CC0/CC-BY **and** zero helper-vertex refs. (c) **Geometry hair is already FITTED AND SHIPPING** — `body-param-adult_lean_female-library.glb` carries `openclinxr_fitted_hair_toigo_blunt_bob_with_bangs_` at **4,976 tris**, weighted to `mixamorig:Head`, via `embed_library_hair.py` -> `ClothesService.fit_clothes_to_human`, wired as an unconditional `body-param-cli.ts` finish step behind a licence gate. **So this is an ENGINEERING item, not an acquisition one.** The real gap, measured on the shipped bytes: the three MPFB cast actors (aisha, kevin, child) carry only `openclinxr_mesh_native_scalp_hair_surface` (the painted region, 2,008-2,400 tris) and **zero fitted hair geometry**. A proven, licence-cleared fit exists on the library rail and no cast actor consumes it — the factory's characteristic defect (D9). **One real constraint to carry into that slice:** the licence-clean zero-helper subset is entirely feminine styles, so `body-param-adult_heavy_male-library.glb` is a recorded skip and **kevin has no clean option today** — a bob on a male nurse would regress realism. That is a per-actor gap, not a blocker on the female actors. |
| Runtime | ~~1 real MPFB actor (OB patient Aisha).~~ **THREE MPFB actors ship, measured 2026-08-14:** `mpfb-ob-patient-aisha` (16,960 skin tris, 1,646 mm), `mpfb-peds-nurse-kevin` (16,674, 1,743 mm), `mpfb-peds-patient-child` (17,378, 1,229 mm). Phenotype reaches vertices on this rail — stature and build differ per actor; the older "every adult is one body" finding is **Anny-rail only** and must not be inherited here. 22 case fixture files. **15** scenario bundles ship (not 12), and since #101 the routine room capture enumerates all 15 rather than a hardcoded pair. |

## Girth solving — SUPERSEDED 2026-08-11: use the shipped measure targets, not a macro Jacobian

**What was going to be hand-rolled:** a coupled Newton/finite-difference solve over the six macros,
using the Jacobian below, to hit chest/waist/hip together.

**Do not build that.** MPFB2 ships **40 `measure-*.target.gz` files** (`data/targets/torso/` and
`arms/ feet/ hands/ legs/ neck/`) — waist, bust, hips, underbust circumference, plus limb girths. They
are invisible in the UI (`data/targets/target.json`'s `"measure"` section is an empty stub and
`ui/new_human/randomize/characterbuilder.py:185` filters it out) but load fine via
`TargetService.load_target(obj, full_path, weight=…, name=…)`.

**Measured 2026-08-11, one target at a time on a fresh default body**, girths through the repo's own
landmark instrument, artifact at `.openclinxr/evidence/measure-target-probe/orthogonality.json`:

| target @ weight 1.0 | ΔChest cm | ΔWaist cm | ΔHip cm | selectivity |
|---|---:|---:|---:|---:|
| `measure-waist-circ-incr` | 0.10 | **9.73** | 0.00 | **98×** |
| `measure-bust-circ-incr` | **16.82** | 0.87 | 0.00 | **19×** |
| `measure-hips-circ-incr` | 0.00 | 0.00 | **16.02** | **8890×** |

Baseline chest 0.8978 / waist 0.7225 / hip 0.9674 m.

**Consequence for P1.** The macros are strongly COUPLED — `weight` moves waist +0.0944 and hip +0.0917,
a selectivity of ~1.03× — while these targets are 19–8890× selective with 10–17 cm of range each. So the
solver is **independent 1-D bisection per girth**, not a coupled multivariate solve: set stature and
build from macros first, then bisect each girth on its own target. Cheaper, more stable, and it
converges per-girth instead of trading chest error against waist error.

**NOT TESTED, and each is a real gap:** only the `+incr` direction, only at weight 1.0, only on the
DEFAULT macro operating point. The `-decr` targets, intermediate weights, linearity across the weight
range, and whether selectivity holds on a heavily-macro'd body are all unmeasured. The bust target's
0.87 cm leak into waist is small but not zero, so bisect waist AFTER chest if both are targeted.

**Licence caution.** MakeHuman's `0_modeling_a_measurement.py` `Ruler` class is the only prior art for
converting these to cm, and it is **AGPL-resident — do not vendor it or its vertex-index chains.** The
repo's own landmark instrument already measures girth and is what the table above used.

**The measured Jacobian** — `∂landmark/∂macro`, metres per unit macro, at all-macros-0.5 — retained
because it still governs stature and build, which the measure targets do not touch:

| macro | stature | shoulder | chest | waist | hip |
|---|---:|---:|---:|---:|---:|
| weight | 0.0000 | 0.0106 | 0.0363 | **+0.0944** | +0.0917 |
| muscle | 0.0000 | 0.0029 | 0.0301 | **−0.0832** | −0.0577 |
| gender | −0.0317 | **+0.0810** | 0.0654 | 0.0240 | 0.0237 |

Baseline: stature 1.7138, shoulder 0.6572, chest 0.9111, waist 0.7606, hip 1.0221.

Three consequences that shape the plan: **weight and muscle oppose on waist**, so the system is not
degenerate; **weight and muscle move stature by exactly 0.0000**, so girth solving cannot disturb the
reference-driven stature; and **gender is the only coupled knob**, so it is set from the authored
presentation FIRST and the girth solve runs after.

## Decision — phases

- **P1 Body.** Phenotype → MPFB macros by Jacobian solve, matched to the Anny reference, verified by
  landmark deltas inside MADR 0051 §5 bands. Everything downstream depends on a correct body.
- **P2 Cast.** From one MPFB actor to a full station cast; `humanoid-runtime-asset-url` wired so a
  learner loads MPFB bodies.
- **P3 Wardrobe.** `.mhclo` fitted onto MPFB-matched bodies. Lower-body coverage is the real gap.
- **P4 Face.** Eyes verified live, then viseme shape keys — the reason D11 names MPFB for lip-sync.
> **P4 STATUS RE-MEASURED 2026-08-14 13:2x — the viseme half is WIRED, not unstarted.** I came to this
> hour expecting to operationalize "drive the visemes" and found the resolution layer already built.
>
> `MPFB_FACS_MORPH_NAMES` (`packages/openclinxr/asset-registry/src/morph-target-resolver.ts:54`) maps
> canonical runtime names onto the MPFB FACS set, with an Action Unit justification per row —
> `viseme_AA -> mouth-open` (AU26 jaw drop), `viseme_OU -> mouth-protusion` (AU18 lip pucker),
> `viseme_E -> mouth-retraction` (AU20 lip stretcher), and six more, plus both eye closures.
>
> Resolved against the SHIPPED bytes (target names read with NodeIO, fed to `resolveMorphTarget`):
>
> | actor | targets | canonical names resolved |
> |---|---:|---|
> | `mpfb-ob-patient-aisha` | 32 | **13 / 14** |
> | `mpfb-peds-nurse-kevin` | 32 | **13 / 14** |
> | `peds_nurse_kevin` (Anny) | 25 | 11 / 14 |
>
> The only MPFB miss is `openclinxr_cheek_tension`, and the resolver says why in its own header: *"no
> honest FACS equivalent in the shipped 32-target set (no cheek target)"* — a declared absence, not a
> gap. **The MPFB rail resolves more canonical names than the Anny rail it replaces.**
>
> And the targets are anatomically clean, which the Anny rail's are not: per-target displacement is
> 0.24–11.22% of vertices confined to 84–96% of stature (eyes 92–94%, brows 93–96%, mouth 85–92%).
> Compare #316 on the Anny rail, where `jaw_open`, `smile` and `eye_blink_l/r` move **100% of every
> vertex**.
>
> **CORRECTED 13:4x, same hour, by me.** I wrote here that "nothing has verified that writing
> `viseme_AA` produces measurable mouth displacement at runtime". **False — #365 did exactly that on
> 2026-08-13** and its contract `viseme-capture-produces-distinct-shapes.test.ts` is green with **zero
> `it.fails`**: the capture runs, the dominant viseme takes >=5 distinct values, weights are
> non-trivial, and every dominant target is a mouth/lip/jaw morph. Its own header records
> `mouth-protusion` and `mouth-compression` **observed at weight 1.0 on MPFB bodies in a live scene**.
>
> **And the source chain is complete too.** #375 replaced the spelling-based classifier with
> `DIALOGUE_PRONUNCIATIONS`, a bank-scoped **CMUdict** extraction (build-time input, CMU BSD);
> `dialogue-visemes-follow-pronunciation.test.ts` passes **4/4**, including homophones producing
> identical sequences — which #376 had measured failing 0 of 5.
>
> **So P4 is substantially COMPLETE, and it is already dark-factory compliant:**
> `dialogue text -> CMUdict pronunciation -> viseme -> MPFB FACS morph`, deterministic end to end,
> no audio stage, no Rhubarb, no LLM. This is the third capability I have looked for by NAME today and
> found already present under a different one — the same error this document's own "Why this column
> exists" note records about `solveMacrosForTarget`. **Search for the capability: the artifact, the
> contract, the measured number.**
>
> What is genuinely NOT verified for P4: that a human sees the mouth move. #365's header records
> screenshots at ~500 ms each throttling its own sampling, so the visual half is thin — that is a D12
> grade, not a mechanism gap.
>
> NOT TESTED: no viseme weight has been driven and measured; no audio, no Rhubarb, no capture; only
> `mpfb-ob-patient-aisha` and `mpfb-peds-nurse-kevin` were enumerated; whether the encounter loop
> reaches this code at all (#224 records morph payload the runtime cannot drive).

- **P5 Motion.** Retarget onto the chosen rig. **#70's premise is FALSE and is withdrawn here:**
  Mesh2Motion is a **browser web app** — no CLI, DOM-coupled, its retarget tool is manual drag-and-drop —
  so it cannot run headless and was never a viable motion path, only an unused one. Salvage: its ~150
  clips are CC0 and export as GLB. The real path is **`retarget_bvh`** (Diffeomorphic, ex-MakeWalk),
  which is headless-capable (`setSilentMode(True)`) and ships bone maps that match MPFB rigs exactly.
  **`retarget_bvh` is GPL-2.0-or-later: build-time tooling only**, same posture as MPFB's AGPL, never a
  shipped dependency.
> **P5 FIRST BIND LANDED AND GRADED 2026-08-14 12:3x** (not by the hourly loop — landed on main as
> `56c7eee5` + `d88ac161`). `retarget_bvh` bound `cmu_07_01_walk.bvh` onto
> `mpfb-peds-parent-aisha`'s standard rig via `mcp.load_and_retarget`
> (`bl_ext.user_default.retarget_bvh`): **22 driven bones, 318 keyframes on clavicle.L, 16.53 rad
> total rotation**, output to a candidate `mpfb-peds-parent-aisha.motion-bind.glb` (361 KB, NOT the
> shipped actor). `claimScope: one_actor_one_clip_retarget_bind_not_a_motion_library` — honestly
> scoped. The consumer exists: `candidate-capture.ts` now prefers `retarget_cmu` clips in
> `body_motion_probe`, so this is not an orphan stage.
>
> **Orchestrator grade (pixels, 6.16 s webm at 1280x1280), CORRECTED 12:5x:** frame diff against
> t=0.2 s rises monotonically — 292,532 -> 454,617 -> 621,253 px changed by >10 grey at t=1.5/3.0/4.5 s,
> and at t=3.0 s the figure is posed with arms down and one leg forward, not the A-pose of the static
> capture. **My first write-up concluded from that "a turntable cannot change an arm pose, so the
> retarget drives the rig". That inference is unsound and is withdrawn:** the same GLB also carries
> `ClinicalIdleConversation`, which moves the arms down too, so the pose does not discriminate between
> the clips.
>
> **What is actually established:** (a) the bind is in the file — `openclinxr_retarget_cmu_07_01_walk`
> is one of three animations in the candidate GLB, read with NodeIO; (b) the capture path selects it;
> (c) something is animating, by the frame diff.
>
> **(b) RESOLVED 14:0x with a control, and it restores the conclusion my unsound argument had cost.**
> `selectBodyMotionProbeClipName` is a pure function; fed the candidate GLB's actual animation list it
> returns:
>
> ```
> ["ClinicalIdleConversation", "openclinxr_retarget_cmu_07_01_walk", "ClinicalExpressionMicroTransition"]
>     -> "openclinxr_retarget_cmu_07_01_walk"
> control, retarget clip removed
>     -> null
> ```
>
> **The idle is not a fallback for this probe — without the retarget clip it selects nothing at all.**
> So the motion in the graded webm could only have come from the walk. The arm-pose argument stays
> withdrawn (it was unsound: the idle *does* lower the arms), but the conclusion it was reaching —
> that the retarget drives what was captured — now holds by a different and checkable route. §10l:
> when an overturning is scoped too widely, a correct conclusion gets discarded with the bad reasoning
> that reached it.
>
> **A second self-correction worth recording, because it nearly went the other way.** On seeing
> `b9cb5de6 "export skinned mesh with the motion-bind walk clip"` I measured the `56c7eee5` blob at
> **meshes=0, tris=0** and concluded I had graded a mesh-less file. **Wrong.** Timestamps: the mesh
> fix reached disk at 12:39:26 and my capture wrote at **12:40:14** — the file I rendered already had
> its 94,985 triangles. The 361 KB mesh-less version was only the historical git blob. **Check the
> artifact's mtime against the commit before concluding you graded the wrong thing.**
>
> NOT TESTED: one actor, one clip; the shipped GLBs still carry only the two hand-authored clips
> (`ClinicalIdleConversation`, `ClinicalExpressionMicroTransition`), so nothing a learner loads is
> retargeted yet; no foot-slide, ground-contact or clinical-plausibility measurement was made.

> **P6 PUBLISHABILITY VERDICT — 2026-08-14 15:2x, the 15:00 advancement tick. NOT PUBLISHABLE YET,
> and the blocker is one actor.**
>
> P6 says *"website only on a real win (D12)."* This is the gate check. P1 and P4 are done, P2/P3 are
> frozen by the dark-factory campaign close, P5 is the campaign's own leftover — so P6 is the only
> reachable phase, and its honest answer is a refusal.
>
> **Best candidate artifact:** `.openclinxr/evidence/peds-station-recheck/` — the peds asthma station,
> the one fully-MPFB cast (3/3), carrying four fixes landed today: derived camera (#398), fitted hair
> on the child (#399), a dedicated rose parent (#388), and the waistband re-contour (#341 r19). All
> three actors framed and rendering.
>
> **Measured blockers on the shipped bytes:**
>
> | actor | placeholder scalp | fitted hair | upper garment |
> |---|---:|---:|---|
> | `mpfb-peds-patient-child` | 0 | 4,976 tris | `0.720,0.680,0.550` — **skin-adjacent tan** |
> | `mpfb-peds-parent-aisha` | 0 | 4,976 tris | `0.420,0.360,0.400` rose |
> | **`mpfb-peds-nurse-kevin`** | **1,506 verts** | **0** | `0.050,0.480,0.520` teal |
>
> **Kevin is the blocker.** He is the only actor still carrying
> `openclinxr_mesh_native_scalp_hair_surface` — 1,506 verts of flat 2.8%-luminance paint over a 27–37%
> skin atlas, spanning the eye band. The campaign graded it independently as a **"scalp tear"**
> (its leftover #2). **And he cannot be fixed:** 10 of the 25 styles in `hair01` are AGPL3, 4 are
> unlicensed, and every licence-clean style in the usable subset is a feminine bob — he is a recorded
> male skip. Retiring the paint without a replacement leaves a bald head (§6p).
>
> **Two further blockers, both recorded elsewhere and neither fixable under the freeze:**
> the child's tan is skin-adjacent (#400, closed unlanded — its fix rebakes a frozen asset), and the
> parent's head spikes in some frames (#402 = campaign leftover #5, the CMU walk clip).
>
> **So the verdict is: three of four fixes are visibly good and the station still cannot be published**
> — one unfixable-under-licence scalp, one frozen colour, one known gait artifact. Publishing it would
> be the #56 failure this repo already committed once: shipping a capture whose defects a skeptical
> viewer sees immediately.
>
> **The cheapest route to a publishable frame is procurement, not engineering:** one licence-clean
> masculine hairstyle for kevin. That is an operator decision and is already recorded in
> `operator-steering-needed-questions.md`.
>
> NOT TESTED: whether kevin's scalp reads as a tear at station distance (graded at 4096 isolated;
> ~30 px in a 1440 station frame); whether any of the other 13 stations is closer to publishable —
> they are all Anny-rail, which carries blob footwear and painted garment bands, so almost certainly
> not; no website change was made or proposed.

- **P6 Evidence.** Graded captures per phase; website only on a real win (D12).

**Hair: UNBLOCKED 2026-08-11.** Operator approved CC0/CC-BY. Acquired `hair01`, 25 `.mhclo` + 25
`.mhmat`, into the provider cache with a provenance stamp, tracked in
`docs/openclinxr/third-party-asset-licence-ledger.md`. Hair is clothing in MakeHuman topology terms, so
it fits the **existing** `ClothesService` path — the same one wardrobe uses (P3), not a new mechanism.

> **LICENCE CLAIM CORRECTED 2026-08-14.** This paragraph said *"26 hairstyles, CC0 1.0"*. That was a
> **pack-page** reading and #330 overturned it by parsing all 25 `.mhclo` headers
> (`.openclinxr/evidence/issue-330/hair-licence-classification.json`):
> `total 25 | usable 9 | refusedCopyleft 10 | refusedUnlicensed 4 | refusedTopology 2`.
> **Ten are AGPL3 — a hard refusal — and four state no licence at all. DO NOT GLOB THIS PACK.** The
> attribution-free usable set is the six `toigo_*` bobs (CC0, zero helper-vertex refs);
> `culturalibre_hair_06` is CC-0, and `o4saken_long01` / `elvs_reverse_french_braid_bun` are CC-BY
> and carry an attribution obligation that must reach any shipped build. This is the same pack-page
> error the ledger already corrected once for `makehuman-shirts01`.
>
> **Consequence for the schedule:** `mpfb-peds-nurse-kevin` is a **recorded male skip**, not an
> unstarted item — every licence-clean style in the usable subset is a feminine bob, so there is no
> clean masculine style to fit him. Only the child was ever reachable, and that is #399.
**Hair therefore joins P3 rather than becoming its own phase**, and lands in an advancement hour after
the first garment is fitted to a solved MPFB body.

The geometry-nodes `haireditor` pack was researched and **refused**: no licence stated. It is what
MPFB's `haireditorservices.py` looks for and the better long-term (procedural, D2) route, so a licence
clarification upstream is worth chasing — recorded in the ledger's REFUSED table.

**Still NOT scheduled, because it is not an engineering blocker:**
- **Phenotype for the other 13 cases** is clinical authoring (#293). No pipeline slice moves it.

## Rig decision — `mixamo_unity`, taken before runtime wiring

**Decided 2026-08-11, verified locally against the installed 2.0.15 rig JSONs.** `mixamo_unity` is a
**strict superset** of `mixamo`: 64 bones vs 52, **nothing dropped**, and the 12 extras are exactly

`mixamorig:Jaw` · `LeftEye` · `RightEye` · `Left/RightOrbicularisTop` · `Left/RightOrbicularisBottom` ·
`Left/RightBreast` · `Left/RightButtock` · `Root`

So one rig serves **retargeting** (all 52 `mixamorig:` names match by name), **gaze** (eye bones, the
08:00 tick), **lip-sync** (`Jaw` plus the composed visemes above), and **root motion**. There is no
trade-off to weigh. **Take this before the 06:00 runtime-wiring tick** — changing rigs afterwards is
expensive.

Rejected: `default`/`default_no_toes` (163/137 bones) — richer, but `retarget_bvh`'s `makehuman.json`
map is a **trap** against it: the fingerprint matches so retargeting auto-detects MakeHuman, then
silently fails to drive spine, neck and shoulders because the map targets MakeHuman 1.x naming
(`neck`, `spine2–4`) that MPFB2 does not use (`neck01–03`, `spine01–05`).

**Trap to carry:** the rig JSONs use **two incompatible schemas**. `rig.mixamo.json` and
`rig.openpose.json` are WRAPPED (`{bones:{…}}`); the other six are FLAT. A naive `json.load()` reports
**4** bones for mixamo. Always unwrap with `d.get("bones", d)`. Verified counts: default 163,
default_no_toes 137, mixamo 52, **mixamo_unity 64**, game_engine 53, cmu_mb 31, openpose 24.

## The schedule — one meaningful tick per clock hour

Approved 01:42 EDT 2026-08-11. Times are local (EDT).

| clock | tick | done means | status (MEASURED 2026-08-14 05:3x) |
|---|---|---|---|
| 02:00–03:00 | Jacobian solver lands | `solveMacrosForTarget(landmarks)` + contract solving the Anny lean-female reference inside ±2 cm | **DONE — landed 2026-08-11 under #329.** The function is named `solve_height_macro_from_stature` (`body_param_stage.py:2008`), not `solveMacrosForTarget`, with `derive_macro_dict_from_authored_phenotype` (`:1845`) feeding it. Contract `mpfb-body-honours-authored-height.test.ts` is green, 4/4, no remaining `it.fails`; its clause (4) is the Anny-reference solve plus the loud refusal. |
| 03:00–04:00 | Solver drives a real bake | one MPFB body generated from an Anny reference end to end, landmark deltas recorded | **DONE for STATURE, not for full landmarks.** `solve_phenotype_macro_artifact.py` produced `.openclinxr/evidence/issue-329/phenotype-macro-solve.json`, measuring each solved body's stature against MPFB's own mesh. Stature deltas recorded; a full landmark delta table was **not**. |
| 04:00–05:00 | Graded capture | lit + structure pair; orchestrator grades pixels; first honest MPFB-vs-Anny image pair | **DONE 05:49.** Same character, both rails, isolated single-asset captures, self-check agreed on both (4.4e-4 Anny / 4.1e-4 MPFB): `2026-08-14T09-49-06Z/peds_nurse_kevin` and `2026-08-14T09-08-56Z/mpfb-peds-nurse-kevin`. **The defects are DISJOINT across the rails, which is D11 arriving as evidence rather than preference.** Measured, not read off the pixels: *upper garment* Anny **fitted 7,730 tris** (2 meshes) vs MPFB fitted 4,164; *lower garment* Anny **none — painted on the body** (#73) vs MPFB fitted 2,498; *footwear* Anny **80 + 80 tris** (grey lumps with toes poking through) vs MPFB **30,768** (real boots, 384x); *colour* Anny correct scrub teal vs MPFB near-black (#386); *hair* Anny present vs MPFB absent, so the 2.8%-luminance scalp reads as facial damage (#387). **Neither figure is presentable and neither rail dominates.** *Correction to my own grade:* I read the Anny top as painted from the pixels; it is fitted at 7,730 tris. The TROUSERS are the painted part. A pixel grade says *that*, never *why* (§7q). |
| 05:00–06:00 | Second + third actor | one case's full cast through the solver; per-actor delta table | **DONE — same #329 artifact.** All three actors of `peds_asthma_parent_anxiety_v1` solved, with the per-actor delta table this row asks for: nurse 176.0→175.56 (0.44 cm), parent 166.0→165.99 (**0.01 cm**), child 125.0→124.82 (0.18 cm); `refused=false` on all three. |
| 06:00–07:00 | Runtime wiring | that case's actors resolve to MPFB; UI-XR loads them | **DONE — landed under #335.** Measured 06:2x by calling `resolveScenarioActorCast("peds_asthma_parent_anxiety_v1")`, not by reading the comment: patient -> `mpfb-peds-patient-child.glb`, family -> `mpfb-ob-patient-aisha.glb`, nurse -> `mpfb-peds-nurse-kevin.glb`. **All three MPFB.** For context the same call shows peds asthma is the ONLY fully-MPFB cast — OB triage is 1/3 (patient only), ED chest pain 0/3. |
| 07:00–08:00 | Wardrobe on MPFB | one `.mhclo` fitted to a solved MPFB body; poke-through measured | **substantially DONE ahead of schedule** — #199 fitted the CC0 `toigo_fisherman_sweater` to `mpfb-peds-nurse-kevin` (2026-08-14), reaching 97% of the elbow→wrist axis. Poke-through per se was not the measured quantity. **RE-CHECKED 07:2x and it is still not measured — filed as #392 with the instrument specified.** What exists (`overlapping-garments-do-not-interpenetrate`) is garment-vs-garment (kevin's cuff against his boot), not body-vs-garment. My own first attempt at a body-vs-garment measure was **invalid**: bucketing skin radially against the upper garment's envelope scores bare arms as poke-through — aisha came out at **479 mm**, half a metre. Radius alone cannot separate 'a bare arm beside the torso' from 'skin through the shirt'. The discriminator that can is on the mesh already (`JOINTS_0`/`WEIGHTS_0`, 137 canonically-named joints) and the tool is proven (`_bone_dominant_vertex_indices`, `body_param_stage.py:724`) — classify by dominant bone, measure torso-only. **DONE 07:4x — #392 landed (`26eecc0c`) and poke-through is essentially ABSENT.** Bone-classified, upper garment, bind pose: kevin torso 4,811 verts / 4,261 arm excluded / **0 poking**; aisha 6,468 / 4,412 / **2** worst 3.91 mm; child 5,584 / 4,406 / **3** worst 10.23 mm. My invalid radial metric had said 148 / 1,512 / 782 with a worst of 479 mm — the arms were essentially all of it. Wired `_LIMB_BONE_RE` and the dominant-bone rule from `body_param_stage.py:738/741` rather than re-authoring (D1). **No threshold planted**, deliberately. Tick closes on a measurement, not a fix. NOT TESTED: bind pose only — poke-through classically appears under motion. |
| 08:00–09:00 | Eyes verified at runtime | gaze/eye rig confirmed live, not merely present in the file | **substantially DONE under #311**, which cites this tick by name and draws the presence-vs-drive distinction it asks for (`gaze-drives-eyes.ts:1-12`: *"presence is not drive"*). Contracts green 06:2x: `gaze-eye-bones-resolve-on-every-rail` 3/3, `eyes-have-an-iris` 9/9. **DONE 08:3x — #395 landed (`e6241c2c`).** The remaining half is closed: `gaze-eye-rotation-live.ts` (#337) existed, was wired to nothing, and **crashed** under Node (`ReferenceError: self is not defined` from GLTFLoader.loadImageSource). Four lines made it run; a contract now spawns it and asserts the shipped mechanism turns the iris **laterally**. Measured on aisha at yaw 0.7 rad: shipped `rotateOnWorldAxis` 10.85 mm, lateral 0.95 / vertical 0.17 = **5.59:1**; legacy `rotation.y = yaw` 4.85 mm, 0.53 / 0.81 = **0.65:1**, retained as a live control. Threshold is a 2:1 ratio — what a yaw IS — not a fitted number. NOT TESTED: this is the shader path in Node, not a browser frame; no gaze capture graded. |
| 09:00–10:00 | Station capture + status | full station graded; `PROJECT_STATUS.md` and board reconciled | **DONE 09:2x — station captured and graded; state reconciled.** Live capture of `peds_asthma_parent_anxiety_v1` (`env=pediatric_urgent_care_bay_v1`, `source=live_scene`, `.openclinxr/evidence/issue-0052-station-0924/`). **All three MPFB actors render**: patient 33,268 tris @ x=-0.90, parent 94,986 @ x=+1.42, nurse 64,358 @ x=+0.64, `liveRoots=3 mismatch=false`. **#386's scrub-teal fix is visible in situ** — the nurse reads as a matching clinical set. **I graded only two figures and was wrong**: the parent sits behind a large blue plane filling the right third, so the doorway-overview camera does not frame the full cast (§11l — one view cannot support 'X is absent'; the probe corrected the pixels). NOT TESTED: the blue plane's identity; the nurse still carries the placeholder scalp (#387 retired it on aisha only); one camera angle, no three-quarter. |

> **Why this column exists.** Three rows were being treated as unstarted while their work had landed
> on 2026-08-11. The 03:19 re-measurement grepped for the NAME `solveMacrosForTarget` and concluded
> the capability was absent; **I repeated the same error at 05:2x**, wrote "genuinely still absent"
> into this document on the strength of the same grep, and only found #329 by listing
> `.openclinxr/evidence/` for artifacts instead. Search for the CAPABILITY — the artifact, the
> contract, the measured number — not for a name someone guessed in advance. A worker dispatched on
> the 02:00 tick would have rebuilt a working solver, which is #368's 105-turn failure exactly.

**From 10:00 onward: alternate 1 h refinement / 1 h advancement.** Refinement takes the top defect from
the preceding capture. Advancement takes the next unstarted phase item.

## Execution contract for the autonomous loop

- On the first wake past each hour, read this table. If the hour's tick is not done, it is the **only**
  slice for that hour. Intermediate wakes harvest, verify and land.
- **Hour targets are not guarantees.** A Blender bake is minutes; a solve loop can miss. When an hour's
  tick cannot land, take the smallest real piece of it and **say so** — do not stretch the claim.
- **Do not strive for perfection.** One observable, graded change per tick beats a polished one.
- Every tick closes with a CLAIM and a NOT TESTED line, as usual.

## Preconditions any MPFB measurement must satisfy

**CORRECTED 2026-08-11 after verifying the MPFB API. Two of the three preconditions were self-inflicted.**

**Enter through `HumanService.create_human(feet_on_ground=True, macro_detail_dict=…)`.**

**CORRECTED AGAIN 2026-08-11 05:45 — the "no-op" claim below is WITHDRAWN, measured false.** A live
probe (`.openclinxr/evidence/measure-target-probe/`) shows `create_human(feet_on_ground=True)` returns
**19,158 verts** — helper-included — and `ExportService.bake_modifiers_remove_helpers(obj,
remove_helpers=True)` takes it to **13,380**. So the call is **required, not redundant**. The 13,380
figure quoted below is what you get *after* that call, not what `create_human` natively produces.
Grounding via `feet_on_ground=True` is still real and still not a separate step.

*Withdrawn: "create_human returns 13,380 already body-only; bake_modifiers_remove_helpers is a no-op:
identical counts, identical bounds." Measured 19,158 → 13,380. The earlier reading was taken from the
EVALUATED mesh (`evaluated_get(depsgraph).to_mesh()` reports 13,380 while `obj.data.vertices` reports
19,158) — two instruments answering different questions, and the wrong one was recorded.*

So of the three preconditions previously recorded here:

1. **Y-up — still required.** glTF's convention; Anny and Blender are Z-up and the conversion has been
   missed three times in one session. This one is real.
2. **Grounding — no longer a step.** `feet_on_ground=True` does it at creation. Post-hoc shifting was
   redundant.
3. **Helper stripping at vertex 13,380 — was solving a self-inflicted problem.** `create_human` never
   *adds* helper geometry; the 19,158-vertex mesh being stripped came from importing raw
   `data/3dobjs/base.obj` directly, which is the wrong entry point. The hand-rolled constant was a
   workaround for damage caused by bypassing the API. **`bake_modifiers_remove_helpers(remove_helpers=True)`
   remains the correct call where helpers genuinely exist** (a human built through the asset/proxy path),
   but it is not a substitute for entering correctly.

The 13,380 figure survives as a **cross-check, not a procedure**: it is what `create_human` natively
produces and what the shipped library GLBs contain, so a body-only mesh of another size is a signal
something is wrong.

**The generalisable lesson, third instance today:** `bake_modifiers_remove_helpers`, then
`create_human(feet_on_ground=True)`, then bisecting height against `anny.Anthropometry` instead of a
hand-fitted formula (#302). Each time, hand-authoring produced a workaround for a problem the documented
entry point does not have. Reach for the API before reaching for a constant — this is exactly what
`agents/rules/PROTO_CURIOUS_RESEARCHER.md` exists to catch.

## What this does not claim

No clinical or anthropometric validity for any generated body; no learner readiness; no Quest
performance posture. The Jacobian is a **local** linearisation at the 0.5 operating point — body macros
are unlikely to be linear across the full range, so it is good for iterating from a nearby start and is
untested at the extremes.
