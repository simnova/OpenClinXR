# image-to-3dlab ECG-cart cagematch

Date: 2026-10-01

Status: **pending coordinator grade**

Decision: **pending coordinator grade**

## Outcome

Pixal3D and Hunyuan3D-MLX produced gradeable raw and optimized assets under the fixed control camera. Stable Fast 3D and TRELLIS.2 are access-blocked on gated model weights and therefore have no visual or quality result. This worker does not assign a visual winner; the native 1280 px stills and contact sheets are the coordinator's grade inputs.

All ML Python and Blender work ran through `GpuJobService` or `BlenderService`. The optimized assets came from the existing `iterate-optimize`/meshopt station. The render-only scale normalization fits arbitrary backend export units to the frozen control extent without changing the source GLBs.

## Install and weights

The Apache-2.0 lab was pinned at `5ed8e9850d23515c424abc62fbca498e6da52f27` under `~/.openclinxr-tools/image-to-3dlab`. Installed disk was approximately 24 GiB, plus a reused 14 GiB shared TRELLIS weight cache and 390 MiB U2Net cache. The existing `trellis2-apple` source checkout was not reused because it was dirty and at a different commit; its model cache was reused.

| component | revision |
|---|---|
| Pixal3D vendor | `d1b4926452f9e09702b891db5f05acc845e153ed` |
| Stable Fast 3D vendor | `ff21fc491b4dc5314bf6734c7c0dabd86b5f5bb2` |
| TRELLIS.2 Space | `ebf60b20fc5a4607f90a1c11c0aab0ceeda5429d` |
| trellis2-apple pin | `6055b868734af6e12769d229d90580e775fae9f0` |
| Pixal3D weights | `46d399ac986f45a0d7f5b1ca5058614d8729a131` |
| BiRefNet GGUF | `a57397bd3d351599d9729fc144b3f87c3f87d65b` |
| Hunyuan shape 2.0 | `9cd649ba6913f7a852e3286bad86bfa9a2d83dcf` |
| Hunyuan paint | `b56e8b86b4d1e62b0bb3bbef7e2070d6ec22620e` |
| TRELLIS.2-4B cache | `af44b45f2e35a493886929c6d786e563ec68364d` |
| Stable Fast 3D cache ref | `f0c9a8ffd62cb1bbc8a7a53c9f87a0be1b6be778` (gated content absent) |
| DINOv3 | unavailable (gated HTTP 403) |

## Measurements

RSS is process-tree peak resident memory. Heavy-process counts were sampled at each run boundary; the Pixal3D first run began alongside one browser-capture holder, not another GPU/Blender job.

| backend | outcome | wall | peak RSS | heavy start→end | raw tris | optimized tris | decoded RGBA, no mips | replay |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Pixal3D | gradeable | 467.64 s | 4,862.4 MiB | 1→0 | 987,666 | 73,790 | 128 MiB | same manifest, **not byte-identical** |
| Hunyuan3D-MLX 2.0 | gradeable | 889.46 s | 9,609.1 MiB | 0→0 | 300,000 | 80,000 | 128 MiB | not selected for replay |
| Stable Fast 3D | access-blocked | — | — | — | — | — | — | gated weights |
| TRELLIS.2 | access-blocked | 133.90 s failed probe | 19,876.5 MiB | 0→0 | — | — | — | gated DINOv3 |

Pixal3D replayed the same manifest at 457.55 s and 4,851.6 MiB RSS. Both runs produced 987,666 triangles and the same byte length, but different SHA-256 hashes (`a895…782c` vs `faa9…11fa`). Pixal's initial 40k meshopt target plateaued above 100k; retargeting the 120k rung yielded the 73,790-triangle preferred-band champion. Hunyuan also produced a retained 40,000-triangle stretch rung; the 80,000-triangle preferred rung is the grade target.

## Grade inputs

| subject | raw IoU | optimized IoU | raw still | optimized still |
|---|---:|---:|---|---|
| fixed TRELLIS control | 0.714060 | — | `renders/control/three_quarter_right.png` | same control column |
| Pixal3D | 0.726054 | 0.725203 | `renders/pixal3d-raw/three_quarter_right.png` | `renders/pixal3d-opt/three_quarter_right.png` |
| Hunyuan3D-MLX 2.0 | 0.786432 | 0.786464 | `renders/hunyuan3d-mlx-2.0-raw/three_quarter_right.png` | `renders/hunyuan3d-mlx-2.0-opt/three_quarter_right.png` |

Silhouette IoU is alpha intersection-over-union at 1280×1280 against the same BiRefNet-matted Imagine oracle, resized with Lanczos and thresholded at alpha ≥16. It is a shape measurement, not a visual verdict. Grade [raw contact sheet](renders/contact-sheet-raw.png) and [optimized contact sheet](renders/contact-sheet-optimized.png) at native pixels. Blocked backends are explicit placeholders rather than fabricated treatments.

## Conditioning and blockers

