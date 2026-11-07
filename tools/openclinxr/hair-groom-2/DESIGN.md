# hair-groom-2: deterministic hair cards for MPFB actors

**Author:** Patrick Gidich
**Status:** Proposed (review rounds 1-3 resolved; round 3 resolution in `reviews/adversarial_round3_report.md`)
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
   regression in existing tools, not a hair-card problem, and is handled in Phase 0b.
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
   (`operator-hair-muse4h.md:181`). Its keeper `part-open8` is retired in `PROJECT_STATUS.md` by this
   design.
5. **Wrong-sex and duplicated styles.** `HAIR_STYLE_BY_REFERENCE` (`:238-251`) maps an unkeyed
   reference to `toigo_blunt_bob_with_bangs`. Four actors wear it: ob-patient-aisha, peds-parent-aisha,
   and the two adult males gown-ed-robert-hayes and gown-adult-patient (`robert_reference`). This is the
   most visible hair defect in the cast today and is fixed in Phase 0a, not by cards.
6. **Library hair sources are not on this machine.** The materializer reads
   `.openclinxr-local/provider-cache/hair/sources/makehuman-hair01/` and `makehuman-community-male/`
   (`:278-279`). No `hair/` directory exists in the provider cache of the shared checkout or this
   worktree (only `eyes/`, `garments/`), so no library hair bake can run until it is re-acquired.
7. **The library catalogue was under-assessed.** Rounds 1-2 rejected the library route as "five styles".
   Since the 2026-09-17 catalogue ruling all 25 hair01 styles are licence-permitted
   (`third-party-asset-licence-ledger.md:116-119` and the hair01 row). 21 are usable; 4 are excluded on
   helper-vertex topology (`culturalibre_hair_01`, `culturalibre_hair_05`, `faydaen_hair_1`,
   `sonntag78_junglebook_hair`), per `.openclinxr/evidence/issue-330/hair-licence-classification.json`
   and a re-run on 2026-11-07. MakeHuman's Hair 02 and Hair 03 packs
   are unassessed (INFERRED from the reviewer; not yet fetched).

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
- Changing body, garment or skin stations, beyond the brow and lash regression in Phase 0b.

## Open Questions

- **OQ1 Absolute hair budget.** Waits on the first immersive Quest run of the learner runtime. Until
  then V2 records triangles and requires a budget sweep instead of a fixed number.
- **OQ2 Alpha technique on Quest.** `alphaToCoverage` needs MSAA; `main.ts:2835` sets
  `antialias: true`. Whether Quest Browser applies it to the XR layer is UNKNOWN until measured.
  Fill cost of several card-haired actors in one station (overdraw) is unmeasured; Phase 5 records it
  per scene.
- **OQ3 Guide source.** Blender node assets (S3) are the plan. v1's `cards/provisional_guides.py`
  (Poisson roots + gravity fall) is a second candidate not yet compared.
- **OQ4 Library hair after Phase 4.** Whether `cards` becomes the default for all actors or only for
  actors whose recipe has been graded. Phase 0c's decision gate may answer it earlier.

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
  its Phase 0a library-hair captures.

## Technical Plan (Architecture)

Scalp roots must be taken while the body still has MPFB basemesh topology (13,380 vertices). After
export the GLB body is re-imported at 53,672 vertices and transfer by vertex index no longer holds
(`tools/openclinxr/asset-pipeline/makeclothes/embed_library_hair.py:16-24`). The materializer is
10,256 lines with 47 commits since 2026-10-01, so the station does not run inside it: the materializer
only dumps and re-imports, and S2-S5 run standalone where they can be tested on one head (D3, D4).

- **Dump** (materializer, beside the hair fit at `:7444-7456`, before the helper strip): basemesh body
  vertices, head-bone frame, and the scalp vertex group to `head-dump.npz`, hashed in the run record.
- **Station** (standalone Blender, `run.py`): S2-S5 read only `head-dump.npz`, the recipe and the atlas
  cache, and write `cards-shell.npz` (vertices, UVs, head-bone weights, card ids).
- **Re-import** (materializer): S6 builds the two primitives from `cards-shell.npz` and exports.

