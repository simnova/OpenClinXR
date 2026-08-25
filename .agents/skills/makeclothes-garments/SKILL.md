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

**CONFIRMED 2026-08-25 — the garment is fine and the shell hides it.** Three measurements, and a
render that finally shows the garment:

1. before/after frames with the garment hidden vs shown are **pixel-identical**
2. ray-casting outward from the centreline finds an **enclosing surface at ~0.21 m radius** from shin
   to chest; at thigh and shin it is the ONLY surface, which a bare body cannot produce (casting
   forward from between the legs would hit nothing)
3. deleting body faces with `hypot(x,y) > 0.16` below the head reveals **a clean teal scrub top —
   V-neck, short sleeves, hem at the hip, fitted to the torso**

### The recipe that makes this station gradeable

```python
# after import, before render — delete the enclosing shell from the BODY mesh only
bm = bmesh.new(); bm.from_mesh(body.data)
kill = [f for f in bm.faces
        if math.hypot(*f.calc_center_median()[:2]) > 0.16 and f.calc_center_median().z < 1.62]
bmesh.ops.delete(bm, geom=kill, context='FACES')
```

It culls ~26,000 of 36,972 faces and costs nothing. Render EEVEE with `view_transform="Standard"`
and `exposure=-0.4`; keep the GLB's OWN materials (`hm08_skin`, `scrub_teal`) rather than repainting,
because they are already distinct and repainting them washed the frame out on the first attempt.

Culling by radius also removes the arms in T-pose. That is acceptable for grading the torso garment
and wrong for grading sleeves — raise the radius or cull by height band if sleeves are the subject.

**Still INFERRED:** that the shell is specifically MakeHuman helper geometry — the loose outer shell used
for clothes fitting, which reads as a shapeless robe from shoulders to ankles, with helper blobs at
the feet and strips at the head. `ExportService.bake_modifiers_remove_helpers()` is the proven API
for stripping it, and `mpfb2-actor-is-stripped-of-helpers.test.ts` exists for the MPFB rail. The
library rail's basemesh appears never to have been stripped.

**What it is NOT:** vertex-index stripping will not work here — the exported mesh is 73,920 verts with **zero
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


## THE WORKING MPFB RECIPE — proven end to end 2026-08-25

The station's problem is one line: `fit_stage.py` takes `--mh-base-obj` and raw-imports MPFB's
`data/3dobjs/base.obj` via `bpy.ops.wm.obj_import`. **That raw file ships helper geometry**, which is
the enclosing shell. `PROTO_CURIOUS_RESEARCHER` already recorded this exact hand-rolling — base-import
plus a separate macro pass plus grounding in post, "three steps that are parameters on one documented
call".

Proven by running it:

**CORRECTED 2026-08-25, same day, where it was stated.** My first version of this table read
"73,920 verts" for the raw import against 19,158 for `create_human`. That compared a POST-EXPORT count
against a PRE-EXPORT one — glTF splits vertices at UV and normal seams, so 19,158 becomes 73,920 in
the GLB. Not like for like. The real comparison is better and sharper:

| | verts | vertex groups | stature |
|---|---:|---:|---:|
| raw `base.obj` import (what the station does) | 19,158 | **0** | **16.945 m** |
| `HumanService.create_human()` | 19,158 | **152** | **1.694 m** |

**Same geometry. The helper shell is in BOTH.** `mask_helpers=True` works by masking helper VERTEX
GROUPS, and a raw `.obj` import has none — so the mask has nothing to bind to and the shell survives
to export. That is the actual mechanism, and it is not "create_human gives a different mesh".

The stature column is the other half: the raw import is in MakeHuman native decimetres (16.9 units),
which is why the stage has an Anny stature-align step at all. `create_human` applies `scale=0.1` and
grounds the feet, so it arrives already at 1.694 m.

```python
bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")   # namespaced; bare `mpfb` fails
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.clothesservice import ClothesService
from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo

basemesh = HumanService.create_human(mask_helpers=True, detailed_helpers=True,
                                     extra_vertex_groups=True, feet_on_ground=True)

bpy.ops.wm.obj_import(filepath=MHCLO.replace(".mhclo", ".obj"))
garment = <the newly added MESH>
mhclo = Mhclo(); mhclo.load(MHCLO); mhclo.clothes = garment
ClothesService.fit_clothes_to_human(garment, basemesh, mhclo=mhclo, set_parent=True)

bpy.context.view_layer.update()      # REQUIRED — see below
```

Result: body Z [-0.027, 1.667], garment Z **[0.911, 1.430]** — hip to shoulder, correctly fitted, and
the render shows a clean teal scrub top on a smooth body with no shell to cull.

`mask_helpers=True` is the DEFAULT on `create_human`. The station gets helpers only because it bypasses
this call entirely.

### `view_layer.update()` is not optional, and skipping it fabricates a bug

Measuring garment bounds straight after `fit_clothes_to_human` returned Z **[-0.162, 0.092]** — the
garment apparently at the feet, below ground. I diagnosed a unit-scale mismatch between MakeHuman
decimetres and Blender metres and started writing the fix.

**That diagnosis was wrong.** Both objects had identity transforms; the depsgraph simply had not
updated. One `bpy.context.view_layer.update()` and the same fit measures [0.911, 1.430]. A stale
depsgraph read looks exactly like a scale bug, and the scale bug is the more interesting story, which
is why it is the one you will reach for.

