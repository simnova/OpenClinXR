---
name: makeclothes-garments
description: "Fit a MakeHuman .mhclo garment onto a body through the MakeClothes station. Load BEFORE acquiring a garment, running a fit, or refusing an asset on its licence header - carries the installed toolchain, the measured library-vs-worn gap, the hm08-versus-MPFB trap, and the licence precedence that reversed two wrong refusals."
---

# MakeClothes garments

MakeClothes is **already integrated**. Anyone told otherwise should check before acting: there is a
dedicated pipeline directory, two CLIs, and six garments on live-cast actors.

## What exists, measured 2026-08-25

| surface | state |
|---|---|
| pipeline | `tools/openclinxr/asset-pipeline/makeclothes/` — `fit_stage.py`, `body_param_stage.py`, `embed_library_hair.py`, `embed_library_footwear.py`, `garment_coverage.py`, `separate_layered_garment.py` |
| CLIs | `pnpm asset:makeclothes:fit -- --once`, `pnpm asset:body-param:fit` |
| toolchain | Blender 5.1 + the MPFB extension at `~/Library/Application Support/Blender/5.1/extensions/user_default/mpfb` |
| cached sources | 12 distinct `.mhclo` garments across 8 packs under `.openclinxr-local/provider-cache/garments/sources/` |
| worn by the live cast | **6** — `lab_coat`, `toigo_t_shirt`, `fisherman_sweater`, `hair_toigo_blunt_bob_with_bangs`, `hair_mhair02`, `eyes_low_poly` |

MPFB is **not vendored**. The stage drives Blender's user-extension MPFB, so a machine without that
extension cannot fit anything, and that is a blocked-environment result rather than a garment failure.

## THE TRAP: the fit station targets hm08, which is the rail being retired

`pnpm asset:makeclothes:fit` says it plainly in its own usage text:

> Factory clothing station: fit one CC-BY `.mhclo` onto **hm08** via ClothesService

The live cast is MPFB — 14 shipped scenarios resolve to 9 assets, all MPFB. So the station as wired
produces library GLBs on a rail `#652` is retiring. **Fitting a garment through it does not dress a
learner-facing actor**, and a green fit report is not product progress. Confirm which body class you
are targeting before you run anything.

There is also no batch mode: `--once` is required and is the only mode.

## LICENCE: the `.obj` header is not the asset licence

This reversed two wrong refusals, and it is the most expensive thing here to rediscover.

`#540` refused `cortu_cargo_pants` and `culturalibre_male_boots` on one line in their `.obj`:

```
# license AGPL3 (see also http://www.makehuman.org/doc/node/external_tools_license.html)
```

That is stale template boilerplate. **`makehuman.org` is now a parked domain for sale**, so the
document it defers to does not exist, and it defers to an *external tools* licence — the software —
not the asset. Meanwhile `culturalibre_male_boots.mhclo` says `# license CC-0`, and both pack pages
list every asset as CC0 with no mention of AGPL anywhere.

**Precedence, in order:**

1. the asset's own descriptor (`.mhclo` / `.mhmat`) — the author's declaration
2. the publisher's per-asset pack page at `static.makehumancommunity.org/assets/assetpacks/<pack>.html`
3. a mesh-header line — **only** when asset-specific, never when it is boilerplate deferring to an
   external-tools document

Silence still refuses. Two asset-specific sources disagreeing still refuses.

**What this does NOT reverse:** `skins01` / `skins02` stay refused. Those carry
`# This file is licensed AGPLv3` as an explicit per-file statement in the asset's own `.mhmat`
descriptor, and 21 of 23 carry no licence line at all. Different shape, different answer.

**Reaching the site:** `makehumancommunity.org` refuses HTTPS. Use `static.makehumancommunity.org`,
which serves the asset-pack pages. Every acquisition or refusal goes in
`docs/openclinxr/third-party-asset-licence-ledger.md`, including the refusals, so nobody re-litigates
them.

## Before you fit anything

1. **Is it already worn?** Grep the live-cast provenance for the garment name before acquiring or
   fitting. Six are already on actors.
2. **Which body class?** hm08 gets you a library GLB on a retiring rail. Say which you meant.
3. **Does the licence clear under the precedence above?** Check the `.mhclo` and the pack page, not
   the `.obj`.
4. **Is the fit the defect, or the geometry?** `#659` measured a footwear shell where 37.8% of the
   foot sat outside its own shoe while the same code fitted another actor correctly. A garment that
   exists is not a garment that fits, and the containment measure is the discriminator.

## Known garment-quality traps, already paid for

- **`toigo_flats` is 28,800 faces before anything runs** (`#475`). That is author-side, not a bake
  defect, so decimation is the answer and re-baking is not.
- **A wired consumer can still produce nothing usable.** `makeclothes_library_cargo_pants` measured
  392 triangles over a 26,756-triangle body — trousers that cannot cover legs, while the scrub shirt
  from the same library on the same body is 9,384 triangles and does cover. Ask whether the wired
  component produces output that WORKS, not only whether it is wired.
