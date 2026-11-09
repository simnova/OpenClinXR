# hair-groom-2 realism roadmap: from rubric-passing cards to reference-matching hair

Author: hair-groom-2 lane (Claude, Elephant) · Status: EGM review, round 4 resolved; operator answers OP1-OP5 applied · Date: 2026-11-09
Supersedes nothing; extends `DESIGN.md` (deterministic hair cards), which stays the pipeline contract.
Reviews: `reviews/realism-2026-11-09/` (raw goldfish findings and one resolution file per round).

## Overview

The lane builds long, straight, dark-brown, centre-part hair for the MPFB actor Aisha from a procedural
Blender strand groom, converts it to hair cards, and renders the cards in the three.js (r184) runtime. The
target is four operator-supplied reference images `targets/target-{front,three_quarter,profile,back}-a1.png`
(989c6c709, 56d32ca75). They are xAI Imagine `image_edit` outputs (aisha-v3 set) whose inputs were bald
Cycles renders of Aisha in the target scene (glossary); the edit added the hair and kept face, shirt,
camera and light (`tools/openclinxr/evidence/hair-target2/make_sources.py`, hair-target3/RESULT.txt,
hair-target4/RESULT.txt). The hair highlight in the targets was painted by Imagine, conditioned on that
scene's light.

Operator direction (2026-11-09): reach high realism first, then optimize. This document reviews the 74 lane
commits (`git log --oneline origin/main..HEAD`) from first principles: what measurably worked, which
compromises were made, which standard hair-production techniques remain untested, and proposes the next
phases. Phase order puts a visible change in every slice.

### Glossary

- **EV**: `.openclinxr/evidence/hair-groom-2/` in the lane worktree (gitignored, `.gitignore:10`).
- **strands / groom**: Blender hair curves from `groom/groom.py` + a recipe JSON, rendered offline in Cycles
  with one Principled Hair BSDF in its HUANG model (`groom.py:913`); the recipe sets melanin and redness,
  not an RGB colour.
- **cards**: textured ribbons built from clusters of strands (`cards/cards_from_strands.py`), each with its
  own atlas cell baked from its member strands (`cards/atlas_from_members.py`).
- **rubric v4 + I19**: `grade/grade.py`, 32 numeric items (shape, length, coverage) + 9 visual items = 41.
  A visual item passes on the independent grader's call against the rubric text at native resolution.
  A3 = hair length (median strand-tip height vs target). A censored card round is one whose crop cuts the
  hair ends; I19 (798886448) scores its A3 from card-borne member tips. B5.side = side-view flat-hem
  tip-column count. Rubric items are written "rubric D5" (back crown pale scalp); operator directives
  "directive D13".
- **r10 B**: shipped shape pick, strands groom-r9/s1 + cards `--max-twist-deg 35`, atlas
  `--cut-tip-spread 0.15 --tip-spread-all`, simplify `--tol-mm 2`; EV/grades/r10-v4 41/41; 63,024 drawn
  tris; runtime GLB sha 04371bc4… (EV/r10/rt-tw35ta15sm2/glb.sha256), built by EV/r10 pt.sh -> sp.sh -> rtp.sh
  with the r10 material.
- **K**: albedo scale, the multiplier on the atlas colour in the runtime material.
- **r10 material**: the material rtp.sh applies to r10 B (spec 1.0, roughness .25, anisotropy .95).
- **BEST3**: sheen-3 material pick (crops EV/sheen3/g4/crops/K065_s03_a50_scDD-*.png; the suffix is the run
  label): K .65, spec .3, roughness .4, anisotropy .5 rot 0, `--spec-color 1 .45 .25`, `--spec-streaks` map
  (c951c0a99, 3818b2b7c); built by EV/sheen3/tools/s3.sh into EV/sheen3/build/final. Grades
  EV/grades/sheen3-v1, EV/grades/sheen3b-v1.
- **v3 mask**: the grader's hair mask in EV/grades/sheen2-v1/scripts/v3mask.py.
- **grader**: an independent subagent that did not produce the round, judging at native resolution.
  **gallery**: the lane's private gallery artifact of strips per round.
- **runtime crops**: `cards/head_crops.ts` renders the GLB through `tools/openclinxr/evidence/isolated-subject-harness.ts`
  (headless Playwright canvas screenshots, :244).
