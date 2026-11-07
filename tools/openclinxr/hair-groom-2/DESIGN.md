# hair-groom-2: deterministic hair cards for MPFB actors

**Author:** Patrick Gidich
**Status:** Proposed (review rounds 1 and 2 resolved; EGM re-audit cap reached)
**Date:** 2026-11-07

Method: [Elephant-Goldfish Model](https://egm.dev/) (google/elephant-goldfish-model, Apache-2.0).
The Elephant (deep-context author) drafted this; two Goldfish reviewers (fresh context, no history)
reviewed it. Their reports and the resolution of every finding are in `reviews/`.

## Overview

hair-groom-2 turns a hairstyle recipe (a small JSON file) into hair cards: textured strips that read as
hair because their texture is mostly transparent strand silhouettes. It runs inside the MPFB
materializer's Blender session, fits the cards to that actor's head, and embeds them in the actor's
GLB. No LLM edits geometry, and the same recipe plus seed produces the same bytes.

Most of the card machinery already exists on `main` in v1's `tools/openclinxr/hair-groom/cards/` and
`shell/`, built, deterministic and never consumed. hair-groom-2 is mainly wiring: a recipe-driven
guide source in front of v1's card generator, the materializer as the place it runs, and the two
runtime renderers as the place it is seen.

### Glossary

- **MPFB / MakeHuman / MakeClothes / `.mhclo`**: the Blender humanoid generator this project ships
  actors from, and its clothing-and-hair asset format. Library hair = a stock `.mhclo` hairstyle.
- **Materializer**: `tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py`, the
  Blender script that produces the shipped `mpfb-*.glb` actors and fits library hair in-session.
- **Guides**: a few hundred curves describing where hair goes. **Cards**: the strips built along them.
- **Style family**: recipes that share `family`, `curl`, `frizz` and `clump`. Length, part and density
  do not change the family. Atlas textures are baked once per family.
- **D1, D9, D13**: project directives (`agents/rules/PROTO_VERIFY_DELEGATION.md`). D1: wire proven
  tools, do not hand-author geometry. D9: no LLM in the production path. D13: an LLM may choose a value
  upstream, but the choice is seeded and recorded in the case definition.
- **v1**: `tools/openclinxr/hair-groom/` and its strand campaign logged in `operator-hair-muse4h.md`.
  "Keeper" there means the best groom file so far.

## The Problem

Measured 2026-11-07 on `main` at `192734d6f`. `-inspect` GLBs are inspection copies, not actors, and
are excluded from counts below.

1. **Shipped hair renders as a solid shell.** Of the 10 actor `mpfb-*.glb` files, 9 ship library hair
   with no `baseColorTexture` and glTF default `alphaMode: OPAQUE`. Only `mpfb-peds-parent-aisha.glb`
   has a texture and `MASK` (cutoff 0.2). Two causes, from the materializer and its provenance:
   - **No source texture.** `mhair02` (kevin, physician, street male) has no diffuse PNG; the
     materializer logs `HAIR_TEXTURE_SKIP` (`materialize_mpfb_humanoid_candidate.py:7474-7483`).
   - **Lost per bake.** `toigo_blunt_bob_with_bangs` is textured on peds-parent-aisha (re-baked
     2026-10-09, log shows `wiredTextureMaps "diffuse,normal"`) and untextured on ob-patient-aisha and
     the gown actors. Whether those GLBs predate texture wiring or a later stage strips it is UNKNOWN.
   All eyebrow and eyelash materials are `OPAQUE` with no texture.
2. **Brow and lash cost regressed.** The materializer has an `EYEBROW_REDUCTION` step (`:7640-7650`);
   reduced actors carry 8,953 to 13,187 brow triangles, while ob-patient-aisha carries 35,334, kevin and
   street male 28,716, and the child 21,816. An August test measured lashes at 368 triangles on every
   actor; today 5 of the 10 actor GLBs carry 16,632. Full table: `reviews/baseline-2026-11-07.tsv`. This is a
   regression in existing tools, not a hair-card problem, and is handled in Phase 0.
3. **v1's card station is built and unconsumed.** `hair-groom/cards/cards.py` clusters guides into
   2-3 layer cards with twist-free frames, cluster-spread widths, `u` across / `v` root-to-tip UVs and
   a 1.5 mm skin push-out; `cards/textures.py` writes a seeded 2048 px strand atlas, flow map,
   root-to-tip gradient and ID strip; `shell/` builds an inner shell. Its one recorded run
   (`evidence/hair-cards0/RESULT.txt`) made 360 cards from 312 provisional guides, hash-identical
   across two runs, with minimum skin clearance 1.502 mm. It ran on provisional (not fitted) guides,
   rendered only in Cycles, and nothing in the runtime loads it.
4. **v1's strand campaign violates D1 and D9.** Rounds part-r13..r44 and part-open1..9 had LLM workers
   move strand coordinates by hand-written rules to match one photo in Cycles, at about 146 MB per
   groom. It stalled on 2026-10-23, keeper graded "still coarse locks with a broken crown slot"
   (`operator-hair-muse4h.md:181`).

## Goals

- **G1 Deterministic.** Recipe + seed + pinned inputs produce byte-identical outputs. No LLM in the
  station (D9). Style choice happens upstream and is recorded in the case (D13).
- **G2 Reusable.** A new hairstyle is a new recipe. A new actor wearing an existing recipe needs no
  authoring.
- **G3 Runtime-first.** The product is a glTF primitive rendered by three.js, graded in the same
  renderers learners and reviewers use.
- **G4 Visible.** Model Vetting Studio front, three-quarter and profile captures show alpha card edges
  and strand texture where today they show an opaque shell.

## Non-Goals

- Strands at runtime; hair simulation; matching one photograph pixel for pixel.
- Clinical or demographic hair-realism claims; Quest performance claims without headset evidence.
- Changing body, garment or skin stations, beyond the brow and lash regression in Phase 0.

## Open Questions

- **OQ1 Absolute hair budget.** Waits on the first immersive Quest run of the learner runtime. Until
  then V2 records triangles and requires a budget sweep instead of a fixed number.
- **OQ2 Alpha technique on Quest.** `alphaToCoverage` needs MSAA; `main.ts:2835` sets
  `antialias: true`. Whether Quest Browser applies it to the XR layer is UNKNOWN until measured.
- **OQ3 Guide source.** Blender node assets (S3) are the plan. v1's `cards/provisional_guides.py`
  (Poisson roots + gravity fall) is a second candidate not yet compared.
- **OQ4 Library hair after Phase 3.** Whether `cards` becomes the default for all actors or only for
  actors whose recipe has been graded.

## Prior Art

Searched 2026-11-07: this repository, MakeHuman asset packs, MPFB script samples, GitHub, arXiv,
Blender bundled assets. Licence bar: MIT/BSD/Apache/CC0/CC-BY; GPL only for authoring-time Blender
add-ons; unstated or paid refused.

| candidate | licence | verdict |
|---|---|---|
| v1 `hair-groom/cards/` (`cards.py`, `textures.py`, `_blender_build_render.py`) and `shell/` | in-repo | ADOPT. Re-target onto recipe guides and the materializer session |
| Blender 5.2.3 `procedural_hair_node_assets.blend` (32 node groups incl. Generate, Clump, Curl, Frizz, Smooth, Trim) | bundled, authoring-time only | ADOPT for S3. Loaded headless, `probes/ribbon_uv_probe.py` |
| Geometry Nodes Curve to Mesh for ribbons | Blender built-in | NOT NEEDED. The probe's exported UVs are constant (0, 1): `Spline Parameter` read after Curve to Mesh has no curve context. v1 `cards.py` already writes correct UVs in Python |
| DiffHairCard, arXiv 2505.18805 | paper, no code | REFERENCE for a later atlas upgrade (32 tiles, tangent/depth/AO) beyond v1's 2x2 cells |
| HairDeck (github.com/hyz317/HairDeck) | Apache-2.0, gated SAM 3 / DINOv3 deps | REJECT for now: photo input, stylised output |
| MPFB `haireditor` pack | none stated (`asset-licence-records/row-05`) | REFUSED |
| Simple Hair Cards, Hair-Card-Generator, Bystedt, paid add-ons | GPL-paid / GUI / unstated / paid | REJECT |
| CT2Hair, DiffLocks, Hair20k, USC-HairSalon | non-commercial or unknown | REFUSED |
| `@gltf-transform/*` 4.3.0, `meshoptimizer` 1.1.1 | MIT | ADOPT for LOD; installed |
| three.js 0.184.0 `alphaToCoverage` | MIT | ADOPT |
| three.js Kajiya-Kay hair shader | NOT FOUND | write; v1 `textures.py` flow map supplies the tangent |

Meta Quest 3 guidance (device comparison page, updated 2026-05-11): under 200 draw calls and 1.5 M
triangles per frame.

## Critical User Journeys (CUJs)

- **CUJ1 New case, existing style.** Given a case actor with `hair.recipe = "bob_centre_part"` and
  `hair.colour = "dark_brown"`, when the materializer bakes it, then the GLB carries hair cards and an
  inner shell, with no human or LLM step.
- **CUJ2 New style.** Given `recipes/long_low_ponytail.json`, when it is baked on three actors of
  different age, sex and size, then all three succeed without per-actor edits.
- **CUJ3 Learner view.** Given UI-XR at conversational distance, then hair edges read as strands and
  no opaque helmet outline is visible.
- **CUJ4 Reviewer.** Given the Model Vetting Studio, then each actor's card-hair captures sit beside
  its Phase 0 library-hair captures.

## Technical Plan (Architecture)

Everything from S2 to S6 runs inside the materializer's Blender session, next to the existing hair fit
(`materialize_mpfb_humanoid_candidate.py:7444-7456`). There the live `human` still has MPFB basemesh
topology (13,380 vertices), so scalp roots transfer by vertex index. After export the GLB body is
re-imported at 53,672 vertices and that transfer no longer holds (`tools/openclinxr/asset-pipeline/makeclothes/embed_library_hair.py:16-24`), so
no stage runs post-export except `apply_actor_hair_colour.py`.

```
case actor ─(adapter, seeded, recorded: D13)─> hair-recipe.v1.json
                                                     │
 ┌──────────────── materializer Blender session ─────┼──────────────────────────┐
 │ live human ─> S2 scalp roots ─> S3 guides ─> S4 v1 cards.py ─> S6 weights,   │
 │ (basemesh)    (vertex group)   (node assets)    + v1 shell/      export      │
 │                                                   ▲                          │
 │                                     S5 v1 textures.py atlas (cached / family)│
 └──────────────────────────────────────────────────────────────────────────────┘
        └─> actor GLB ─> apply_actor_hair_colour.py (tint) ─> S7 runtime material
```

- **S1 Recipe** (`hair-recipe.v1`): `family`, per-region length (fringe, crown, temples, nape), `part`
  (none, centre, left, right), `density`, `clump`, `curl`, `frizz`, `cardBudget`, `seed`. Colour is a
  case token applied as `baseColorFactor` tint after export. Today style is chosen by the code table
  `HAIR_STYLE_BY_REFERENCE` (materializer `:238-251`); S1 moves the choice into case data.
- **S2 Scalp roots and head axis.** A scalp vertex group on the basemesh, built once from v1's hairline
  and part-band mask logic (commit `d7bec5dbc`), sampled to roots by seed. S2 also computes this
  actor's head axis, which `cards.py` uses for card frames.
- **S3 Guides.** Generate Hair Curves on the roots, then Curl, Clump, Frizz, Smooth and Trim from the
  bundled node assets, every random input taken from the recipe seed. Written in v1's guide schema
  (`guides_xyz (G,P,3)` root-first, `guides_root (G,3)`), which `cards.py` accepts without change.
- **S4 Cards and shell.** v1 `cards.py` as is, then v1 `shell/` for the inner shell. Changes: inputs
  come from S3 and the live body instead of `provisional-guides.npz` and a body dump.
- **S5 Atlas.** v1 `textures.py` per style family, cached by hash of (family fields, code). Its 2x2
  cells and procedural strands stay; DiffHairCard's 32-tile bake is a later upgrade.
- **S6 Export.** Cards and shell weighted to the head bone. Two primitives, because the shell is
  opaque and the cards are alpha: shell `OPAQUE`, cards `MASK` with the atlas. LOD by `gltf-transform`
  + `meshoptimizer`.
- **S7 Runtime material.** Cards get `alphaToCoverage: true` and a Kajiya-Kay highlight from the flow
  map, in both renderers: UI-XR via `packages/openclinxr/xr-asset-loading/src/material-tint.ts`
  (called at `generated-loaders.ts:226-227`, skipped when `cleanSourceComparatorCapture` is set), and
  Model Vetting Studio where `candidate-capture.ts:283-292` swaps materials during its traverse (the
  renderers it creates at `:225` and `:657` already exist).

The station registers like `hair_editor` (`factory-station-core/src/catalog-mod.ts:20,279`,
`factory-stations/src/station-runners.ts:10,27`) and is an alternative to the library-hair fit, which
stays as the fallback.

## Alternatives Considered

- **Continue the v1 strand campaign.** Rejected: LLM-edited coordinates, one photo, one actor (D1, D9).
- **Strands at runtime.** Rejected: Quest 3 guidance caps the frame at 1.5 M triangles; one v1 groom
  as two-triangle ribbons is about 16.7 M (269,480 strands × 31 segments of a 32-point resample × 2),
  INFERRED from the strand count.
- **Library hair only, alpha restored.** Kept as Phase 0 and as the fallback. Limited to the five
  styles in use and the three `mhair02` actors have no texture to restore.
- **New card generator from Curve to Mesh.** Rejected: duplicates v1 `cards.py`.
- **HairDeck.** Rejected: photo input, unresolved dependency licences.

## Non-Functional Requirements

- **Performance.** Hair is two draw calls per actor (shell + cards). Triangle budget per OQ1.
- **Determinism.** Two bakes on the same inputs produce identical GLB sha256.
- **Licence.** Every input pinned by sha256 in a provenance record, as the MakeClothes channels do.
- **Rollout.** Per actor, through case field `hair.source = "cards" | "library"`. `library` stays the
  default for every actor not listed in Phase 3; OQ4 decides the rest.

## Detailed Implementation Plan

| phase | stages | visible result |
|---|---|---|
| 0 | none (existing tools) | library hair with alpha; brow reduction and lash count restored |
| 1 | S1, S2, S3, S4 | untextured cards + shell on ob-patient-aisha |
| 2 | S5, S6 | textured cards on ob-patient-aisha |
| 3 | all | one recipe on three actors |
| 4 | S7 | runtime shading in both renderers; first Quest measurement |

- **Phase 0.** Re-bake the 6 untextured toigo actors (7 actors wear toigo styles; peds-parent-aisha is
  already textured) and confirm the texture survives; find the step that drops it if it does not. The
  3 `mhair02` actors stay untextured library hair and are excluded from Phase 3. For the 4 actors with
  full brows, check bake dates against #597 first: the materializer's default budget is 9,000 and
  `--eyebrow-tris-budget` can keep the full brow on purpose (`:7643-7647`); re-reduce only GLBs that
  predate it. Find where lashes went from 368 to 16,632 (5 actors) and why family-partner carries
  3,239 (UNKNOWN). The Phase 0 GLBs become the known-good column for V5.
- **Phase 1.** Subject ob-patient-aisha, v1's subject, so the comparison with v1 renders is direct.
- **Phase 3.** ob-patient-aisha (adult female), peds-patient-child (child), gown-ed-robert-hayes (adult
  male); flip those three to `cards`. All three wear toigo styles, so each has a Phase 0 alpha baseline.

### Target Files to Create/Modify

- Create `tools/openclinxr/hair-groom-2/recipe.schema.json` and `recipes/bob_centre_part.json`.
- Create `tools/openclinxr/hair-groom-2/scalp_base.py` (S2), `guides.py` (S3), `stage.py` (S2-S6
  orchestration called from the materializer), `run.py` (station runner and run record).
- Modify `tools/openclinxr/hair-groom/cards/cards.py` and `shell/`: accept the live body instead of the
  dumped `body-geo.npz`, and take the head axis from S2 instead of the hard-coded
  `evidence/hair-scalp1/scalp.npz` (`cards.py:50`, used by `transport_frames` at `:96`), which is one
  actor's axis. Report push-out count and maximum displacement (V4). No change to clustering, widths
  or UVs.
- Modify `tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py`: call `stage.py`
  when `hair.source == "cards"`, beside the hair fit at `:7444-7456`.
- Create `packages/openclinxr/factory-stations/src/hair_cards/{plan.ts,run.ts}` and tests, mirroring
  `hair_editor/`; Modify `factory-station-core/src/catalog-mod.ts` and `factory-stations/src/station-runners.ts`.
- Modify `packages/openclinxr/shared-schemas/src/face-phenotype/actor-phenotype.ts` (`:30` has
  `hair_color`, `hair_density`): add `hair_recipe` and `hair_source`.
- Modify `apply_actor_hair_colour.py`: tint the card material, which has a texture, through
  `baseColorFactor`, and leave the shell's flat colour matched to it.
- Modify `packages/openclinxr/xr-asset-loading/src/material-tint.ts` and
  `apps/arena/model-vetting-studio/src/candidate-capture.ts` (S7).

### Verification Plan

Images are graded by the orchestrator at native resolution in the three.js renderer of the Model
Vetting Studio, never upscaled, never only in Cycles.

| gate | check | threshold (source) |
|---|---|---|
| V1 determinism | bake twice, compare GLB sha256 | equal |
| V2 cost | card + shell triangles per actor, at `cardBudget` 50, 100, 200, 400 | no fixed number until OQ1; the sweep is graded under V7 and the chosen budget recorded with its captures (range from DiffHairCard) |
| V3 draw calls | hair primitives per actor | 2: shell + cards (S6) |
| V4 clearance | (a) minimum guide-centreline distance to skin BEFORE `cards.py` push-out, positive outside; (b) maximum push-out displacement | (a) ≥ 0 (a centreline inside the head is a guide defect, not a card one); (b) ≤ 2.2 mm (the card layer offset, `cards.py` step 2: a larger push can reorder layers). `cards.py`'s own post-push gate ≥ 0 passes by construction and is not a gate here |
| V5 coverage by region | bare-scalp pixel fraction in crown, temples, nape, part band, per view | each region ≤ the same actor's Phase 0 alpha library hair under the same instrument; the part band is exempt for parted recipes |
| V6 reuse | one recipe on 3 actors | 3 of 3, no recipe edit |
| V7 visual | closed checklist per front, three-quarter, profile | alpha edges at the silhouette; no opaque outline; no bare scalp outside the part band; strand direction matches the recipe |
| V8 symmetry | left vs right scalp coverage | within the instrument of `humanoid-bake-evidence/.../hair-covers-both-sides-of-the-head.test.ts` |

V5's instrument is a three.js render with the hair hidden, giving the scalp mask, then with hair
shown; the region boxes are fixed per camera in the run record before the first card bake. V5 bounds
each region separately so hair piled on the crown cannot hide a bare nape.

Destructive probes, run in this worktree: hair material set to `OPAQUE` fails V7; atlas deleted makes
the bake refuse; seed perturbed is detected by V1; guides moved 5 mm into the head fail V4.

*Drafted with EGM*
