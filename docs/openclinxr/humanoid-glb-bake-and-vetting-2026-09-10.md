# Baking and vetting a humanoid GLB through isolated factory steps

**Status: PLAN. Nothing here is built.** Written 2026-09-10 after grading the published still
`docs/assets/mpfb-street-adult-clothed-2026-09-10.png` and tracing it to the code that produced it.

The operator's direction: stop validating from Blender directly. Have the isolated factory steps
produce a GLB that is already baked, then hand that GLB to a harness that validates humanoid GLBs as
artifacts. Reuse the TRELLIS post-optimisation work (bake, albedo, decimate) rather than inventing a
second pipeline.

---

## 1. The measurement that changes the design

**The green cast is in the material, not in the lighting.** Measured from
`apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb`:

| material | has baseColorTexture | baseColorFactor |
|---|---|---|
| `mat_makeclothes_library_classic_jeans_pants` | yes | `[0.34, 0.44, 0.34]` |
| `mat_makeclothes_library_toigo_t_shirt` | yes | `[0.34, 0.44, 0.34]` |
| `openclinxr_fitted_hair_mhair02_…` | no | `[0.13, 0.09, 0.07]` |
| `openclinxr_fitted_eyebrow_mindfront_eyebrows_08_…` | no | `[0.05, 0.03, 0.02]` |
| `openclinxr_fitted_eyelash_mindfront_eyelashes_01_…` | no | `[0.02, 0.02, 0.02]` |
| `mat_openclinxr_hm08_teeth_…` | no | `[0.92, 0.90, 0.86]` |
| `mat_openclinxr_hm08_tongue_…` | no | `[0.85, 0.45, 0.45]` |
| seven `openclinxr_hidden_*` cover shells | no | `[0, 0, 0]` |

`[0.34, 0.44, 0.34]` is a desaturated green, and glTF multiplies it against the base colour texture.
Denim through that factor renders teal; a pale tee renders sage. Both garments carry the **identical**
factor, which is the signature of a default applied by a station rather than a wardrobe decision.

> **Corrected 2026-09-11 by HB-00 (landed 3c2f2fbf).** The inference above was wrong. `[0.34, 0.44, 0.34]` is a deliberate palette entry, `"closed_casual"` at `tools/openclinxr/asset-pipeline/anny/automate_blender.py:1764`, commented as the muted olive-green the street and OB patients wear, selected by the case `fabricPalette` token and written through `GARMENT_FACTOR_PATCH`. The identical factor on two garments is one palette row applied to two garment kinds. The bake may proceed on it; whether olive on a pale tee is the wanted look is a wardrobe question. The street jeans no longer carry a factor (e59925fc). Full table: `docs/openclinxr/humanoid-basecolorfactor-audit-2026-09-10.json`.

**This is why the bake cannot go first.** A bake folds `baseColorFactor x baseColorTexture` into one
texture. Baking before those factors are justified writes the tint in permanently and no later
lighting change recovers it. An earlier draft of this analysis blamed the lamps for the cast; that was
wrong, and building the bake on it would have burned the defect into the asset.

### Current state of one shipped humanoid

- 114,434 triangles, 23.74 MB, 17 materials, 6 images, 6 textures
- `extensionsUsed: null` — no meshopt, no Draco, no KHR_texture_basisu. Nothing is optimised.
- `KHR_lights_punctual` absent. Nothing is baked. The published still is a Blender render OF the GLB,
  not lighting carried BY the GLB.

---

## 2. What the published still actually shows

Graded at native 1280x1280, measured rather than eyeballed:

| observation | measurement |
|---|---|
| ground plane in frame | horizon at y=931, occupying the lower ~27% |
| figure floats above it | lowest boot pixel y=773, gap **158 px = 12.3% of frame height** |
| subject size | 773 px tall, 60% of frame |
| directional key | floor hotspot lower-left fading right; vertical gradient on the backdrop |
| garment gradient | jeans dark at hip washing to pale cyan at ankle |

### Where each comes from in the code

`tools/openclinxr/asset-pipeline/makeclothes/finished_figure_grade.py`

- **line 216** `bpy.ops.mesh.primitive_plane_add(size=max(4.0, width * 3), location=(center.x,
  center.y, bmin.z - 0.001))` with the comment *"Ground plane under feet for readability"* and a
  `(0.18, 0.22, 0.2)` Principled material. The tool is named "isolated figure grade" and it builds a
  room. The GLB contains no floor; the grader adds one.
- **the float** the plane sits 1 mm under `bmin.z`, so it should be flush with the lowest vertex. It
  is 158 px away, which means `bmin.z` is not the boot sole. Something else — a stray vertex, a
  helper the strip missed, or an unparented shell — is the lowest mesh point. **This is a wrong
  number, not a taste question, and it is the cheapest thing to fix first.**