- **fitted rig**: `--light-rig` (474d2b3a7, EV/sheen/fitted-rig.json), a `cards/light_rig.ts` LightRig:
  camera-relative directions, unitless three.js intensities; key el 2.4 deg, fill el 5 deg, hemisphere 2.28,
  RoomEnvironment .37, AgX. Fitted on a skin/shirt feature vector (EV/sheen/fit-residuals.json `after.total`
  .032-.033 per view). **default light**: the lab default (`packages/openclinxr/xr-scene/src/isolated-subject-lab.ts:298-305`):
  ambient #dceee6 1.45, white key 2.2 at (3.2, 5.2, 4.1), teal fill #b6d8ca 1.1, world frame, no tone
  mapping, no environment. The ACES/RoomEnvironment studio branch (`isolated-subject-rig-variants.ts:238-253`)
  runs only with `rigOverride.studio` and is not used here.
- **target scene**: the Blender scene that rendered the Imagine input images,
  `tools/openclinxr/evidence/hair-target2/make_sources.py` (tracked): Cycles 64 samples + OIDN, 1024x1024,
  view transform unset (Blender default; installed 5.2.3), world grey (.5, .5, .5) strength 1, a 12 m plane
  with grey (.72, .72, .74) roughness 1 at (0, 2.2, 1.0) and rotation 0 (a horizontal floor at z = 1 m,
  the horizon in the targets), three white Area lights: KEY 100 W 2 m at (-1.5, -2.0, 2.2), FILL 40 W 2 m
  at (1.5, -2.0, 1.8), RIM 60 W 1.5 m at (0, 2.0, 2.6); body `mpfb-peds-parent-aisha.glb` with the library
  hair mesh removed and the shirt overridden matte pink; cameras from
  `tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json` (front camera z 1.49 m). From a head
  centre near (0, 0, 1.55) the key sits about 15 deg above horizontal, the fill about 5 deg, and the rim
  about 28 deg above and behind. The source PNGs were in gitignored scratch, now deleted; the script,
  GLB and cameras are tracked, so the scene re-renders.
- **seed+1**: the same recipe with the next random seed.
- **card tolerance (tol)**: per metric, view and rig, max(A, B). A = max over strands seeds 2-5 of
  abs(m_i - m_1), reference = strands seed 1. B = card perturbation floor: cards rebuilt from strands seed 1
  at clustering seeds 1, 2, 3, max pairwise difference (method as in
  `tools/openclinxr/evidence/face-regression/src/calibrate.ts`).

## The Problem

The hair passes the shape rubric (41/41) but does not look like the target hair. Measured under the
fitted rig (EV/grades/sheen2-v1, sheen3-v1, v3 mask; L = luminance 0-1; sheen_gate.py re-measures these
with its own mask):

1. The r10 material is about 2x brighter than the target (peak .41-.58 vs .25-.33; base .24-.27 vs
   .09-.13). BEST3 narrows it but leaves residuals (front peak .398 vs .282; side base .135 vs .086), and
   the side highlight sits on the fringe above the ear with no crown band (sheen.py bandRow .69 vs target
   .49, side only). Fine strand streaks are faint (streakhf BEST3 .045-.061 vs target .075-.259).
2. Hair median L at spec 0 under the default light is 37-39% below the fitted rig on side/back at K 1.0
   (EV/sheen3/probe3.json F2: side .63, back .61); at K .4 the ratio is .84/.76. A material fitted to one
   light fails the other (sheen-2: 67-84% near-black side/back under default).
3. Shape work stalled for four rounds (r11-r14) chasing seed+1 on rubric B5.side. In r14 the side hem's
   front tip columns come from 56 outlier strands, which the card means drop. In r11 the seed+1 strands
   also fail B5.side (34 of 151 tip columns), so card averaging is not the only cause.
4. The front hairline is a hard edge against skin and the part reads as a wide bright wedge; the target
   has a soft hairline and a narrow part (sheen3b-v1 crops, sheen3-v1 parting.json).

Candidate causes, from reading code and EV:

- R-a. **The atlas is lit, not albedo.** `atlas_from_members.py` step 3 bakes HUANG radiance (highlight,
  strand-on-strand occlusion, colour) under the groom rig, and `calib_search.py` removes the double
  lighting with one global gain. The baked term is near-flat along card v (r10 B atlas per-cell p95/p50
  median 1.078, round2-critic R2C1) because the sun azimuth is dropped (`atlas_from_members.py:24-32`).
  R-a explains baked colour and occlusion, not the missing band.
- R-rig. **The fitted rig may not place a crown band.** Key and fill sit within 5 deg of horizontal; the
  skin/shirt feature vector does not constrain where a specular highlight falls. The target scene has a
  key about 15 deg up and a rim about 28 deg up behind the head, which the fitted rig lacks.
