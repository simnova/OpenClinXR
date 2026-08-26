---
name: trellis-baking
description: "Bake a 3D asset from a conditioning image through TRELLIS on this machine. Load BEFORE running any bake, choosing sampler parameters, or diagnosing a bad TRELLIS output - carries the measured 15-knob parameter surface, which knobs the repo can and cannot set, the stage-to-defect mapping, and the cost of a variant."
---

# TRELLIS baking

The parameter surface below was measured 2026-08-25 on this machine.

Read from the installed pipeline and the shipped weights config, not from documentation.

- Pipeline: `~/.openclinxr-tools/trellis2-apple/src/trellis2/pipelines/trellis2_image_to_3d.py`
- Defaults: `~/ComfyUI/models/trellis2/pipeline.json`
- Repo wrapper: `tools/openclinxr/evidence/blender/run_bake_isolated.py`, driven by
  `tools/openclinxr/asset-pipeline/trellis/trellis-bake-cli.ts`

## The three samplers and their fifteen knobs

Every stage uses `FlowEulerGuidanceIntervalSampler` with `sigma_min = 1e-05`.

| sampler | steps | guidance_strength | guidance_rescale | guidance_interval | rescale_t |
|---|---:|---:|---:|---|---:|
| `sparse_structure_sampler` | 12 | 7.5 | 0.7 | [0.6, 1.0] | 5.0 |
| `shape_slat_sampler` | 12 | 7.5 | 0.5 | [0.6, 1.0] | 3.0 |
| `tex_slat_sampler` | 12 | 1.0 | 0.0 | [0.6, 0.9] | 3.0 |

Plus `default_pipeline_type = "1024_cascade"`.

## What the repo can currently set — and what it cannot

`run_bake_isolated.py` exposes: `--seed`, `--hf-demo`, `--remesh` / `--no-remesh`,
`--decimation-target` (default 300000), `--texture-size` (default 2048), `--input-image` (repeatable),
plus path arguments.

**None of the fifteen sampler knobs is settable.** At `:243-252` the `--hf-demo` branch reads the
pipeline's own defaults with `getattr(pipeline, ...)` and passes them straight back, so it is a no-op
by construction — it changes the call *shape*, never a value. Every bake this repo has produced ran at
the table above.

## Stage → knob mapping, for choosing what to vary

- **`sparse_structure`** builds the coarse occupancy grid. Stray occupied voxels here become
  disconnected fragments in the mesh. **This is the first place to look for the debris measured on
  #661** (76 components, largest 93.8%, and 76 components already present in the raw bake at 96.7% —
  so debris originates here, not in decimation or meshopt).
- **`shape_slat`** refines geometry within the occupied structure — surface detail and topology.
- **`tex_slat`** is texture only (`guidance_strength` 1.0, `guidance_rescale` 0.0 — effectively
  unguided) and should not affect component structure.

## Cost of a variant

Measured on the #661 bake: pipeline load 4.2 s, shape generation **409.4 s**, raw output 293,808
triangles at 15.8 MB. A sweep is affordable overnight but not inside one tick.

## claimScope / notEvidenceFor

- **claimScope:** the parameter names, default values and CLI surface as read from the installed
  source and weights config on this machine at this date.
- **notEvidenceFor:** what any knob does to output quality — nothing here has been varied yet; whether
  the mapping above is complete; behaviour of the multi-view path, which takes a different branch
  (`run_multiview`) than the single-view `pipeline.run`.

## Published tiers and what the knobs mean — researched 2026-08-25