All successful runs used `inputs/ecg-cart-oracle-matted.png` (`add8fd…d82`) derived once from the fixed Imagine oracle. No backend exposed a working exact multi-image route through the pinned lab CLI on this host. TRELLIS.2's lab CLI advertises multi-view, but the Apple Space runner accepted only one image; no four-view collage was substituted.

Hunyuan used the Xiong full pipeline 2.0 variant with quantize8, octree512, seed 42, paint seed 0, paint resolution 512, and 4096 textures. Its generation completed; the wrapper then failed only while moving the finished file across volumes (`EXDEV`), so the exact completed file was recovered by byte-preserving copy.

Every retained Hunyuan output is flagged **US-hosted deployment only; blocked from EU, UK, and South Korea**, per MADR 0046. This is provenance and engineering evidence, not legal advice.

## Claim boundary

This evidence can support a coordinator decision about one ECG-cart cagematch on one M1 Max. It does not establish Quest readiness, clinical fidelity, production adoption, or a general backend ranking.

## Round 2

2026-10-01. Coordinator re-grade pending; the MADR Decision is unchanged. Same conditioning image and frozen camera/lights as round one. Common candidate budget: ≤40,000 triangles and ≤16 MiB decoded textures. All ML and Blender execution used the compute facade in the foreground.

| backend | generation wall | peak RSS | heavy start/end | raw tris | budget tris | decoded MiB (with mips) | IoU raw / budget |
|---|---:|---:|---:|---:|---:|---:|---:|
| Hunyuan3D-MLX 2.0 | 889.46 s (round-one reuse) | 10,075,832,320 B | 0/0 | 300,000 | 40,000 | 8 (10.67) | 0.786432 / 0.786460 |
| Stable Fast 3D, CPU | 42.80 s | 11,114,381,312 B | 0/0 | 29,108 | 29,108 | 8 (10.67) | 0.705130 / 0.705130 |
| TRELLIS.2 | pending Meta approval | — | — | — | — | — | — |

Stable Fast 3D access worked. The first MPS attempt included downloading weights and was manually terminated after 445.84 s, with peak RSS 9,208,217,600 B and heavy-holder counts 0/0. A process sample showed it waiting on Metal `linalg_svd` after internal geometry generation; no GLB had been exported. The supported `--cpu` retry completed with cached weights. RSS is `/usr/bin/time -l` maximum resident set size; timings include load/setup. Both attempt logs are retained in `round2/raw/stable-fast-3d/`. Weight revisions and PBR texture dimensions/bytes are in its `provenance.json`. No SF3D reproducibility claim is made.

Hunyuan **has no exposed body-colour/text-prompt control** in the pinned Xiong wrapper or `run_paint_pbr.py`. Controls cover image/mesh inputs, seed, resolution, sampling steps/scheduler and super-resolution; guidance is fixed at 3.0. Its paint was not rerun and textures were not hand-recoloured. The existing optimize-station 40k rung was reused, with base-colour and metallic/roughness maps downsized from 4096² to 1024² using Lanczos3. Hunyuan outputs and derived contact-sheet pixels retain the **US-hosted only; EU/UK/South Korea excluded** territory flag.

SF3D's raw 29,108 triangles already satisfy the budget. `iterate-optimize` selected raw geometry; the 1024 texture cap preserved dimensions and re-encoded its base-colour and normal JPEG maps. Metallic/roughness factors remain intact. Both candidates consume 8 MiB RGBA8 before mipmaps and 10.67 MiB with mipmaps.

DINOv3 authenticated HEAD probes: **403 at 2026-10-01 16:09:06.328497 UTC** and **403 at 16:20:43.449277 UTC**. Exactly two probes were made. Disposition: **pending Meta approval**; TRELLIS.2 inference was not started.

Grade [raw sheet](round2/renders/contact-sheet-raw.png) and [budget sheet](round2/renders/contact-sheet-budget.png), each 5120×1360 with native 1280 px tiles: control | Hunyuan | SF3D | pending-access placeholder. The unchanged control and Hunyuan raw renders are reused from round one; new candidates/budget outputs use the same renderer, frozen 50 mm camera and lights. IoU uses the round-one alpha/Lanczos protocol; control remains 0.714060. No worker visual verdict is assigned. Optimizer intermediate-rung paths in retained reports are historical local execution paths; only the selected GLBs are retained.

## Round 3

2026-10-01. DINOv3 access is now working: coordinator verified access at 16:54 UTC, and this run loaded the encoder and completed sampling. Same conditioning-image bytes, fixed camera/lights and common budget. Coordinator grade pending; the MADR Decision is unchanged.

| backend / export variant | job wall total | peak RSS | heavy start/end | raw tris | budget tris | decoded MiB raw → budget (budget with mips) | IoU raw / budget |
|---|---:|---:|---:|---:|---:|---:|---:|
| TRELLIS.2 clean Apple Space port; CPU-pre-cap recovery | 1,395.77 s | 41,961,652,224 B | 0/0 each attempt | 297,289 | 38,697 | 32 → 8 (10.67) | 0.781307 / 0.781238 |