- R-b. **One GGX anisotropic lobe** (MeshPhysicalMaterial + KHR_materials_anisotropy) stands in for hair
  scattering. Production hair uses two shifted lobes (primary white, secondary tinted) with a per-strand
  tangent shift; streaks come from that shift.
- R-tex. **Low texel density.** 1410 unique cells of 16x170 px (14 px inner), median card width 9.9 mm:
  ~1.4 px/mm across strands and ~0.5 px/mm along, against ~1.9 px/mm in the graded crops
  (`cards_from_strands.py:92-93, 360`; EV/r10/tw35ta15sm2/cards.npz). The atlas is magnified in every
  graded view, which may cap streak contrast independent of R-b.
- R-c. **Per-strand variation is spread over single-purpose maps**: `--spec-streaks` (specularTexture,
  three reads alpha only, RGB = 1) and `--aniso-alpha-power` (anisotropyTexture) (`transplant_donor.py:27-37,
  237-256`). No strand ID or AO channel exists for a shader to use.
- R-d. **The rubric weights silhouette**: 32 numeric items are shape/coverage; appearance is 9 visual
  items and the ungated sheen metrics.

## Goals

- G1. In all four views under the target scene (Cycles for strands, the P1 harness port for cards), the
  grader ranks the cards closer to the Cycles strand reference than BEST3, every gated metric is within
  tol, and the grader judges the cards closer to the target than BEST3. The lab default light is
  report-only.
- G2. Under the harness port of the target scene: black share <= target + 2 pp and peak >= 0.8 x target
  (`briefs/sheen-3-dual-light.md:13`). Peak <= 1.25 x target is report-only (no known-good).
- G3. Shape rubric stays 41/41 for the shipped seed.
- G4. Cost is not gated before P7 (OP3). P7 sets the budget from the realism result; r10 B's 63,024 drawn
  tris and 2 draw calls are recorded for comparison.

## Non-Goals

- Strand rendering at runtime, simulation/physics, other hairstyles or actors (until G1 holds for Aisha).
- Making every seed pass the rubric; an automatic seed search until a seed pass rate is known.
- Custom render pipelines that replace three.js materials wholesale.

## Operator answers (2026-11-09)

- OP1. Judge realism in a harness matched to the Imagine target scene. The target scene becomes the
  reference light for G1, G2 and tol; the fitted rig is retired as reference and the P3 light sweep is
  dropped. Production encounter light is a later question.
- OP2. Operator deferred to the lane. Decision: a GLB-declared hair extension is acceptable. Standard
  real-time practice is a dedicated hair shading model (two shifted lobes, Scheuermann 2004; dedicated hair
  shading models in Unreal and Frostbite), and glTF has no ratified hair extension, so a vendor extension
  on the OPENCLINXR_skin_shade precedent is the standard route. The P5 stock probes still run first
  because each is one run.
- OP3. No cost budget until realism holds; optimization is P7 (G4).
- OP4. Operator deferred to the lane. Decision: freeze r10 B as the shape base and stop the seed chase.
  The remaining gaps (Problems 1, 2, 4) are material, light and hairline; the P0 freeze is a recorded pin
  that a later shape slice can move.
- OP5. Answered by search after merging origin/main (d6252f892): the scene script is tracked (glossary,
  target scene). Imagine repainted the hair, so the target's highlight is Imagine's response to that light,
  not a Cycles render of a groom.

## What worked (measured)

| step | commit / grade | measured effect |
|---|---|---|
| procedural shape fields (shoulder route, part-away fade, hem, medial taper) | 4dd343917 / r9-s1-v4 | strands 41/41 seed 1 |
| cards from strand clusters, per-card atlas cells from members | 73d38a361, 33d5a2719 | cards 40-41/41 |
| per-card station decimation `--tol-mm 2` | a3b9dbc36 / cards-opt2-v4 | drawn tris 129,720 -> 62,996 (cards-opt2 build), grader: no visible difference |
| twist limit, staggered tip ends | d35d0f0e1, 9ef4966dc / r10-v4 | back notch 234 -> 0 px; tapered tail; 41/41 |
| hair-independent crop frame `--body-frame` | 5ca5a3a75, 8359c9e3a | fixed-region artifact counts valid across rounds |
| light rig fitted on non-hair pixels | 474d2b3a7 / EV/sheen | skin/shirt feature residual .054-.096 -> .033 |
| joint material fit gated on two lights | c951c0a99 / sheen3-v1 | BEST3 closer than r10 in all 4 views, passes both-light gates |
| per-member specular map | 3818b2b7c / sheen3b-v1 | only source of crown strand detail; costs 16.78 MB GPU (22.4 MB with mips) |

