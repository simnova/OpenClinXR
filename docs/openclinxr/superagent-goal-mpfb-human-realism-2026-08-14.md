# SUPER-AGENT GOAL — make an OpenClinXR humanoid survive a skeptical look

**Written 2026-08-14 by the orchestrator, for a second agent working in parallel.**
**Status: a GOAL, not a brief. You own the decomposition.**

---

## The one-sentence goal

**Take one MPFB actor from "obviously synthetic" to "a skeptical clinician would accept it as a
person in a clinical station" — and make the path that got it there deterministic and repeatable for
every other actor.**

I have been circling this for weeks in one-to-two-hour slices and closing individual defects while
the figure as a whole stays unconvincing. It needs someone who can hold the whole vertical at once.

---

## Why I am handing this over specifically

An honest account of my own failure mode, because it tells you where the value is.

A peer review of my last twelve slices said it plainly: *"Your process is drifting into a measurement
lab that protects the factory instead of extending it… Instruments should thin out as generators
improve; yours are thickening."* It also named my avoidance pattern — I select work that has a
**pre-written failing test and a known file:line**, which optimises for *dispatchable certainty*
rather than *factory capability*.

Appearance work has neither. So I keep landing adjacent, provable things and the figure stays wrong.

**In a single day I built five separate measuring instruments for this problem and four measured the
wrong quantity.** Three for the hairline (all geometric — see §3, they could not possibly have seen
it), two for the eyelid. That is not bad luck; it is what happens when you attack a *visual* problem
with *scalar* gates one at a time.

---

## What is actually there today — MEASURED, not assumed

Everything in this section I measured on the shipped bytes on 2026-08-14. Numbers are real. Trust the
numbers; **re-measure before trusting any inference I draw from them** (§5 lists my known-bad ones).

### The three shipped MPFB actors

`apps/ui-xr/public/generated-humanoids/mpfb-{ob-patient-aisha,peds-nurse-kevin,peds-patient-child}.glb`

| | child | aisha | kevin |
|---|---|---|---|
| skin verts / tris | 9,990 / 17,378 | 9,694 / 16,960 | 9,606 / 16,674 |
| height | 1,229 mm | 1,646 mm | 1,743 mm |
| shoulder span | 766 mm | 993 mm | 1,106 mm |
| abdominal depth @60% h | 243 mm | **226 mm** | 381 mm |
| FACS morph targets | 32 | 32 | 32 |
| skin baseColor | `*.skin-baked` 1024² | same | same |
| skin normal map | `*.skin-normal` 1024² | same | same |

Bodies **do** vary with phenotype — stature and build reach vertices on this rail. (An older claim
that "every adult is one body" is about the *Anny* rail, not this one. Do not inherit it.)

### Every primitive on one actor (kevin), with triangle counts

```
mat_makeclothes_library_cargo_pants.001                    2,628   flat colour, no texture
mat_makeclothes_library_footwear_culturalibre_male_boots  30,768   texture "boot" 1024²
mat_makeclothes_library_scrub_shirt                        9,384   flat colour, no texture
mpfb_skin_peds_nurse_kevin                                16,674   skin-baked 1024²
openclinxr_mesh_native_scalp_hair_surface                  2,792   flat near-black, NO texture
openclinxr_hidden_upper_..._body_mesh                      2,634   alphaMode=MASK, alpha=0
openclinxr_hidden_lower_..._body_mesh                        382   alphaMode=MASK, alpha=0
openclinxr_hidden_foot_..._body_mesh                       3,612   alphaMode=MASK, alpha=0
mat_makeclothes_library_eyes_peds_nurse_kevin                172   texture "blue_eye" 1024²
```

---

## The named defects, in the order a viewer notices them

### 1. The hair is a flat black shell with a torn edge

`openclinxr_mesh_native_scalp_hair_surface` — 2,792 tris (kevin), 2,536 (aisha), `baseColorFactor`
≈ `[0.04, 0.03, 0.02, 1.0]`, **no texture, no transparency, no strands**. It is a solid dark cap
sitting on the scalp, and its boundary against the forehead is visibly ragged.

**This is the single most damaging defect.** It is the first thing the eye goes to and it reads as
"video game model from 2004" instantly, before any viewer notices anything else is right.

**Why my three instruments all failed:** every one measured *the skin mesh*. The hair is a
**separate primitive**. A structure-pass render shows one continuous dome because both surfaces draw
together — so the hairline is not a rim on the body at all, it is the silhouette edge of another
object. Any instrument that reads the body's geometry is blind to it by construction.

### 2. The body-hide masks do not match the garments they hide behind

`openclinxr_hidden_lower_*` is **382 triangles** on kevin while his cargo pants are **2,628**. The
mask is supposed to suppress the body under clothing; a 382-triangle mask cannot cover what a
2,628-triangle garment covers. Related open item: kevin's trouser leg and boot overlap by **279 mm**
with the layer order flipping around the leg (31 of 36 angular buckets shared, pants outside in 5,
boot outside in 25) — a row of teal teeth against brown leather. That specific instance is already
dispatched as issue #378; **the general mask/garment correspondence is not**.

### 3. Garment rims read as sawtooth

The cover-shell builder cuts faces by **centroid** between two height planes, which produces an
alternating tooth/valley rim at both the waistband and the ankle. Two slices measured a genuine
improvement in high-frequency residual (waistband p95 18.96 → ~2 mm class) and the pixels **still**
read ragged. That gap between "the scalar improved" and "it still looks torn" is the whole lesson of
this handover: I bounded a quantity and the defect lives in the shape.