Sources: [TRELLIS repo](https://github.com/microsoft/TRELLIS),
[TRELLIS.2 model card](https://huggingface.co/microsoft/TRELLIS.2-4B),
[Kynkäänniemi et al. 2024](https://arxiv.org/pdf/2404.07724),
[Clore.ai parameter guide](https://docs.clore.ai/guides/3d-generation/trellis-3d).

**Our defaults are the vendor's BALANCED tier, not its quality tier.** Three published configurations:

| tier | sparse_structure | slat | wall-clock (vendor's hardware) |
|---|---|---|---|
| fast preview | steps 6, cfg 7.5 | steps 6, cfg 3.0 | ~15 s |
| **balanced (what we run)** | **steps 12, cfg 7.5** | **steps 12** | — |
| quality | steps 20, cfg 9.0 | steps 20, cfg 4.5 | ~60 s |

So the first sweep point is not a guess: the vendor's own quality tier is a documented target. On this
machine that is roughly double the measured 409 s shape generation.

**`guidance_interval` is a published technique, not a tuning knob someone invented.** Our sampler is
`FlowEulerGuidanceIntervalSampler` and the interval comes from Kynkäänniemi et al.: guidance is
**harmful at high noise levels early in the chain**, unnecessary at low noise levels late, and
beneficial only in the middle. Restricting it improved ImageNet-512 FID from 1.81 to 1.40.

**Why that matters for floating fragments.** Debris is a structural error laid down early, in exactly
the high-noise region the paper says guidance hurts. Shifting or widening `guidance_interval` on the
**sparse_structure** stage is therefore a principled variant, not a blind sweep. Our current interval
there is `[0.6, 1.0]`.

**Microsoft acknowledges the artifact class.** The TRELLIS.2 documentation states generated raw meshes
"may occasionally contain small holes or minor topological discontinuities". A post-generation
component filter is expected practice, not a workaround for something we broke.

**What is NOT published anywhere I could find:** measured component counts against sampler settings.
The relationship between `sparse_structure` parameters and fragment count appears untested publicly, so
a sweep here produces a new number rather than reproducing a known result.

## Measuring a bake's output

Component structure is the metric that caught the #661 debris, and it must weld by position before
counting — an unwelded count is wrong by orders of magnitude (measured: 6605 vs 76 on one asset).

    components (welded 5dp)   largest share
    library footwear pair              4          46.9%   <- a PAIR is legitimately 2+ components
    TRELLIS shoe champion             76          93.8%
    TRELLIS shoe RAW bake             76          96.7%   <- same count; debris is from GENERATION

Sole area — fraction of triangle area whose normal is within 15° of straight down — only works on an
**axis-aligned** mesh. TRELLIS output is normalised to a 2×2×2 cube in arbitrary orientation, so the
figure is meaningless until the asset is oriented. Do not quote it on a raw champion.


## THE PIPELINE HAS NO BAKE STAGE — measured 2026-08-26, and the detail is recoverable

The optimize path is `3-iter high-error direct targets + weld + quantize`. That is meshopt
decimation and nothing else. **No normal map is ever baked**, on any asset:

| file | tris | baseColor | normal map |
|---|---:|---|---|
| raw-copy.glb | 296,226 | yes | **NO** |
| champion.glb | 79,999 | yes | **NO** |

216,227 triangles of form were deleted and nothing captured them. The surface undulation visible on
flat faces in every champion render is that loss — decimated curvature with no map carrying it.

**A high→low bake recovers it, and the high-poly is already on disk for all seven assets.** Measured
end to end on `pulse-oximeter`:

    selected_to_active NORMAL bake, 296,226-tri raw -> 79,999-tri champion, 2048^2, Cycles CPU
    cage extrusion  = objectDiagonal * 0.02   (1.334 m -> 0.0267 m)
    max_ray_distance = objectDiagonal * 0.04
    result: 42.9% of texels deviate from flat, mean |R-128|+|G-128| = 16.08, max 182,
            blue mean 247.1 (correct tangent space)

**ALWAYS measure the map before believing the bake.** `bpy.ops.object.bake` returns success while
writing a perfectly flat 128/128/255 map — that is the silent failure here, and "BAKE_STATUS baked"
does not distinguish it. The deviation statistic above is the check: a flat map scores ~0.

**Derive the cage from geometry, never pick it.** Extrusion as a fraction of the object's measured
diagonal transfers across subjects of different scale; a hardcoded millimetre value does not.

**The existing bake code does a DIFFERENT job.** `automate_blender.py:1362` bakes NORMAL with
`use_selected_to_active = False` — that is procedural bump → texture on ONE mesh. High→low transfer
needs `use_selected_to_active = True` plus the cage. Same API, different configuration; reuse the
call, not the settings.

NOT TESTED: whether the baked map survives glTF export and reads correctly in the three.js runtime.
It was rendered in Blender with the map attached. Until a GLB carries it and ui-xr loads it, this is
a promising measurement rather than a pipeline capability.

### THE SECOND ASSET BROKE MY QUALITY PROXY — deviation measures MAGNITUDE, not CORRECTNESS

Ran the identical ladder on `o2-port`, the hard case: 289,314 raw tris, 75 components, only 51.5%
in the largest. Same simplifier, same 25k rung, same 512 map.

| asset | components | largest share | map mean deviation | texels carrying detail |
|---|---:|---:|---:|---:|
| pulse-oximeter | 16 | 99.7% | 35.60 | 70.8% |
| **o2-port** | **75** | **51.5%** | **38.46** | **82.5%** |

By the statistic I had been using, o2-port's bake is the BETTER one — higher deviation, more texels
carrying detail. **It is not.** Its metal collars come back speckled with ring artifacts that appear
in neither the shipped 80k nor the unmapped 25k. The map is carrying something that is not form.

**The mechanism, INFERRED not isolated:** a `selected_to_active` bake shoots rays from the low mesh
into the high one. On a 75-component asset with 51.5% in the largest, a ray leaving one component
frequently strikes a NEIGHBOURING component rather than the surface it belongs to, and that
cross-component hit is baked in as detail. High deviation is exactly what contamination looks like.

**So retire deviation as a quality proxy.** It is a good FALSIFIER — a flat map (deviation ~0) proves
the bake did nothing — and it is useless as a quality signal, because a contaminated map and a
faithful one both score high. I used it as a quality signal for two iterations and it agreed with me
until it met an asset where it was wrong.

**The discriminator is component topology — but SHARE IS NOT IT. Corrected 2026-08-26 by the third
asset, which falsified the rule two assets had agreed with.**

    asset            components  largest  2nd largest  predicted  ACTUAL
    pulse-oximeter           16    99.7%         0.3%      clean   CLEAN
    o2-port                  75    51.5%        22.1%    contam.   CONTAMINATED
    fetal-monitor            17    93.9%         1.6%      clean   **CONTAMINATED**

`fetal-monitor` has NO component at or above 10% — by the size rule recorded further down this file
it is "fragments only" — and its bake still came back speckled on the top knobs, the buttons and the
dial. The map simultaneously FIXED the screen-recess facet the unmapped 25k shows, so the same bake
was both recovering form and inventing detail.

**What that kills:** largest-component share as the admission test. It was a two-point hypothesis and
the third point refuted it.

**What it suggests, INFERRED and untested:** the hazard is PROXIMITY, not share. A 1.6% fragment
sitting a millimetre off a knob is exactly as good a cross-hit target as a 22% one — the cage does not
care how big the wrong surface is, only that it is within `max_ray_distance`. pulse-oximeter's
fragments total 0.3% AND are the only ones measured as not co-located with a feature.

**The proximity test WAS built, on 2026-08-26, and it is VACUOUS.** Minimum distance from each
non-main component to the main one, against the cage's `objectDiagonal * 0.04`:

| asset | known verdict | fragments within reach |
|---|---|---|
| pulse-oximeter | **CLEAN** | 11 of 11 |
| o2-port | CONTAMINATED | 11 of 11 |
| fetal-monitor | CONTAMINATED | 11 of 11 |

Every asset has fragments inside the ray reach, most around 2 mm. The test flags everything, so it
separates nothing. Second failed mechanism; do not build a third from these points.

**AND SHARE IS NOT MERELY INSUFFICIENT — IT IS UNINFORMATIVE. Four assets, and the predictions made
from share were wrong in BOTH directions:**

| asset | largest | 2nd | predicted from share | ACTUAL |
|---|---:|---:|---|---|
| pulse-oximeter | 99.9% | 0.1% | clean | CLEAN |
| o2-port | 61.6% | 22.1% | contaminated | CONTAMINATED |
| fetal-monitor | 93.9% | 1.6% | clean | **CONTAMINATED** |
| iv-pump | 87.4% | **10.15%** | contaminated | **CLEAN** |

`iv-pump` has a 10.15% second component — the shape that made o2-port multi-part — and its bake came
back clean, fixing the screen's white wash with no speckle introduced. `fetal-monitor` has nothing
above 1.6% and contaminated. Two of four predictions wrong, one in each direction. A rule that fails
both ways is not a weak rule, it is the wrong variable.

**CAUSE NOT DETERMINED, and stop guessing at it.** Two mechanisms have now been proposed and killed
by measurement. What discriminates a clean bake from a contaminated one on this generator's output is
unknown, and the RENDER IS THE ONLY ORACLE. Bake, look at the pixels, record the verdict. Do not
gate on component statistics — they cost a firing each and have predicted nothing.

For the second class the cage needs per-component isolation, or the bake needs to be done
per-component, or the asset is simply not a bake candidate. NOT DETERMINED which; I did not test a
remedy.

Bytes on o2-port are still favourable (25k+512 map = 12,522,816 B, 9.1% under its shipped 80k), which
is the trap: **the economics look identical for a good bake and a contaminated one.** Judge the
pixels, not the byte count and not the deviation.

### THE DECIMATION FLOOR IS ~19.5k AND THE MAP DOES NOT REACH IT

Drove the repo's own simplifier (`simplify` + `MeshoptSimplifier`, `FORCE_ERROR = 1.0`, the same
constants `iterate-optimize.ts` uses) below the ladder's 25k stretch rung:

    target 15,000 -> actual 19,562
    target 10,000 -> actual 19,590
    target  5,000 -> actual 19,552
    target  2,500 -> actual 19,576

**Meshopt plateaus at ~19,560 triangles for this asset whatever you ask for.** The ladder never
asked below 25k so the floor was never visible. Anyone reading `stretch25k` as "the smallest rung"
should know the mesh will not go meaningfully below it. Cause NOT DETERMINED — UV-seam pinning is
the leading candidate (single material, tightly packed islands: this subject measured only 4.3%
filler), but I did not isolate it.

**And the map stops helping there.** Bytes look attractive — floor+512map is 8,344,484 B, 16.0%
under the shipped 80k — but the render does not hold: the body carries hard facets and the lip
deforms, mapped and unmapped alike.

**That is the general limit of the technique, measured on our own asset: A NORMAL MAP FIXES SHADING,
NOT SILHOUETTE.** Down to 25k the loss is surface form and the map recovers it. At 19.5k the loss
has moved into the outline, and no amount of normal detail restores an edge that is no longer there.

So the usable band is bounded on BOTH sides and neither bound is arbitrary:

    80k   what ships, no map
    25k   deepest rung where the map still carries it   <- the win, 12.6% smaller than shipped
    19.5k simplifier floor; silhouette gone; map cannot help

Take the ladder to 25k, not to the floor. When judging a decimated asset, look at the OUTLINE
first — if the silhouette has gone faceted, stop decimating; a bake will not buy it back.

### THE MAP CROSSES THE glTF BOUNDARY AND three.js READS IT — measured 2026-08-26

Exported the mapped low-poly and re-read it with the runtime's own loader:

| | tris | normalTexture | TANGENT attr | bytes |
|---|---:|---|---|---:|
| champion (ships) | 79,999 | no | **NO** | 9,928,748 |
| champion-mapped | 79,998 | **yes**, 3.8 MB PNG | **yes** | 15,393,216 |

The `TANGENT` attribute is not optional — a tangent-space map without it is undefined in three.js.
Blender emits it only with `export_tangents=True`. The `glb-grade` three.js pass renders the seam,
hinge and lip that the unmapped asset loses, so the runtime consumes it.

One triangle is lost in the Blender round-trip (79,999 -> 79,998). Harmless here, worth knowing
before any contract asserts an exact count across a bake.

### MAP RESOLUTION IS THE WHOLE ECONOMIC ARGUMENT — 2048 is oversized

At 2048 the bake COSTS MORE THAN THE TRIANGLES IT SAVES. 25k+map is +27% on bytes against the
shipped 80k, despite 11.8x fewer triangles. Re-baking the same subject at lower resolution:

| map res | map bytes | GLB bytes | vs shipped 80k | map mean deviation |
|---:|---:|---:|---:|---:|
| 2048 | 4,375,657 | 12,605,040 | **+27.0%** | 35.60 |
| 1024 | 1,476,335 | 9,705,712 | **-2.2%** | 37.81 |
| 512 | 453,044 | 8,682,420 | **-12.6%** | 37.82 |

**Deviation does NOT fall as resolution falls** (35.60 -> 37.81 -> 37.82). The captured detail is
low-frequency form, not fine texture, so it survives a quarter of the texels. That is the load-
bearing measurement: without it, "use a smaller map" would be a guess about quality.

**So the shippable configuration is 25k + a 512 map at 8.68 MB — 12.6% SMALLER than the 80k that
ships today, with 55,000 fewer triangles.** Both budgets improve at once, which is why resolution
had to be swept before the technique was judged.

ALWAYS sweep map resolution before reporting the byte cost of a bake. The first number I produced
said the technique was uneconomic, and it was measuring an arbitrary 2048 default.

NOT TESTED: KTX2/Basis, which would cut the map again; whether 512 holds on an asset with genuine
fine texture (this subject's detail is form); any asset but pulse-oximeter; any camera but az35/el35.

### The bake buys a LOWER BUDGET, not just a better 80k

Baked the same 296,226-tri raw onto three rungs and rendered all of them at one camera with one
lamp rig, changing only the mesh and the map:

| rung | map mean deviation | texels carrying detail |
|---|---:|---:|
| 80k | 16.08 | 42.9% |
| 40k | 26.21 | 60.2% |
| 25k | 35.60 | 70.8% |

**The map absorbs exactly the work the mesh drops, and the statistic says so.** Deviation rising as
triangles fall is the expected signature — if it stayed flat while triangles fell, the transfer
would not be happening and the bake would be decorative.

40k with NO map is visibly broken at this camera: the screen bezel collapses into the body and the
display face distorts. The SAME 40k with the map holds its bezel and lip. So the interesting number
is not "80k looks better with a map" — it is that **a budget which is unusable bare becomes usable
mapped**, at 7.4x fewer triangles than raw and half the shipped champion.

**Consequence for the ladder:** `iteration-report.json`'s rungs are currently chosen on geometry
alone, so `preferred80k` is the quality floor. With a bake stage the floor moves and the rung names
stop meaning what they meant. Re-derive the band before adopting a lower default; do not simply
retarget 40k because this one asset held.

NOT TESTED on this ladder: any asset but `pulse-oximeter`, and any camera but az35/el35. One subject
at one angle is where a decimation claim goes wrong — `o2-port` has 51.5% of its mesh outside the
largest component and may behave nothing like this.

## Post-bake cleanup — measured 2026-08-25, graded A/B

**Multi-component output is the NORM for this generator, not a defect.** Every shipped TRELLIS asset is
multi-component. Do not treat component count as a quality signal:

| asset | components | largest share | outside-hull fragments |
|---|---:|---:|---:|
| digital-thermometer | 3 | 69.0% | 0 |
| fetal-monitor | 17 | 91.4% | 0 |
| glucometer | 6 | 84.7% | 0 |
| iv-pump | 25 | 86.5% | 0 |
| lowpoly-shoe | 76 | 94.1% | **47** |
| o2-port | 75 | **51.5%** | 0 |
| pulse-oximeter | 16 | 99.7% | 0 |

Position-welded union-find over the largest primitive. Outside-hull fragments occur on ONE asset.

### WELD BEFORE YOU SEPARATE — this is the trap

Blender's glTF importer leaves UV-seam vertices unmerged. `separate by loose parts` on a raw import
splits at **texture islands**, not at real components: thousands of pieces, largest 5,535 tris on an
asset whose true largest component is 75,288. Run `bmesh.ops.remove_doubles` (or Mesh > Merge by
Distance) FIRST; only then does loose-parts agree with a position-welded component analysis.

Any cleanup written against the unwelded population operates on the wrong set entirely and will look
like it worked.

### Counting components correctly

Weld by position before the union-find. An unwelded count is wrong by orders of magnitude — a Python
pass once reported 6,605 components / 58.3% largest where the welded answer was 76 / 94.1%.

### keep-largest: verify per asset, never as a pipeline rule

On `lowpoly-shoe` it is correct — A/B rendered at two cameras with all components vs main only, the
shoe is pixel-identical and only floating debris vanishes. The 4,710 discarded triangles are duplicate
lace bars sitting 0.3–2 mm off a surface that already has complete laces, plus outside-hull specks.

**It is not a factory rule.** `o2-port` ships with its largest component at 51.5%, so keep-largest
there discards nearly half the mesh. Every asset needs its own A/B before the rule is applied.

**Do not filter by fragment SIZE.** On the shoe, dropping components under 200 triangles plateaus at
96.0% and leaves the large duplicates; the informative axis was position, and then only for one asset.

### The inference trap, recorded because it cost two published claims

"Inside the hull and clustered at a feature" is equally consistent with a fragment BEING that feature
and with it being a DUPLICATE sitting a millimetre off a surface that already has it. Geometry alone
cannot separate those. **The A/B render — same camera, all components vs main only — is the only
discriminator.** Run it before writing a conclusion about what a fragment is.

## o2-port settled WITHOUT a render — the size regime tells parts from duplicates

`o2-port` was the open question: largest component only 51.5%, so is that a defect or a correctly
multi-part object? Answered geometrically, no renderer needed:

```
41205t  51.5%  diag=1.294  centre=[-0.00, 0.00,-0.05]   main body
17690t  22.1%  diag=0.456  centre=[-0.20, 0.06, 0.09]   LEFT
16413t  20.5%  diag=0.456  centre=[ 0.20, 0.06, 0.09]   RIGHT
 1486t   1.9%  diag=1.175  centre=[ 0.00,-0.02,-0.05]
```

Two components at **22.1% and 20.5%**, with **identical diagonals (0.456)** and centres mirrored about
x=0 at ∓0.20, same y and z. That is a **mirror-symmetric pair of real parts** — on a wall O2 port, the
two outlet assemblies. **keep-largest on this asset would delete 48.5% of the mesh including both.**

### CORRECTED the same day: the mirror twin is NOT an independent signal

I first wrote this as two signals — share of mesh, and the presence of a mirror twin — and said they
were independent. **Then I ran the screen across all seven assets and it flagged the SHOE as
multi-part**, on `twins: 1 [30t/30t on axis2]`. Thirty triangles out of 79,998 is **0.04%**, and the
shoe is the one asset with an A/B render proving keep-largest is safe. A false positive on the only
ground truth available.

The twin test has no size floor, so any two tiny symmetric specks trip it — and TRELLIS output is full
of tiny symmetric specks.

**What survives: the size signal alone.**

| asset | largest non-main fragment | verdict |
|---|---:|---|
| pulse-oximeter | 0.3% | fragments only |
| lowpoly-shoe | **1.4%** | fragments only — **A/B confirmed** |
| fetal-monitor | 2.1% | fragments only |
| glucometer | 0.8% (but one ≥10% component) | multi-part |
| digital-thermometer | one ≥10% component | multi-part |
| iv-pump | one ≥10% component | multi-part |
| o2-port | **22.1%** | multi-part |

**The rule: if any non-main component carries ≥10% of the mesh, the asset is multi-part and
keep-largest is amputation.** That single test gets all seven right against what is known.

**The twin observation was corroboration, not evidence.** On `o2-port` the 22.1% share already said
"structure"; the mirror symmetry was a satisfying detail that added nothing decidable. Do not screen on
it, and do not add a size floor to rescue it — a floor chosen to make the shoe pass would be fitted to
one observation, which is the failure this file already records elsewhere.

**Do not treat 10% as derived.** It separates the measured population cleanly and nothing more; the
gap between 2.1% and 22.1% is wide enough that any cut in it works, which means the data does not
constrain the number. The A/B render remains the only thing that proves nothing visible was lost.