- **the lighting ratio** `grade-lighting.json` sets `worldBackgroundStrength: 0.55`,
  `worldBackgroundColor: [0.82, 0.85, 0.9]`, `keyEnergy: 160`, `fillEnergy: 110`. Two AREA lamps at
  160 W and 110 W bury a 0.55 background. The key is off-axis at `(center.x + 1.0, -1.4, key_z)`.
- **`choose_grade_engine()`** falls back to `BLENDER_WORKBENCH` when EEVEE is unavailable. Workbench
  **ignores Principled Base Color**. A silent fallback therefore produces a grey-on-grey image that
  looks like a material bug and is not one. Any replacement must record which engine actually ran.

### The gate that passes on this image

`tools/openclinxr/evidence/the-isolated-grade-bake-has-ambient-world-light.test.ts` — **4 of 4
passing right now**, against the image above. Its clauses:

1. a JSON field is `> 0`
2. four regex matches over the Python source (`grade-lighting.json`, `apply_grade_lighting`,
   `worldBackgroundStrength`, `BACKGROUND`)
3. a Blender dump reports background strength `> 0`
4. the PNG's **corner** luma is not black

Clause 2 certifies that the code *mentions* ambient lighting, not that the render has any. Clause 4
samples corners, which is exactly where the world background shows and exactly where the key light's
failure does not. This is the "green gate, broken pixels" pattern this repository has recorded
before, shipped again.

Its commit, `088696d0`, also carries: *"Worktree skip: assets:reachability cannot resolve
@openclinxr/scenario-fixtures until packages are built; main hook will run on cherry-pick."* The one
gate that inspects published assets was deferred.

---

## 3. What already exists and must be reused

**`tools/openclinxr/evidence/model-vetting-glb-grade-capture.ts`** is the humanoid-GLB harness the
operator is describing, and it already exists. It takes `--glb`, runs dual lit and structure passes,
probes the mesh AABB through `@gltf-transform/core` (`probeSceneGraphMeshAabb`), self-checks with
`DEFAULT_RELATIVE_TOLERANCE = 0.15`, drives chromium through playwright, and emits a
`ModelVettingReport`. **It consumes the artifact and never opens the factory's Blender scene** —
which is the property the operator asked for and the property `finished_figure_grade.py` lacks.

**`tools/openclinxr/asset-pipeline/trellis/vr-postopt-ladder.ts`** is the decimation step. It is a
meshopt ladder run after a multi-view TRELLIS bake, emits a `featureSurvival` verdict per rung,
explicitly performs **no GPU re-bake**, and *"prefers denser rungs under preferred (anti-hyperopt)"* —
it picks the densest rung inside budget rather than the smallest, which is the correct default for a
humanoid where silhouette and face survive or the asset is worthless. Its own note says the chain
often lands near 59k triangles.

**`tools/openclinxr/asset-pipeline/trellis/bake-resolution-ladder.json`** plus the `bake-probe`
directory hold the already-swept bake resolutions. The bake step takes its resolution from this
ladder rather than a fresh invented number.

**`packages/openclinxr/factory-stations/src/`** holds the isolated steps the operator wants to
compose: `body_param`, `clothing_generate`, `clothing_consume`, `lighting_design`, `motion_retarget`,
`equipment_generate`, `room_generate`, with `runner.ts` and `catalog.ts` as the composition surface.
Note `lighting_design` already exists as a station concept.

---

## 4. The proposed pipeline: four isolated steps

Each runs standalone, takes a GLB in and emits a GLB plus a report, and can be probed on its own.

### Step 1 — resolve materials (run this FIRST, before anything is baked)

Emit a per-material table for every shipped humanoid: name, `baseColorFactor`, whether a
`baseColorTexture` exists, and the recorded source of the factor.

**Refusal rule:** a `baseColorFactor` that is not `[1,1,1]`, on a material that also has a texture,
and with no recorded reason, is a refusal. It is either a wardrobe decision someone can name or a bug.

This step is cheap, needs no bake, and its output decides whether step 2 bakes the current look or a
corrected one. **Getting this backwards is the expensive mistake in this whole plan.**

Open question it answers: is `[0.34, 0.44, 0.34]` deliberate, and if so, who decided and where is it
written down? It appears identically on two unrelated garments, which suggests neither.

### Step 2 — bake albedo

Fold `baseColorFactor x baseColorTexture` into a single baked albedo per material. Resolution comes
from `bake-resolution-ladder.json`. Runs only on materials step 1 cleared.