- **Boundary loops.** `#656` records the generator emitting 2- and 3-vertex boundary loops that
  survived its own weld pass; the MakeClothes library rail had none. If you are comparing rails, that
  is a real difference and not noise.


## RUN IT: the fit works, and its own grade render is unreadable

Measured 2026-08-25 by running `pnpm asset:makeclothes:fit -- --once` end to end.

```
ok: true   garmentId: wojackowl_scrubs_shirt_hm08   garmentTriangleCount: 9384
licenseToken: CC-BY (from mhclo_header:Scrub_Shirt.mhclo, author WojackOWL)
fitWallClockS: 0.1263
```

The GLB rewrote **byte-identically** — only the report and catalog changed — so the fit is
deterministic. `fitWallClockS` is the ClothesService binding step alone, not the Blender boot, so a
tenth of a second there is not the stale-cache smell it looks like.

### The output GLB, measured — this is what the numbers say

| mesh | verts | tris | Y range |
|---|---:|---:|---|
| `hm08_basemesh_library` | 73,920 | 36,972 | 0.000 – 1.760 |
| `makeclothes_library_scrub_shirt` | 18,768 | 9,384 | **0.976 – 1.510** |

The garment spans hip to shoulder. **It is a shirt.** Do not conclude otherwise from a render.

### THE RENDER TRAP, which has now caught two different reviewers

`.openclinxr/evidence/issue-215/fitted-garment-grade.png` shows what looks like a hooded,
floor-length robe. `PROTO_VERIFY_DELEGATION` already records an orchestrator misreading that exact
image as a robe and blaming Blender Workbench discarding Principled Base Color. **That explanation is
incomplete and the render is worse than "wrong colours".**

MEASURED: render the body with the garment HIDDEN and with it SHOWN. The two frames are
**pixel-identical**. The robe is therefore the BODY mesh, not the garment and not a shading artifact.
The fitted shirt sits UNDERNEATH it and only shows as teal slivers at the shoulders.

**INFERRED, not yet proven:** that shape is MakeHuman helper geometry — the loose outer shell used
for clothes fitting, which reads as a shapeless robe from shoulders to ankles, with helper blobs at
the feet and strips at the head. `ExportService.bake_modifiers_remove_helpers()` is the proven API
for stripping it, and `mpfb2-actor-is-stripped-of-helpers.test.ts` exists for the MPFB rail. The
library rail's basemesh appears never to have been stripped.

**The measurement that would settle it** (not yet run): at hip height, count distinct surface radii
along a horizontal ray. A body plus a helper shell gives two concentric surfaces; a bare body gives
one. Vertex-index stripping will NOT work here — the exported mesh is 73,920 verts with **zero
vertex groups**, and separating by loose parts yields **18,474 islands** of ~4 verts each, so the
glTF export is fully unwelded and carries no helper grouping to key off.

**Consequence for anyone grading this station:** its shipped grade PNG cannot show whether a garment
fitted correctly, because the body mesh occludes the garment entirely. Grade the NUMBERS (the mesh
Y-range table above), or strip helpers before rendering.

## grok-imagine → clothing: the binding is the crux, and MPFB can compute it

A `.mhclo` is a **binding, not a mesh**. Each garment vertex is bound to three basemesh vertex
indices with barycentric weights plus an offset:

```
basemesh hm08
verts 0
8191 8163 8209  0.2699 0.4253 0.3048  0.0003 0.0034 0.0066
```

That is why one garment fits any body: the base deforms and every garment vertex rides its triangle.
A TRELLIS mesh from an image has no such binding, so it cannot be MakeClothes clothing as-is.

**But the installed MPFB can CREATE the binding**, which is the part that makes this feasible:

- `ClothesService.create_mhclo_from_clothes_matching(basemesh, clothes, ...)` — `clothesservice.py:724`
- `ClothesService.mesh_is_valid_as_clothes(mesh_object, basemesh)` — `clothesservice.py:619`
- the authoring UI ships too: `ui/create_assets/makeclothes/` with `extractclothes.py` and
  `writeclothes.py`

`mesh_is_valid_as_clothes` names the gate a generated mesh must pass: a real MESH object with
vertices, **every vertex in at least one and at most one vertex group**, every vertex belonging to a
face, uniform face type, clothes groups present on the basemesh, and matching scale.

**So the pipeline is: image → mesh → align to the basemesh → assign vertex groups → create_mhclo →
ClothesService fits it to any body.** The two hard parts are the vertex-group requirement (a TRELLIS
blob has none) and topology class: TRELLIS produces a closed watertight solid, while a garment needs
an open shell with neck, arm and hem openings.

**The cheap variant worth trying first:** generate a fabric or pattern IMAGE and apply it as a
texture to an already-fitted garment. That needs no binding at all and gets visual variety
immediately. Reserve mesh generation for the case where the garment SHAPE is genuinely missing.

## claimScope / notEvidenceFor

- **claimScope:** the installed toolchain, the CLIs, the measured library-versus-worn gap, and the
  licence precedence, all as of 2026-08-25.
- **notEvidenceFor:** that any fitted garment looks right — that is a pixel grade and belongs to the
  reviewer. Nor that the hm08 station should be rewired to MPFB; that decision sits with `#652`.