```
case actor ─(adapter, seeded, recorded: D13)─> hair-recipe.v1.json
                                                     │
 materializer ── head-dump.npz ──> station: S2 scalp roots ─> S3 guides ─> S4 cards.py + shell/
     ▲                                          S5 textures.py atlas (cached by content) ──┘
     └──────────────── cards-shell.npz <───────────────────────────────────────────────┘
 materializer S6 export ─> actor GLB ─> apply_actor_hair_colour.py (tint) ─> S7 runtime material
```

- **S1 Recipe** (`hair-recipe.v1`): `family`, per-region length (fringe, crown, temples, nape), `part`
  (none, centre, left, right) and `partWidthMm`, `density`, `clump`, `curl`, `frizz`, `cardBudget`, `seed`. Colour is a
  case token applied as `baseColorFactor` tint after export. Today style is chosen by the code table
  `HAIR_STYLE_BY_REFERENCE` (materializer `:238-251`); S1 moves the choice into case data.
- **S2 Scalp roots and head axis.** A scalp vertex group on the basemesh, built once from v1's hairline
  and part-band mask logic (commit `d7bec5dbc`), sampled to roots by seed. S2 also computes this
  actor's head axis, which `cards.py` uses for card frames.
- **S3 Guides.** Generate Hair Curves on the roots, then Curl, Clump, Frizz, Smooth and Trim from the
  bundled node assets, every random input taken from the recipe seed. Written in v1's guide schema
  (`guides_xyz (G,P,3)` root-first, `guides_root (G,3)`), which `cards.py` accepts without change.
- **S4 Cards and shell.** v1 `cards.py`, then v1 `shell/` for the inner shell. Clustering, widths and
  UVs are unchanged. Inputs change: guides from S3 and the body from `head-dump.npz`, replacing the
  hard-coded hair-light2 / hair-scalp1 / hair-cards0 paths (`cards.py:47-50`). `cardBudget` becomes a
  `cards.py` argument that sets the cluster count; the fixed 300-800 card window that raises outside
  it becomes `[0.5, 1.5] × cardBudget`.
- **S5 Atlas.** v1 `textures.py` per style family. Its seed comes from the recipe (today
  `SEED = 7`, `textures.py:37`), and `curl`, `frizz` and `clump` drive strand waviness, jitter and
  clump width (today ignored). Cached by hash of the atlas inputs, not of `cards.npz`'s id strip. Its
  2x2 cells and procedural strands stay; DiffHairCard's 32-tile bake is a later upgrade.
- **S6 Export.** Cards and shell weighted to the head bone; a recipe whose longest region reaches
  below the chin is also weighted to `neck01` and `spine05` by distance (library hair ends at the chin
  and is 100% head-weighted, which a long recipe cannot be). Exactly two hair primitives: shell
  `OPAQUE` untextured, cards `MASK` with the atlas; the library-hair primitive is not exported when
  `hair.source = "cards"`. No LOD: nothing in `apps/` or `packages/` consumes `MSFT_lod` or
  `THREE.LOD`, so LOD waits for a runtime switch.
- **S7 Runtime material.** Cards get `alphaToCoverage: true` and a Kajiya-Kay highlight from the flow
  map, in both renderers: UI-XR via `packages/openclinxr/xr-asset-loading/src/material-tint.ts`
  (called at `generated-loaders.ts:226-227`), and Model Vetting Studio where `candidate-capture.ts:283-292`
  swaps materials during its traverse (the renderers it creates at `:225` and `:657` already exist).
  The graded path is the lit capture pass with `material-tint.ts` applied. Clean comparator captures
  (`cleanSourceComparatorCapture`) skip `material-tint.ts` and are not graded for hair.

The station registers like `hair_editor` (`factory-station-core/src/catalog-mod.ts:20,279`,
`factory-stations/src/station-runners.ts:10,27`) and is an alternative to the library-hair fit, which
stays as the fallback. `hair_editor` drives the MPFB `haireditor` pack's sliders; that pack has no
stated licence (`asset-licence-records/row-05`) and stays refused, so `hair_editor` is dormant and
hair-groom-2 does not use it.