## Compromises in force

| id | compromise | where | consequence |
|---|---|---|---|
| K1 | lit atlas + global gain instead of albedo | atlas_from_members.py step 3, calib_search.py | baked colour/occlusion tied to the groom rig (R-a) |
| K2 | single GGX anisotropic lobe | transplant_donor.py --runtime-sheen | no secondary tinted lobe, no shift streaks (R-b) |
| K3 | alpha = coverage, MASK 0.85 core + BLEND fringe, drawn twice | transplant --fringe-blend | 2 draws; sort artifacts never measured; no alpha-to-coverage |
| K4 | card = cluster mean; outliers dropped | cards_from_strands.py | side hem loses front tip columns; flyaways lost |
| K5 | 2048 RGBA atlas + 2048 RGBA spec map (data in alpha only), uncompressed | runtime GLB | 2 x 2048^2 x 4 B = 33.6 MB, 44.7 MB with mips |
| K6 | rig fitted on diffuse skin/shirt features only | --light-rig | highlight position unconstrained (R-rig) |
| K7 | shape rubric chases every seed | r11-r14 | four rounds without shipping |
| K8 | one unique atlas cell per card | cards_from_strands.py, atlas_from_members.py | ~1.4 px/mm across strands vs ~1.9 px/mm on screen (R-tex) |

## Untested techniques (standard in production hair)

| technique | what it would test |
|---|---|
| T1 unlit albedo + AO bake via Shader AOVs | R-a at source |
| T2 per-strand ID as a function of u per card; root-tip as UV1 | per-strand shift, root darkening |
| T3 Kajiya-Kay/Scheuermann dual shifted lobes with shift | R-b: band and streaks |
| T4 compare cards to source strands under the same light | a reference for every light |
| T5 alpha-to-coverage with MSAA | one-pass transparency, sort-free |
| T6 scalp tint, hairline wisps, part transition | hairline and part (Problem 4), rubric D5 |
| T7 KTX2/ASTC compression, LOD card sets | G4 cost |
| T8 flyaway / hem-tip card group from dropped members | K4, outline realism |
| T9 motion turntable, headset distance | shimmer, popping, aliasing |
| T10 shared high-density clump textures tiled across cards | R-tex, K5 |

## Prior Art

Survey with sources: `reviews/realism-2026-11-09/prior-art.md`. Points that bear on this design:

- Production card pipelines (Unreal Hair Card Generator, inZOI) bake non-lighting data in one pass:
  coverage, depth, strand ID/seed, root/U attributes, tangent; a few shared clump textures serve many
  cards. Lighting is computed at runtime.
- Strand streaks come from a per-strand shift/ID texture driving shifted lobes (Scheuermann 2004).
  three.js anisotropy is one GGX lobe. Galacean ships a two-lobe Kajiya-Kay WebGL hair shader (licence
  not verified; checked before any port).
- Cards are checked against their source strands under the same light (Frostbite, Strands2Cards).
- Quest transparency baseline is alpha-to-coverage with MSAA, or an opaque core plus a small pre-sorted
  blended fringe; hashed alpha needs TAA, which three.js WebXR lacks.
- Mobile/Quest hair: cards only, textures capped at 2048, ASTC via KTX2 (UASTC for data channels).
- Layering: scalp-coloured coverage shell, mid/top clumps, flyaways.

## Critical User Journeys (CUJs)

- CUJ1. Given a case blueprint naming Aisha with straight dark centre-part hair, when the factory builds
  her, then the runtime hair matches the reference on the gated metrics under the scene light.
- CUJ2. Given a learner in a Quest encounter at conversation distance, when Aisha turns her head, then
  the hair reads as hair (highlight follows the light, no card edges, no flicker); the P7 budget applies.

## Appearance metrics (`grade/sheen_gate.py`, tracked)

Ported from EV/grades/sheen2-v1/scripts (v3mask, rescore), EV/grades/sheen3-v1/scripts (parting, streakhf,
sidepeak), EV/sheen3/tools/score3.py and EV/sheen/tools/seg.py, so gates do not depend on gitignored code.
Port check before any definition changes: reproduce the target, r10 and BEST3 peak/base/hf values in
EV/sheen3b/score.txt to 3 dp under the old masks.

- Scale: target and render resampled to a common px/mm at the head plane. Target px/mm from
  `grade/frames.json`; runtime `--body-frame 1.5` crop px/mm from a landmark fit (frame_fit-style), recorded
  in frames.json. Check: after resampling, the eye row lands within 2 px of the target eye row.
