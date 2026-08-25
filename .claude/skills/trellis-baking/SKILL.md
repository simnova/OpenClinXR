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