The wall total is the sum of three foreground `GpuJobService` job durations, including failed export work. First start to successful export was **1,495.136 s**, 16:56:13.609–17:21:08.745 UTC; the difference is diagnosis time between jobs. Environment check (8.397 s), subsequent optimization and rendering are excluded. Peak RSS is the maximum `/usr/bin/time -l` resident-set measurement across attempts, not a GPU-memory measurement. Other GPU/Blender compute-slot holders were zero at every start and end.

### Execution and M1 recovery

1. Default run, seed 42, 1024 cascade, SDPA attention, 12 steps per sampler, no background-removal model: **1,343.430 s**, peak RSS **41,961,652,224 B**, exit 1. Pipeline load took 174.4 s, sampling 875.7 s, decode/filter 76.7 s. Decode produced 8,804,219 valid faces after filtering 4,003 invalid faces. Export failed in Metal `propagate_cost_kernel`: **unsupported float atomic operation for given target**.
2. Resume the same decoded checkpoint with `remesh=False`: **12.016 s**, peak RSS **5,742,542,848 B**, exit 1. The unsupported kernel is also used by the Metal simplifier; disabling remeshing alone did not fix it.
3. Resume that checkpoint, still `remesh=False`, with the tool's **CPU pre-cap 300,000** and **Metal decimation target 400,000**: **40.327 s**, peak RSS **9,214,017,536 B**, exit 0. This avoids invoking Metal simplification. CPU pre-cap produced 299,998 faces; normal cleanup and PBR bake exported 297,289. No resampling, source-code/weight edits, hand-recolouring, or substituted mesh.

The non-remeshing toggle is exposed by `o_voxel.to_glb` but not the clean runner's CLI. Its explicit runtime override is retained in [reproduce-export.py](round3/reproduce-export.py); exact facade invocation arguments and revisions are in [raw provenance](round3/raw/trellis2/provenance.json). Raw attempt logs and timing receipts are alongside it. The untouched upstream resume manifest has `params.seed=0` (demo default), but its top-level `seed=42` comes from the checkpoint and is the actual run seed. Its `load_decode_bundle` timing includes bake; do not add those fields together. One sampling run was performed; this recovery is not a reproducibility replay and makes no byte-identity claim.

Pinned lab SHA remains `5ed8e9850d23515c424abc62fbca498e6da52f27`; Space `ebf60b20fc5a4607f90a1c11c0aab0ceeda5429d`; Apple pin `6055b868734af6e12769d229d90580e775fae9f0`. TRELLIS weights: `af44b45f2e35a493886929c6d786e563ec68364d`; DINOv3: `ea8dc2863c51be0a264bab82070e3e8836b02d51`. Approximate allocated disk: tool checkout/environments **26,068,992,000 B**, DINOv3 cache **1,212,571,648 B**, in addition to the already-recorded shared TRELLIS cache. The 314,095,917-byte decoded checkpoint remains local scratch, with its hash recorded in provenance; it is not committed. Licence posture remains MADR 0049 / tool `commercial-conditional`.

### Common-budget optimization and grade inputs

The existing `iterate-optimize` ladder ran first. Its 40k targets plateaued at 91,210 (direct), 88,802 (weld), and 88,537 (retargeted/quantized) triangles. To meet the requested common budget, the same installed meshoptimizer was then used directly with `simplifyWithAttributes`, `Permissive`, error limit 1, normal weights [1,1,1] and UV weights [1,1]. It returned **38,697 triangles**, with reported relative error 0.0129007. This relaxes seam constraints; it is not a claim of feature survival. [The exact bounded script](round3/reproduce-seam-budget.mts), [ladder report](round3/budget/trellis2/iteration-report.json), and [seam report](round3/budget/trellis2/seam-budget.json) are retained. Intermediate ladder paths are historical local paths, not shipped assets.

`gltf-transform resize --width 1024 --height 1024` downsized both 2048² WebP maps to 1024². Base-colour and metallic/roughness bindings and factors remain identical; original normals and UV values of retained vertices are kept. No new normal map or re-UV was introduced. Assertions passed for ≤40k triangles, ≤16 MiB decoded, and identical PBR material settings.

Grade the [raw TRELLIS.2 still](round3/renders/trellis2-raw/three_quarter_right.png), [budget still](round3/renders/trellis2-budget/three_quarter_right.png), and [completed budget sheet](round3/renders/contact-sheet-budget.png). The [Round 2 budget sheet](round2/renders/contact-sheet-budget.png) is also refreshed with that same fourth column; its control, Hunyuan and SF3D columns are **pixel-identical** to the previous version. Round 2's historical raw sheet is unchanged. New stills/masks were rendered through `BlenderService` at 1280² with the frozen camera/lights and render-only extent normalization. IoU uses the unchanged alpha ≥16 / Lanczos oracle protocol. Contact-sheet provenance retains Hunyuan's **US-hosted only; EU/UK/South Korea excluded** flag. No worker visual verdict is assigned.