### 4. Skin reads as matte plastic

A `skin-normal` 1024² texture exists and is wired. There is an open claim that the real gap is a
missing normal map — **that claim is at least imprecise, since the map is present**; what is missing
may be its content, its strength, or roughness/specular authoring. Re-measure before acting.

### 5. Faces cannot be graded reliably

The capture path writes frames with no face in them and cannot report whether its reframe succeeded
(just split out as issue #380). Every face grade I have made today was hand-rolled: crop a PNG in
Python, guess a head box, upscale. **Twice today my own upscaling manufactured "blocky" artifacts
that were not in the asset.** If you improve nothing else, a trustworthy "render this actor's face
at high resolution and tell me what is wrong with it" path pays for itself immediately.

### 6. A lead, NOT a finding — the obstetric patient may not be pregnant

Aisha is the OB station's patient. Her abdominal depth at 60% of stature measures **226 mm** against
kevin's **381 mm**. That is a crude band proxy at a height that may not be the abdomen, and I am
explicitly **not** filing it as a defect. But if the case says "third trimester" and the mesh says
otherwise, that is a blueprint-to-runtime failure of exactly the kind this project exists to prevent.
Worth ten minutes with a real measurement.

---

## Premises of mine you should re-measure rather than inherit

I withdrew **six** of my own claims in one day, every one caught by measuring rather than by thinking
harder. Assume anything below the measured tables is suspect:

- I claimed the eye morph L/R names were swapped. **They are not** — character-left is `+X` here,
  verified against `.L`/`.R` skeleton bone positions. I had assumed `−X`.
- I claimed the baked skin atlas had blocky region boundaries. That was **my own NEAREST downscale**.
- I claimed a blocky hairline and neckline in the render. Partly **my own 5× upscale**. The ragged
  hair edge is real; its "stair-step" character was partly manufactured by my crop.
- I filed a station as rendering no actors from one thumbnail in a contact sheet. All three actors
  were present at 32k–39k triangles each. **A thumbnail cannot support a negative claim.**

---

## Hard constraints — these are not negotiable and they have bitten before

- **Licences: CC0 or CC-BY only. "Unspecified" is a refusal, not a maybe.** No AGPL or copyleft
  anywhere in the pipeline. Record every acquisition — cleared *or* refused — in
  `docs/openclinxr/third-party-asset-licence-ledger.md` so nobody re-litigates it.
- **No cloud services, no paid APIs, no accounts.** Self-hosted, single machine (Apple Silicon
  M1 Max, 64 GB, **no CUDA**). Several otherwise-good tools are unusable for this reason alone.
- **No LLM in the production path.** The target is a "dark factory": a case definition goes in, a
  full playable encounter comes out, with no model in the loop. An LLM writing bespoke Blender
  geometry per actor is the *anti-pattern* — the next case would need it written again. Runtime
  dialogue generation is the one sanctioned exception.
- **Wire proven tools; do not hand-author.** MPFB2, MakeClothes/MakeHuman wardrobe, Blender are
  present and working. Prefer consuming a library that exists over authoring geometry in Python.
- **Execution duration is explicitly not a constraint.** A multi-hour bake is fine. Do not trade
  determinism for speed.
- **No triangle-count gates.** `meshoptimizer` runs later in the pipeline. Do not reject a good
  asset for being heavy; 57,600 triangles of shoe is not a defect at this stage.
- **Two agents share this repository.** Work in a git worktree, commit only files in your own scope,
  and never run a whole-tree revert — `git checkout -- .` in the shared checkout destroyed 40 files
  of another agent's uncommitted work today. Recoverable only because a patch snapshot existed.

---

## What "done" looks like

Not "the contracts are green". Contracts have been green on figures that were topless, head-down, or
rendering three identical nurses.

1. **A graded image.** A high-resolution render of one MPFB actor — full body and face — that a
   skeptical viewer accepts as a person. That judgement is a human's or the orchestrator's; a byte
   floor on a PNG proves a renderer ran and nothing more.
2. **The same treatment applied to the other two actors**, reproducing without per-actor hand-work.
   One actor fixed by hand is a demo; three fixed by one deterministic path is a factory.
3. **A gate that would have caught each defect**, written *after* the fix, measuring the thing that
   was actually wrong. Prefer one instrument that sees shape over five that each bound a scalar.
4. **Every acquisition recorded** in the licence ledger, cleared or refused.

---

## Where to start reading

| what | where |
|---|---|
| the assets | `apps/ui-xr/public/generated-humanoids/mpfb-*.glb` |
| the materializer that builds them | `tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py` |
| grading capture | `pnpm asset:model-vetting:glb-grade --glb <path>` (writes lit + structure passes) |
| the rail split (MPFB vs Anny, by job) | `docs/madr/0044-*`, `docs/madr/0052-mpfb-graduation-plan.md` |
| licence ledger | `docs/openclinxr/third-party-asset-licence-ledger.md` |
| open appearance items | issues #341 (make one actor clean), #338 (occlusion gate), #369 (skin), #378 (boot/trouser), #380 (capture reframe) |

Issue **#341** is the closest existing statement of this goal and has been open a long time. Treat it
as a starting point, not a specification — it predates most of the measurements above.

---

## The one thing I would ask for above all others

**Fix the hair.** It is 2,792 triangles of flat black with a torn edge, it is the first thing anyone
sees, and there is no instrument in this repository that can currently see it. Everything else on
this page is a refinement; that one is the difference between a mannequin and a person.