- Capture: runtime crops under the harness port of the target scene (P1), which supplies the grey world
  and the floor plane; gallery strips use the same px/mm and scene.
- Masks: render = hideHair difference mask (`seg.py render_masks`; the renderer has no alpha,
  `isolated-subject-lab.ts:271`); target = `seg.py target_masks`, frozen to `grade/target-masks/`. Interior
  metrics erode the mask; outline metrics do not.
- peak = p98 of L on the mask; base = p50; black share = mask px with L < .06.
- band: crown = top 30% of hair-mask rows per column; per crown column, row of max L after a 5-row box
  smooth; median row (fraction of crop height); continuity = fraction of crown columns whose max
  > 1.15 x column median.
- streak = streakhf, mean |dL/dx| / mean L over crown rows.
- outline: alpha falloff width across the silhouette; stray px = hair px farther than 2 px outside the
  closed silhouette of the hair mask (same rule for strands and cards).
- part and hairline: part width at the crown, hairline edge falloff width.
- First-run constants (erosion, crown fraction, smoothing, 1.15, 2 px): the first sheen_gate run reports
  their sensitivity (erosion 0/3/6/9 px, smooth 3/5/9 rows, stray 1/2/4 px) and the grader fixes them
  before any gate counts.

| metric | status | counts from |
|---|---|---|
| peak, base, black share | gated: G2 vs target (target scene port); abs(card - strand) <= tol | G2 from P1; tol from P4 |
| band median row, band continuity | gated, abs(card - strand) <= tol | P4 (row), P5 (both) |
| streak | gated, abs(card - strand) <= tol | P5 |
| part width, hairline falloff | reported vs target; grader call gates P2 | P2 |
| outline falloff, stray px | gated, abs(card - strand) <= tol | P2 report, P5 gated |
| band width, hue/sat, peak ceiling | report-only | - |

- Card gate form: abs(card - strand) <= tol, per gated metric, view and rig.
- Proof the gate is not vacuous (P3): strands seed 6 pass >= 70% of gated cells (exchangeable draws give
  P(new <= max of 4) = .8), and r10 B lit-atlas cards fail at least one gated metric in >= 2 views.
- Round cap: two rounds per phase on a missed metric, then the miss goes to the operator.

## Technical Plan (Architecture)

Each phase gate is graded independently at native resolution; each phase ends with gallery strips.

- **P0 Freeze shape (on OP4 yes).** Port EV/r10 pt.sh, sp.sh, rtp.sh (and the EV/cards-opt2 s2m.py and
  p1/rtm7b.py steps the build needs) and EV/sheen3/tools/s3.sh into tracked `cards/build_shipped.sh`, worktree
  path as a parameter, grading/cost steps left out. Record r10 B and the BEST3 arguments in tracked
  `SHIPPED.json`. Step 1: build twice; if the shas match, gate = rebuild from groom-r9/s1 strands reproduces
  runtime sha 04371bc4… and BEST3 reproduces EV/sheen3/build/final/sha256; if not, gate = crop maxAbs 0 (the
  sheen3b repro_maxAbs pattern) and the nondeterministic step is recorded. Before the freeze the grader
  judges strand volume (crown, temple) vs the target; a miss goes to the operator with OP4.