## Alternatives Considered

- **Continue the v1 strand campaign.** Rejected: LLM-edited coordinates, one photo, one actor (D1, D9).
- **Strands at runtime.** Rejected: Quest 3 guidance caps the frame at 1.5 M triangles; one v1 groom
  as two-triangle ribbons is about 16.7 M (269,480 strands × 31 segments of a 32-point resample × 2),
  INFERRED from the strand count.
- **Library hair only, alpha restored.** Kept as Phase 0 and as the fallback, and assessed in full in
  Phase 0c: the 21 usable hair01 styles plus Hair 02/03 once fetched and classified. It loses only
  if Phase 0c's gate fails. The three `mhair02` actors have no source texture to restore.
- **New card generator from Curve to Mesh.** Rejected: duplicates v1 `cards.py`.
- **HairDeck.** Rejected: photo input, unresolved dependency licences.

## Non-Functional Requirements

- **Performance.** Hair is two draw calls per actor (shell + cards). Triangle budget per OQ1.
- **Testability.** S2-S5 run standalone from `head-dump.npz`; no stage needs the materializer to run.
- **Determinism.** Two bakes on the same inputs produce identical GLB sha256.
- **Licence.** Every input pinned by sha256 in a provenance record, as the MakeClothes channels do.
- **Rollout.** Per actor, through case field `hair.source = "cards" | "library"`. `library` stays the
  default for every actor not listed in Phase 4; OQ4 decides the rest.

## Detailed Implementation Plan

| phase | stages | visible result |
|---|---|---|
| 0a | none (existing tools) | library hair with alpha on the toigo actors; the two adult males in a male style |
| 0b | none (existing tools) | brow reduction and lash count restored |
| 0c | none (existing tools) | graded library-style board; decision gate for phases 2-5 |
| 1 | none (v1 output) | v1 cards + atlas on ob-patient-aisha in Model Vetting Studio |
| 2 | S1, S2, S3, S4 | recipe-driven untextured cards + shell on ob-patient-aisha and peds-patient-child |
| 3 | S5, S6 | textured cards on the same two actors |
| 4 | all | one recipe on three actors |
| 5 | S7 | runtime shading in both renderers; first Quest measurement |

- **Phase 0a.** Prerequisite: re-acquire `makehuman-hair01` and `makehuman-community-male` into
  `.openclinxr-local/provider-cache/hair/sources/` from the sources in
  `docs/openclinxr/asset-licence-records/row-13-*.json` and `row-14-*.json`, re-run
  `hair-licence-classify.ts`, and diff against the tracked
  `.openclinxr/evidence/issue-330/hair-licence-classification.json`; no library bake runs without it. Then re-bake the 6 untextured
  toigo actors (peds-parent-aisha is already textured), confirm the texture survives, and find the step
  that drops it if it does not. Bakes also need the MPFB Blender extension
  (`bl_ext.user_default.mpfb`), which is not installed in this machine's Blender 5.2.3.
  `mhair02`'s source page (`makehumancommunity.org/clothes/mhair02.html`) returned 404 on 2026-11-07,
  so `makehuman-community-male` cannot be re-acquired and the 3 `mhair02` actors cannot be re-baked. Key `robert_reference` in `HAIR_STYLE_BY_REFERENCE` to a male style so
  gown-ed-robert-hayes and gown-adult-patient stop wearing the female bob: the textured male-reading
  style Phase 0c ranks first, or `cortu_short_messy_hair` (hair01, catalogue CC0, short, textured) until 0c has run. The 3 `mhair02` actors stay untextured
  and are excluded from Phase 4. The Phase 0a GLBs are the known-good column for V5.
- **Phase 0b.** For the 4 actors with full brows, check bake dates against #597 first: the
  materializer's default budget is 9,000 and `--eyebrow-tris-budget` can keep the full brow on purpose
  (`:7643-7647`); re-reduce only GLBs that predate it. Find where lashes went from 368 to 16,632
  (5 actors) and why family-partner carries 3,239 (UNKNOWN).