`set_parent=True` did NOT parent the garment (`garment.parent` is None afterwards). It does not need
to for the fit to be correct, but do not rely on parenting to carry a transform.

### What is left to move the station — and why it is NOT a one-line change

`--create-human` is wired into `fit_stage.py` and is OPT-IN, deliberately. Run it and the body is
correct: smooth, grounded, no shell, and the grade PNG finally shows a real basemesh.

**But the garment lands ~1.2 m off the body**, measured. The stage has an Anny stature-align step
(`align_body_to_reference`) that re-scales the body from native decimetres and re-parents the garment
through `matrix_parent_inverse`. `create_human` arrives ALREADY scaled and grounded, so that align
runs a second time on an already-correct body and the garment's captured world matrix no longer
matches.

So the remaining work is the align step, not the body call. Either skip the align when
`--create-human` is set (the body is already at stature), or re-fit the garment after aligning rather
than carrying it through the parent dance.

**RESOLVED 2026-08-25 — the default IS now `create_human`.** The displacement was never the align:
A/B-ing the align out left the garment bounds byte-identical. Blender's OBJ importer applies its
Y-up -> Z-up conversion as an OBJECT ROTATION, `fit_clothes_to_human` writes garment verts in
mesh-local space to match the Z-up basemesh, and the garment's leftover importer rotation tips them
back to Y-up. One line after the fit — `garment.matrix_world = mh.matrix_world.copy()` — fixes it.

Measured A/B on the station:

| path | source | vgroups | stature | garment Z |
|---|---|---:|---:|---|
| default | `create_human` | 152 | 1.695 m | 0.911 -> 1.430 |
| `--legacy-base-obj` | raw `base.obj` | 0 | 16.946 m | — |


## THE CANONICAL PROCESS (operator, 2026-08-25) — and where the stage still deviates

> 1. describe the person
> 2. generate the anny phenotype
> 3. build a make human that looks like the anny model (same body structure)
> 4. stop using the anny phenotype — no longer needed (keep as a hidden asset to pair for future
>    reference if ever needed) solely use the make human afterwards
> 5. clothe the make human appropriately
> 6. whatever next for the make human asset

Anny is a REFERENCE that produces an MPFB match and is then **out of the picture**. It is not a
runtime rail and it is not present downstream of step 3.

### Step 3 is not implemented yet, and the stage fakes it

`create_human()` is currently called with **no `macro_detail_dict`**, so the body is MPFB's DEFAULT
human, not one matched to an Anny phenotype. The stage then runs `align_body_to_reference`, which
imports Anny at FIT time and uniform-scales the body to Anny's stature.

That is a scale-only approximation of "same body structure", and it puts Anny at step 5 where the
process says it should already be gone.

`create_human(macro_detail_dict=...)` is the documented parameter for step 3 —
`PROTO_CURIOUS_RESEARCHER` names it explicitly as the call that was hand-rolled around. Implementing
it makes the Anny stature-align unnecessary and moves Anny back to step 3 where it belongs.

### Do NOT hand-roll the macro derivation — four proven pieces already exist

| what | where |
|---|---|
| authored phenotype -> MPFB macro dict (age, bmi, build, gender_presentation) | `body_param_stage.py:1870` `derive_macro_dict_from_authored_phenotype` |
| stature -> height macro, via create/bake/strip/export/measure, refuses out-of-band targets | `body_param_stage.py:2033` `solve_height_macro_from_stature` |
| tracked-Anny-reference path: measure OBJ -> macro seed -> solve height -> `create_human(macro_detail_dict=...)` | `materialize_mpfb_humanoid_candidate.py:1879` |
| Anny/MPFB landmark comparator (INSPECTOR, not an inverse solver) | `anny-reference-mpfb-match.ts` |

### ORDER IS LOAD-BEARING: bake, or the macros do nothing

Macros must be baked with `TargetService.bake_targets` IMMEDIATELY after `create_human`. Without it
the glTF basis is the default human and the macros ride along as zero-weight morph targets — measured:
five macro sets exported byte-identical bases, and baking made exported stature differ 1.00-2.37 m
across the height macro. **The fit station's `create_human` call does not bake**, so macros added
there today would silently do nothing. The call site carries this warning.

### Even the proven path is only a PARTIAL step 3

`derive_macro_dict` sets `gender: 0.5, age: 0.5` and solves stature. Muscle, weight, proportions, cup
size, firmness and race stay at MPFB defaults. It MEASURES `chestSpanMeters` and `waistSpanMeters`
(`materialize_mpfb_humanoid_candidate.py:1926-1927`) and then **does not consume them**.

So "same body structure" is not achieved by wiring the existing derivation — it gets age and stature.
MADR 0052 explicitly rejects a hand-written coupled macro Jacobian for girths and prescribes
one-dimensional fitting against MPFB's shipped `measure-*` targets for bust/chest, waist and hips
after macro-driven stature and build.

### The architecturally correct fix

This station should not build a phenotype body at all. Under the operator's process the materializer
owns steps 1-4 and this station owns step 5, so it should take an ALREADY-MATERIALIZED MPFB body.
That also deletes the fit-time Anny import which currently violates step 4.

## claimScope / notEvidenceFor

- **claimScope:** the installed toolchain, the CLIs, the measured library-versus-worn gap, and the
  licence precedence, all as of 2026-08-25.
- **notEvidenceFor:** that any fitted garment looks right — that is a pixel grade and belongs to the
  reviewer. Nor that the hm08 station should be rewired to MPFB; that decision sits with `#652`.