- **P1 Target-scene harness and visible baseline (T4, T5, T9).** First build slice.
  - Target scene, Cycles: re-render the bald sources with make_sources.py unchanged. Known-good for parity:
    the residual between these renders and the targets on face and shirt (fit feature vector), outside the
    hair mask; Imagine kept those regions.
  - Target scene, three.js: lighting from a Cycles equirect panorama of the target scene taken at the head
    centre, with the three Area lights made camera-visible, used as `scene.environment` and background
    (the floor is in the panorama, no geometry). Applied by an opt-in helper in `apps/ui-xr/isolated-subject.html`
    that the harness calls after the lab settles (`HeadCropSpec.equirectEnvironment`): `isolated-subject-lab.ts`
    and `isolated-subject-rig-variants.ts` are hash-pinned by the cornea evidence tests and stay untouched. Reason: three
    r184 shades RectAreaLight with isotropic LTC (`lights_physical_pars_fragment.glsl.js:465-500`) and
    ignores anisotropy, while the environment path applies it (`getIBLAnisotropyRadiance`,
    `envmap_physical_pars_fragment.glsl.js`). Check: the panorama shows all three emitters. Fallback if
    parity fails: environment plus one directional per Area light at its centre.
  - Parity gate: hairless body under the harness port vs the Cycles re-render, fit feature vector on skin
    and shirt, residual <= the Cycles-vs-target residual above (known-good). Tone curve: Cycles default
    view transform matched in three by the tone mapping that minimises that residual (AgX, ACES, none:
    three runs, graded).
  - sheen_gate.py ported and port-checked; target band row re-measured per view; strips at common px/mm
    and matched background replace the current gallery strips.
  - Streak-map control: BEST3 without the map at spec .15 (spec .3 exists: EV/sheen3b/build/ns,
    sheen3b-v1, BEST3 won 3 of 4 fitted views). The grader decides whether the map stays (-16.78 MB, 22.4
    with mips); streak reported.
  - A2C probe plumbing: MaterialOverride gains alphaToCoverage and alphaTest (`isolated-subject-material-variants.ts:248`);
    HeadCropSpec gains material override, yaw and background fields; the harness passes yawDegrees and
    records a webm. `isolated-subject-lab.ts` stays sha-pinned. Confirm MSAA in the Playwright capture path.
  - A2C probe: alphaToCoverage on the hair MASK material with cutoff .85/.5/.3 (three r184 still discards
    below cutoff). 12-azimuth turntable stills + webm of the current two-pass as the baseline. Artifact
    classes: sort pop, card-edge line, edge halo, shimmer, other (with a note). Gate: grader picks a cutoff
    whose artifact count <= baseline with no new class, or records that A2C loses.
  - Done 2026-11-09 (target-scene port). Cycles re-render vs targets, fit feature residual: .0027 front,
    .0087 three-quarter, .0128 side, .0078 back (`p1/src-vs-target.json`). Harness port, hairless body vs
    targets, AgX: .0272 / .0255 / .0285 / .0274; no tone mapping: .0412 / .0382 / .0414 / .0317; fitted rig
    .0333 / .0319 / .0334 / .0329. AgX passes the parity gate in all four views (known-good: the fitted rig)
    with nothing fitted; the largest remaining term is shirt meanL (green runtime shirt vs pink target, weight
    .25). The tighter Cycles floor (.003-.013) is not reached. Build: `cards/build_target_scene_env.sh`; rig:
    `cards/target-scene-rig.json`. MY GRADE on strips (target, BEST3 fitted rig, BEST3 and r10 B in the port):
    BEST3 hair colour sits close to the target; r10 B reads grey-blond; the target's crown sheen and fine
    streaks are absent in both; the runtime crown outline is flat in side view.
  - Done 2026-11-09 (P1 metrics, a9975bdde). `grade/sheen_gate.py port-check`: PASS, 60 values, maxAbsDiff 0;
    a planted 1% hf change fails it. Comparison frame: the target is downsampled into the runtime frame with
    LANCZOS (`grade/runtime_frame.py to-runtime`); upsampling the runtime render understated streak. Frame fit,
    skin-mask IoU .88-.95 (`p1/runtime-frames.json`). G2 under the target-scene port, BEST3: black share 0
    (<= target + .02), peak .389-.475 (>= .8 x target) (`p1/score-ts-rt.json`). Tone mapping AgX.
  - Streak map KEEP. Independent grader: BEST3 beats the no-map control (spec .15) in 4 of 4 views
    (`p1/grade-p1-map.md`). streak: BEST3 .069-.084, no-map .037-.048, target .108-.236.
  - A2C probe result: A2C loses. 48 stills (base, cutoff .85/.5/.3 with the BLEND fringe hidden; yaw 0-330
    step 30; MSAA samples 4 logged on all 36 probe renders). No webm was recorded; shimmer was judged from
    stills only. Independent grader artifact totals over 12 yaws (`p1/grade-a2c.md`):

    | variant | sort pop | card-edge line | edge halo | shimmer (still) | other | total |
    |---|---|---|---|---|---|---|
    | base two-pass | 3 | 9 | 3 | 8 | 5 | 28 |
    | A2C .85 | 10 | 21 | 0 | 24 | 26 | 81 |
    | A2C .5 | 4 | 20 | 1 | 21 | 12 | 58 |
    | A2C .3 | 3 | 19 | 1 | 23 | 10 | 56 |

    No cutoff reaches the baseline count. A2C removes the base's grey see-through strip at both temples
    (edge halo) and adds stair-stepped hairline and crown edges, scalp at the part and crown, and a hard
    cut in front of the ear. The shipped two-pass MASK .85 + BLEND fringe stays; P6 starts from it.
- **P2 Hairline, part, scalp (T6, T8).** Scalp-coloured underlayer card group in the card pipeline (the
  body GLB and its pins stay untouched). Wisp cards from members at the hairline and flyaway / hem-tip
  cards from members dropped by clustering. Gate: part width and hairline falloff reported vs the target at
  common px/mm, grader judges the hairline and part closer to the target than BEST3, rubric 41/41. Tris
  recorded per round.
