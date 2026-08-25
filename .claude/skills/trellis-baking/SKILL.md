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