- **Phase 0c.** Classify the 21 usable hair01 styles with `hair-licence-classify.ts`; fetch
  Hair 02 and Hair 03, record them in the ledger, and classify them the same way. Fit every permitted
  textured style on ob-patient-aisha, peds-patient-child and gown-ed-robert-hayes and grade V5, V7 and
  V8 under the Phase 0a instrument. **Gate:** if the library gives each of those three actors a
  distinct, sex-appropriate style that passes V5, V7 and V8, phases 2-5 are limited to recipes the
  library lacks (CUJ2: long and tied styles) and the 4 bob-sharing actors are re-keyed to library
  styles. If it does not, phases 2-5 run as written.
- **Phase 1 (spike).** Export v1's existing `cards.npz` and atlas (provisional guides,
  `evidence/hair-cards0/`) to a GLB, load it on ob-patient-aisha in Model Vetting Studio, and capture
  front, three-quarter, profile and `body_motion`, graded under V7 against the Phase 0a capture. This
  is the first runtime view of cards and runs before any S1-S3 work. It uses one actor because v1's
  cards were built on aisha's body dump; a second actor needs Phase 2's re-targeted `cards.py`.
- **Phase 2.** ob-patient-aisha, v1's subject, so the comparison with v1 renders is direct, and
  peds-patient-child, so a head axis other than v1's is exercised from the first recipe bake.
- **Phase 4.** ob-patient-aisha (adult female), peds-patient-child (child), gown-ed-robert-hayes (adult
  male); flip those three to `cards`. The male baseline is his Phase 0a style. If that is untextured
  `mhair02`, his V5 known-good is ob-patient-aisha's Phase 0a value.

The baseline TSV (`reviews/baseline-2026-11-07.tsv`) and every run record are tracked under this
directory. Images each phase captures are registered with `pnpm docs:artifacts` in the commit that
lands them. v1's `evidence/hair-cards0/renders/sheet.png` is not in this tree (only
`render-times.json` is tracked), so Phase 1 re-renders it rather than registering it.

### Target Files to Create/Modify

- Create `tools/openclinxr/hair-groom-2/recipe.schema.json` and `recipes/bob_centre_part.json`.
- Create `tools/openclinxr/hair-groom-2/scalp_base.py` (S2), `guides.py` (S3), `run.py` (standalone
  station: reads `head-dump.npz`, writes `cards-shell.npz` and the run record), `spike_export.py`
  (Phase 1: v1 `cards.npz` + atlas to GLB).
- Modify `tools/openclinxr/hair-groom/cards/cards.py` and `shell/`: take body, guides and head axis as
  arguments instead of the hard-coded paths at `cards.py:47-50` (the head axis is used by
  `transport_frames` at `:96`); take `cardBudget` and replace the fixed 300-800 window; report
  push-out count and maximum displacement (V4). No change to clustering, widths or UVs.
- Modify `tools/openclinxr/hair-groom/cards/textures.py`: seed and family fields as arguments
  (`:30-31`, `:37`).
- Modify `tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py`: when
  `hair.source == "cards"`, write `head-dump.npz` beside the hair fit at `:7444-7456`, run `run.py`,
  re-import `cards-shell.npz` and skip the library fit. Key `robert_reference` (Phase 0a).
- Create `packages/openclinxr/factory-stations/src/hair_cards/{plan.ts,run.ts}` and tests, mirroring
  `hair_editor/`; Modify `factory-station-core/src/catalog-mod.ts` and `factory-stations/src/station-runners.ts`.
- Modify `packages/openclinxr/shared-schemas/src/face-phenotype/actor-phenotype.ts` (`:30` has
  `hair_color`, `hair_density`): add `hair_recipe` and `hair_source`.
- Modify `apply_actor_hair_colour.py`: tint the card material through `baseColorFactor` and keep it
  `MASK` with its texture; match the shell's flat colour to it.
- Modify `packages/openclinxr/xr-asset-loading/src/material-tint.ts` and
  `apps/arena/model-vetting-studio/src/candidate-capture.ts` (S7).

### Verification Plan