- **P3 Strand reference (T4).**
  - Strand references: r10 B strands seeds 1-6 rendered in the target scene (make_sources.py lights,
    world, floor and cameras; groom imported in place of the removed library hair) at target framing; card
    rebuilds at clustering seeds 1-3; tol computed; the non-vacuous proof above.
  - First read: does the Cycles strand render show a crown band under the target scene? If yes, R-rig is
    confirmed as the band cause under the fitted rig, and the card work in P4-P5 aims at the strand
    render. If no, the target band is Imagine's and the grader weighs band metrics against the strand
    render only.
- **P4 Data bake (T1, T2, T10).**
  - Step 0: shared clump atlas probe (8-16 tiles, >= 128 px across, assigned by cluster) vs BEST3 unique
    cells, same material. Grader and streak decide the layout for the bake.
  - Shader-AOV multilayer EXR render of the chosen layout: albedo, AO, coverage (film alpha); read with
    bpy image load. Albedo colour and per-strand variation amplitude fitted to the P3 strand render.
  - ID as a per-cell function of u: one texel row per cell from member root_u (as `spec_streaks_png`,
    `transplant_donor.py:121-160`). Shift = (ID - .5) x one global shift range, fitted in P5.
  - Root-tip v: render_cards.py CardV layer (:119-122) exported in `--bake-glb` as UV1; opt-in UV1 carry
    in `transplant_fitted_brow.py` (:23, 240).
  - AO via occlusionTexture. `--spec-streaks` stays until P5 (three reads only its alpha).
  - `run_cards.sh` env `ALBEDO=1`: calib_search runs with gain fixed at 1 and re-selects specular, so
    calibration.json and SP (run_cards.sh:36) still exist.
  - Gate: R-a by a per-cell hair irradiance-correlation probe in atlas_from_members.py (cell luminance vs
    Cycles irradiance at two key azimuths): both r values below the r10 lit atlas's. ID: per-cell
    distinct-ID runs across u / member count, median >= the same ratio for today's spec_streaks map. Base,
    black share and band row within tol under the target scene.
- **P5 Hair lobes (T3).** Extension approved (OP2).
  - Probes first, one run each: (a) per-strand normalTexture tilt along v from ID + anisotropyTexture RG
    jitter (RG constant (1, .5) today, `transplant_donor.py:88`; check first that a normal tilt moves the
    highlight, `transplant_donor.py:69`); (b) clearcoat as second lobe with opposite-tilted
    clearcoatNormalMap; (c) per-cell u function in anisotropyTexture RG only. If one passes the P5 gate:
    no extension needed.
  - Else: port Galacean's two-lobe Kajiya-Kay GLSL (licence checked first) into an onBeforeCompile hook,
    following the skin-shade-loader plugin, fail-closed and read-back test pattern; register through
    generated-loaders. three uses the tangent attribute only when anisotropy > 0 or a normalMap is present
    (WebGLPrograms.js:302), so anisotropy stays > 0; physical specular 0 where the lobes run. Declared as
    OPENCLINXR_hair_lobes {auxTexture: textureInfo, lobe scalars}, carried by `--carry-extensions`,
    resolved by a GLTFLoader plugin via `parser.getDependency('texture', i)`.
  - Gate: band row, band continuity, streak, outline falloff and stray px within tol in all four views
    under the target scene; grader ranks cards closer to the strand reference than BEST3; G2 holds; turntable
    artifact count <= P1 baseline.
- **P6 Transparency remainder (T5).** Only if P1 left artifacts: extend `--fringe-blend/--fringe-triangles`
  with a per-triangle mean-texel-alpha split at the P1 cutoff. Gate: artifact count <= P1 baseline, no new
  class, rubric D5 not worse. Quest 4x MSAA untested until a Quest harness exists.
- **P7 Optimize (T7).** Precondition: KTX-Software (Apache-2.0) installed (toktx absent,
  `finalize-equipment-glb.ts:38`) and a KTX2 loader in the runtime. Options: map sizes 1024/512, KTX2
  (ETC1S colour, UASTC data), LODs, and for single-colour hair dropping atlas RGB (albedo =
  baseColorFactor x f(ID, AO)). P7 opens by setting the cost budget (OP3). Gate: P5 gate still holds and
  the budget is met.

## Alternatives Considered