The seven `hidden_*` cover shells at `[0, 0, 0]` need a decision before this step: bake them black,
or remove them. Baking a black shell into a texture atlas wastes texels on geometry that exists to be
invisible.

### Step 3 — decimate and pack

`vr-postopt-ladder.ts` unchanged. Record the chosen rung, its triangle count, its byte size and its
`featureSurvival` verdict into the report. Start from the measured 114,434 triangles / 23.74 MB.

### Step 4 — write the notice

The `asset.copyright` writer landed 2026-09-10
(`tools/openclinxr/evidence/licence/write-shipped-licence-notice.ts`) runs **last**, because every
earlier step rewrites the container and would drop the field. It also re-records the provenance
sidecar's `outputSha256`/`outputBytes`, which every step above invalidates.

---

## 5. The replacement gate

Asserted against the GLB and the harness report, never against the Python source.

1. every `baseColorFactor` is `[1,1,1]` after bake, or carries a recorded reason — **this clause
   fails on the green today**
2. triangle count and byte size land on a named ladder rung, and the rung id is in the report
3. structure pass shows the subject alone: no ground-plane mesh in the scene graph, no lamp nodes,
   `film_transparent` on
4. lit pass luma is sampled **on the subject**, not in the corners
5. feet touch the harness's own reference plane, measured from the boot sole rather than `bmin.z` —
   **this clause fails on the 158 px float today**
6. the engine that rendered is recorded, and a `BLENDER_WORKBENCH` fallback fails rather than
   silently producing grey-on-grey

Every clause gets the two-sided probe: revert the step it guards, rebuild the affected package
(cross-package tests resolve to `dist/`), prove the clause fails, restore, prove it passes.

**Retire** `the-isolated-grade-bake-has-ambient-world-light.test.ts` only by superseding it with an
inverted guard that records why its four clauses were vacuous. Do not delete it silently.

---

## 6. Order of work

1. Step 1's measurement across **all 19** shipped bodies, so the factor spread is known rather than
   inferred from one body.
2. The 158 px float — it is a wrong number and the cheapest real fix.
3. Steps 2 and 3.
4. The gate, clause by clause, each with its two-sided probe.
5. Step 4 and a republish.

## 7. Board cards

Created 2026-09-10 on project `prj_9b390b99b443a964`, all Idle/backlog. None is planted; the operator
kicks the work off separately.

| card | id | step | covers |
|---|---|---|---|
| HB-00 | `tsk_e06833531ca0e4c2` | clothing_consume | resolve every `baseColorFactor` before any bake |
| HB-01 | `tsk_8adc4d7903c58058` | body_param | the 158 px float: why `bmin.z` is not the boot sole |
| HB-02 | `tsk_711b13b07fd6fc1d` | clothing_consume | bake albedo on the TRELLIS resolution ladder |
| HB-03 | `tsk_40c35f576d608198` | body_param | decimate and pack through `vr-postopt-ladder.ts` |
| HB-04 | `tsk_0fdd54b19735ac74` | instrument | vet the GLB as an artifact; retire the vacuous gate (v2: test moved under `tools/openclinxr/evidence/humanoid-vetting/`; v1 `tsk_f145101c2328788f` cancelled) |

Each carries its `doneWhen` and its dependency edges, so each is plantable as it stands.

**A first cut of these cards was cancelled and recreated.** `tsk_dfed02961d0a11a4`,
`tsk_35e7425a6f351cc8`, `tsk_440e3c189e5d4ba5`, `tsk_bf7639c1566c0ba4` and `tsk_c5e8b6b57463b8ae`
were created without `doneWhen`. That field is **create-only** on this board — `tasks.update` accepts
the call, returns success, and silently leaves `doneWhen: []` — so those cards could never be
planted. They are cancelled rather than edited. Check create-only constraints before the create call.

**Proof shapes, and why none of them is `changed:`.** HB-00's honest outcome may be "the factor is a
bug, here is its origin, I changed no asset", and HB-03's may be "nothing survives inside budget".
A `changed:` rule compels an edit and would forbid both, so every card uses `run:` plus `exists:` on
its measurement artifact — shapes a report can satisfy.

**HB-00 gates HB-02.** Everything else can be sequenced freely, though HB-04's clauses only go green
once HB-01 through HB-03 have landed. HB-01 is independent of the bake chain and is the cheapest
real fix, so it is a good first dispatch alongside HB-00.

## 8. What this plan does not claim

No clinical, headset or exam-equivalence claim. The harness grades geometry, materials and framing;
it does not establish that a humanoid is clinically appropriate. Public render rights are governed
separately by the licence ledger, and the cargo-pants question remains open at the time of writing.