Images are graded by the orchestrator at native resolution in the three.js renderer of the Model
Vetting Studio, never upscaled, never only in Cycles. Every capture names its camera id, capture pass
(`lit`), alpha cutoff and MSAA setting in the run record. Non-lit passes (`candidate-capture.ts:253,259`)
drop alpha and are not used for hair gates.

| gate | check | threshold (source) |
|---|---|---|
| V1 determinism | bake twice, compare GLB sha256; run record lists every input opened with its hash | equal sha256; inputs list names this actor's `head-dump.npz` hash and no hair-light2 / hair-scalp1 / hair-cards0 path |
| V1 seed | same recipe seed twice; then seed + 1 | same seed: equal POSITION accessor hash; seed + 1: different POSITION and atlas hashes |
| V2 cost | card + shell triangles per actor, at `cardBudget` 50, 100, 200, 400 | no fixed number until OQ1; chosen budget = smallest that passes V5 and V7 on all Phase 4 actors, recorded with its captures |
| V3 primitives | hair primitives per actor, by `alphaMode` and texture | exactly 1 `MASK` + `baseColorTexture` (cards), 1 `OPAQUE` untextured (shell), 0 library-hair primitives |
| V4 clearance | (a) minimum SIGNED guide-centreline distance to skin before `cards.py` push-out, sign from the nearest face normal; (b) maximum push-out displacement | (a) ≥ 0; (b) ≤ 2.2 mm, the card layer offset (`cards.py` step 2: a larger push can reorder layers). v1 `hair-cards0`'s maximum push is measured before Phase 2 as the known-good column; if it already exceeds 2.2 mm the offset, not the guides, is the defect. `_geom.MeshIndex.query` is unsigned and is not used for (a); `cards.py`'s own post-push gate passes by construction and is not a gate |
| V4 garment | minimum signed card-vertex distance to garment and shoulder skin over `body_motion` frames | ≥ 0 on every frame |
| V5 coverage by region | bare-scalp pixel fraction in crown, temples, nape, part band, per view, cards only (shell hidden) | each region except the part band ≤ the same actor's Phase 0a value; the part band's measured width on the front view ≤ the recipe's `part` width |
| V6 reuse | one recipe on 3 actors | per actor V3, V4, V5, V7, V8 pass; head axes differ between actors; no actor id appears in station code |
| V7 visual | closed checklist per front, three-quarter, profile, graded at native resolution | alpha edges at the silhouette; no opaque outline; no face, cheek or neck visible through hair; no visible card planes or stair-stepped layers; tip line irregular (no straight hem); no repeating 2x2 atlas cell; roots darker than tips; no hair inside the eye/face band; colour matches the case token; image mean luminance above the exposure floor fixed in the run record |
| V7 alpha | alpha-covered fraction per `v` band of the atlas | below 1.0 in every band (root band included), so no card is an opaque ribbon |
| V7 motion | `body_motion` webm, MSAA on and off | no shimmer at the card edges with MSAA on; the off clip is the counterweight |
| V8 symmetry | left vs right bare-scalp fraction from the V5 render, split at the head's mid-sagittal plane | difference ≤ the largest Phase 0a asymmetry among the three Phase 4 actors. `hair-covers-both-sides-of-the-head.test.ts` counts `/scalp_hair/` vertices and returns null for cards, so it is not reused |
| V9 families | two recipes from different families | different atlas hashes |
| V10 export survival | after `apply_actor_hair_colour.py` | cards still `MASK` with texture; cards and shell weighted to the head bone (and `neck01`/`spine05` for long recipes) |

V5's scalp mask comes from an ID pass of S2's scalp vertex group, not from a hair-hidden render; the
region boxes are fixed per camera in the run record before the first card bake. V5 measures the cards
alone because the opaque shell would drive bare scalp to zero by itself, and bounds each region
separately so hair piled on the crown cannot hide a bare nape. The Phase 0a known-good column is graded
under V7 before any card bake is compared with it.

Destructive probes, run in this worktree: cards `alphaMode` set to `OPAQUE` fails V3 mechanically;
atlas deleted makes the bake refuse; seed perturbed fails V1 seed; guides moved 5 mm into the head fail
V4(a); a second recipe family with an identical atlas fails V9.

*Drafted with EGM*