- A1. Keep tuning glTF PBR parameters only (sheen-1..3 path). Rejected as the main path: three rounds
  closed brightness but not band position or streaks.
- A2. Strand rendering at runtime. Cost far above Quest budget.
- A3. Re-bake the lit atlas under the scene light. Ties the asset to one light (CUJ2).
- A4. Keep chasing seed robustness in geometry (r11-r14). Four rounds, no ship; P0 replaces it.
- A5. Fit cards to the target image directly under each light. The target has one light; Cycles strands
  give a reference for every light.
- A6. Express the rig in lighting-rig.v1. Superseded by OP1: the reference light is the target scene,
  which is native Blender.
- A7. Port the target scene's Area lights to three RectAreaLight. Rejected: three r184 shades rect lights
  isotropically, so the anisotropic hair highlight would not respond to them (P1).

## Detailed Implementation Plan

### Target Files to Create/Modify

| file | action | change |
|---|---|---|
| tools/openclinxr/hair-groom-2/SHIPPED.json | Create | P0 record of r10 B + BEST3 args and shas |
| tools/openclinxr/hair-groom-2/cards/build_shipped.sh | Create | P0 tracked port of EV/r10 pt.sh, sp.sh, rtp.sh and the BEST3 build |
| tools/openclinxr/hair-groom-2/grade/sheen_gate.py | Create | P1 metrics |
| tools/openclinxr/hair-groom-2/grade/target-masks/*.png | Create | P1 frozen target masks |
| tools/openclinxr/hair-groom-2/cards/head_crops.ts, tools/openclinxr/evidence/isolated-subject-harness.ts | Modify | P1 material override, yaw, background, webm; P5 opt-in hairLobesLoader |
| packages/openclinxr/xr-scene/src/isolated-subject-material-variants.ts | Modify | P1 MaterialOverride alphaToCoverage, alphaTest |
| apps/ui-xr/isolated-subject.html, tools/openclinxr/evidence/isolated-subject-harness.ts | Modify | P1 opt-in equirect environment applied after the lab settles |
| tools/openclinxr/hair-groom-2/cards/env_to_three.py, exr_to_npy.py, build_target_scene_env.sh, target-scene-rig.json | Create | P1 panorama to three's equirect convention |
| tools/openclinxr/hair-groom-2/grade/frames.json | Modify | P1 runtime crop px/mm |
| tools/openclinxr/hair-groom-2/cards/cards_from_strands.py | Modify | P2 scalp underlayer, wisp and flyaway cards |
| tools/openclinxr/hair-groom-2/cards/target_scene_env.py | Create | P1 Cycles equirect panorama of the target scene at the head centre |
| tools/openclinxr/hair-groom-2/cards/strands_in_target_scene.py | Create | P3 groom rendered in the make_sources.py scene |
| tools/openclinxr/hair-groom-2/cards/atlas_from_members.py | Modify | P4 `--data-bake` (AOV EXR), shared clump layout, irradiance-correlation probe |
| tools/openclinxr/hair-groom-2/cards/render_cards.py | Modify | P4 albedo atlas and CardV UV1 in `--bake-glb` |
| tools/openclinxr/hair-groom-2/cards/run_cards.sh, cards/calib_search.py | Modify | P4 `ALBEDO=1`, gain fixed at 1 |
| tools/openclinxr/asset-pipeline/makeclothes/transplant_fitted_brow.py | Modify | P4 opt-in UV1 carry |
| tools/openclinxr/hair-groom-2/cards/transplant_donor.py | Modify | P4 per-cell ID row, occlusionTexture; P5 probes and extension |
| tools/openclinxr/asset-pipeline/makeclothes/transplant_library_hair.py | Modify | P4 data texture without LANCZOS resize; P6 split |
| packages/openclinxr/xr-scene/src/hair-shader/hair-lobes-loader.ts | Create | P5 (if probes fail) plugin + lobes |
| packages/openclinxr/xr-scene/src/isolated-subject-assembly.ts | Modify | P5 opt-in loader via untyped spec extra |
| packages/openclinxr/xr-asset-loading/src/generated-loaders.ts, packages/openclinxr/xr-asset-loading/consumes.json; packages/openclinxr-verification/architecture-rules/src/archunit-tests/public-surface/surface-meter.test.ts | Modify | P5 register and admit the loader |

### Verification Plan

- Each new option off by default; default outputs byte-identical (sha) as in every prior round.
- Touched package tests run (xr-scene, xr-asset-loading, architecture-rules public surface, evidence
  harness); isolated-subject-lab sha pin test untouched.
- Every phase: producer self-report, then independent grader at native resolution, strips in the
  gallery page.
