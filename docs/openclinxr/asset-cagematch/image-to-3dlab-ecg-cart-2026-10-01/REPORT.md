# image-to-3dlab ECG-cart cagematch

Date: 2026-10-01

Status: **Round-4 T4 adopted; Round-5 grade received; Round-5b evidence ready for coordinator grade**

Decision: **TRELLIS.2 + UV weights 64/64 + 512px (Round-4 T4) remains adopted; Round 5b does not change it**

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

## Round 4

2026-10-01. Decision evidence only; the MADR Decision is unchanged and coordinator grade remains authoritative. Diagnosis preceded tuning. The four-cell [stage sheet](round4/diagnosis-stage-sheet.png) compares Round-3 raw textured, raw clay, budget textured and budget clay renders at the fixed camera/lights. The severe dark column/base streaks appear only in the budget textured output: neither clay render contains them, and the raw source texture contains only the generator's small edge/caster noise. The implicated stage is therefore **Round 3's optimize/decimation pass, specifically permissive UV-seam relaxation**, not raw geometry and not TRELLIS texture generation.

Because generation, remesh and texture sampling were exonerated, no 22-minute TRELLIS resampling was performed. Four bounded optimizer treatments changed only the implicated UV attribute weight; T4 additionally tested the requested memory reduction by lowering both PBR maps from 1024² to 512². Every optimizer process ran foreground-only through `GpuJobService` holding the `gpu` slot. All Blender diagnosis, fixed-camera still and mask renders ran through `BlenderService`.

| treatment | changed knobs | process wall | peak RSS | budget tris | decoded MiB | IoU raw / budget |
|---|---|---:|---:|---:|---:|---:|
| T1 | UV weights 4/4; 1024² maps | 3.262 s | 620,150,784 B | 38,477 | 8 | 0.781307 / 0.781202 |
| T2 | UV weights 16/16; 1024² maps | 2.393 s | 604,520,448 B | 39,627 | 8 | 0.781307 / 0.781336 |
| T3 | UV weights 64/64; 1024² maps | 2.416 s | 619,970,560 B | 39,860 | 8 | 0.781307 / 0.781297 |
| T4 memory | UV weights 64/64; **512²** maps | 2.018 s | 582,483,968 B | 39,860 | **2** | 0.781307 / 0.781297 |

The [raw/budget sheet](round4/contact-sheet-raw-budget.png) is control | Round-3 TRELLIS.2 | T1 | T2 | T3 | T4. The four treatment raw cells intentionally reuse the byte-identical Round-3 raw render because only budgeting changed. The [column/base crop sheet](round4/column-base-crops-budget.png) and [individual 2× NEAREST crops](round4/crops-column-base/) use the identical 1280-pixel crop box **(left=300, top=690, right=1010, bottom=1260)**. T1 leaves large column streaks, T2 reduces them, and T3/T4 clear the severe corruption while keeping the seven buttons and six coloured ring connectors. Caster edge noise remains, already visible in the raw source.

T4 is the evidence recommendation, not an adoption decision: it is geometry-identical to T3, has identical IoU, retains the fixed-camera front-panel read, and reduces decoded texture memory from 8 MiB to 2 MiB with only slight softening. Its exact seed, all sampler/export parameters, weight revisions and optimizer settings are in [recommended-manifest.json](round4/recommended-manifest.json). Full measurements, process receipts, GLBs, masks and claims are under `round4/`; no Quest, clinical, runtime-adoption or general-backend claim is made.

## Round 5

2026-10-01. Coordinator grade pending; MADR 0059's Round-4 T4 decision is unchanged. All four new TRELLIS.2 generations used the identical single conditioning image and every TRELLIS/Blender process ran foreground-only through the compute facade. The budget remains ≤40,000 triangles and ≤16 MiB decoded textures.

| arm | wall | peak RSS | welded comps | largest share | boundary edges | budget tris | decoded MiB | IoU |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| R5-A pre-bake decimation, seed 7 | 771.868 s | 14,236,221,440 B | 9 | 91.50% | 1,393 | 37,933 | 2 | 0.740708 |
| R5-B guarded island filter | 57.750 s | 25,903,185,920 B | 9 | 91.54% | 1,477 | 38,245 | 2 | 0.740694 |
| R5-C CPU fill | 66.900 s | 27,662,581,760 B | 10 | 91.66% | 1,357 | 37,496 | 2 | 0.740582 |
| R5-D CPU remesh | 1.217 s probe | 277,741,568 B | — | — | — | — | — | — |
| R5-BEST C→B→A | 88.257 s after generation | 27,593,392,128 B | **8** | 91.68% | 1,419 | 38,621 | 2 | 0.740757 |

R5-A moved simplification into TRELLIS.2 `to_glb`, before UV unwrap and PBR bake, instead of simplifying the finished GLB. Seed 7 was selected mechanically from R5-E: 9 welded components / 1,393 boundary edges, versus seed 42 default 44 / 4,971, seed 123 default 75 / 7,402, and seed-42 fast-6 75 / 4,299. The fast tier reduced seed-42 wall time from 963.552 s to 636.627 s but did not reduce components in this cart trial.

R5-B welded at five decimal places before component splitting. The full-resolution seed-7 mesh had 25 components: a 94.16% main body, three retained parts at 1.93–1.95% each, and 21 fragments at 408 faces or fewer. The 0.01%-of-faces threshold was 744 faces. No non-main component reached the ≥10% multi-part guard; all three substantial parts were retained. Every dropped component's face count, center and diagonal is recorded in `arms/r5-b-island-filter/report.json`.

R5-C used the installed TRELLIS CPU fallback (`trimesh.repair.fill_holes`) on the 7.43M-face mesh. It added 182 faces and reduced full-resolution boundary edges from 32,048 to 31,686 (1.13%). This current MPS pipeline had already performed decode-time fill, so the residual CPU gain is much smaller than the older TRELLIS.2 #169 report. R5-D could not run off-Metal: the installed remesher is `cumesh.metal_remeshing.remesh_narrow_band_dc`, with no CPU branch, while the M1 Metal path already failed on unsupported float atomics in Round 3. No R5-D mesh or inner-shell verdict is fabricated.

R5-BEST combines CPU fill → five-decimal weld → guarded island filter → TRELLIS in-export 40k decimation → UV unwrap → 512px bake. It has the fewest final welded components among R5 arms; R5-C has the fewest boundary edges. Grade the [main raw/budget sheet](round5/contact-sheet-raw-budget.png), [four-seed sheet](round5/seed-screen-raw-budget.png), [column/base/caster crops](round5/column-base-caster-crops-budget.png), and [front-panel crops](round5/front-panel-crops-budget.png). Individual 2× NEAREST crops and native 1280px stills are retained. No worker visual winner is assigned.

### Round 5 coordinator grade (native crops, MY GRADE)

The coordinator grades the R5-BEST pipeline as a clear surface-quality win: clean column, base and casters without streaks or speckle, and a crisp panel. The seed-7 generation loses likeness: its two middle buttons are red instead of the oracle's purple, and its column is a tapered hexagonal prism instead of the oracle/Round-3 square column. IoU fell from 0.781 to 0.741. This motivates Round 5b: reproduce the Round-3 generation and apply the R5-BEST post-generation pipeline. This grade does not change the adopted Round-4 T4 decision.

## Round 5b

2026-10-01. **Decision unchanged; coordinator overall grade pending.** This run restores Round 3's generation settings and applies the unchanged Round-5 BEST treatment. Seed 42, 1024 cascade, 12/12/12 steps, all guidance values, SDPA dense/sparse attention, RGBA preprocessing with no background remover, pinned generator/source and cached model revisions match `round3/raw/trellis2/provenance.json` and its accompanying manifest. Round 5 used the separate Apple/MLX generation path, so seed and step count alone would not reproduce Round 3. This is a fresh sampling run, not an export of the old checkpoint; the decode hash differs and no byte-identity claim is made.

The generation produced 8,804,219 faces after the original runner removed 4,003 invalid-index faces. CPU fill added 361 faces and reduced boundary edges **48,874 → 48,117**. After five-decimal welding, the guarded 0.01%-face filter retained one component with 8,804,120 faces and dropped 17 tiny parts (largest 225 faces; threshold 881); no non-main part met the ≥10% guard. Dropped-part details are in [budget/report.json](round5b/budget/report.json). The resulting mesh went through `to_glb` decimation at 40,000, UV unwrap and 512 px PBR bake, in that order.

| result | welded comps | largest share | boundary edges | triangles | decoded MiB | GLB MiB | IoU |
|---|---:|---:|---:|---:|---:|---:|---:|
| control | — | — | — | — | — | — | 0.714060 |
| adopted T4 | 1 | 100% | 3,044 | 39,860 | 2 | — | 0.781297 |
| R5-BEST seed 7 | 8 | 91.68% | 1,419 | 38,621 | 2 | 1.673 | 0.740757 |
| **R5b round-3 seed + BEST** | **47** | **81.995%** | **5,152** | **37,462** | **2** | **1.703** | **0.781192** |

Generation wall/RSS: **1,218.154 s / 20,837,892,096 B**. BEST treatment: **123.035 s / 32,447,135,744 B**. Raw-grade export (300k target, 2048 px): **60.505 s / 32,645,890,048 B**, 298,347 triangles, IoU 0.781433. Every TRELLIS process held the facade's GPU slot; the four foreground fixed-camera render/mask jobs used BlenderService and include time/RSS in [execution receipts](round5b/executions/). RSS is process resident memory, not GPU allocation.

Requested feature verification: both middle buttons are purple, all seven buttons and six connectors including yellow remain visible. The broad-faced Round-3/T4 column form is restored; its three sampled XZ cross-section widths match Round 3 within 0.15%. The corners remain rounded/bevelled, so this is not a claim of an exact mathematical square. See [feature verification](round5b/visual-verification.json) and [mesh cross sections](round5b/column-sections.json). Patchy cabinet-rim/base-edge defects and small caster notches remain visible; the higher final component/boundary counts above are retained as counter-evidence. No overall worker grade or adoption change is assigned.

The [raw/budget sheet](round5b/contact-sheet-raw-budget.png) adds **R5b round-3 seed + BEST** beside control, T4 and R5-BEST. The [column/base/caster crops](round5b/column-base-caster-crops-budget.png) use the same **(300,690)-(1010,1260)** box; [front-panel crops](round5b/front-panel-crops-budget.png) use **(270,130)-(800,770)**. Sheets preserve native crop pixels; individual crops are 2× NEAREST. [R5b manifest](round5b/recommended-manifest.json) and [measurements](round5b/measurements.json) retain settings, metrics, hashes and provenance. The decoded checkpoint and latents remain local ignored scratch for exact postprocess replay.

## Round 6

2026-10-01. **Decision unchanged; coordinator grade pending.** Round 6 is a deterministic postprocess study of the frozen Round-5b decoded checkpoint, SHA-256 `72eec814cc84539bca019a3dc0143e7c8d18a42fd0e21bdf7bae3cb2fc79edca`; no generation ran. Source inspection confirmed the peer findings before treatment: cumesh performs simplify(3×) → duplicate/non-manifold/small-component/hole repair → simplify(target) → repair (`postprocess.py:253-279`); UV unwrap is followed by unsplit smooth vertex normals and no normal texture (`postprocess.py:329-344,457-485`); each raster texel is interpolated once, closest-point snapped to the original full-resolution mesh, and trilinearly voxel-sampled (`postprocess.py:376-394`); base colour receives Telea inpaint radius 3 (`postprocess.py:450-455`); and `Trellis2TexturingPipeline` retains a supplied mesh's UVs (`trellis2_texturing.py:291-319`). These citations refer to `~/.openclinxr-tools/trellis2-apple/src/`.

The [full-resolution voxel-colour render](round6/stage-isolation/raw-fullres-colour.png) and [clay render](round6/stage-isolation/raw-fullres-clay.png) show the white pinpoint speckle and softened cabinet/column edges before `to_glb`. The speckle is therefore generation-side. This triggered the prescribed stop rule: finish A1 only; do not complete A2 or run A3. Blender Collapse briefly acquired the slot after A1 before inspection completed and was interrupted without producing an A2 artifact or topology log, so no A2 tearing step can honestly be named.

Every comparison threshold was frozen from A0 before reading A1: bezel speckle ≤ A0's count; each of five corner/rim profile widths ≤ its A0 width; each of 13 feature dE2000 values ≤ its A0 value. The hard budgets remain ≤40,000 triangles and ≤16 decoded MiB; silhouette IoU is sanity-only. Bezel speckle uses a 3 px-dilated border mask, 5×5 median residual, A0 flat-patch sigma **0.4453**, and **k=4**. Exact masks, five line profiles, and oracle/candidate sample points are recorded in [results.json](round6/results.json).

| arm | tris | MiB | welded comps | boundary | speckle | corner median px | panel dE mean / max | IoU | A0-derived treatment gates |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| A0 Round-5b control | 37,462 | 2 | 47 | 5,152 | 5,905 | 70 | 22.327 / 40.099 | 0.781192 | baseline |
| A1 35° split + 2048→512 area bake | 37,462 | 2 | 47 | 5,152 | 3,929 | 72 | 22.301 / 42.634 | 0.781192 | speckle pass; corner/dE fail |

A1 preserves A0 geometry, UVs, silhouette, welded topology, seven buttons, both purple buttons, all six connectors, and yellow. Casters use the same connected-face 35° rule as every component, with no exception. A1 reduces the speckle count by 33.5%, but two corner/rim profiles widen and several per-feature dE values exceed their A0-frozen limits; A0 therefore remains the best arm in [best-manifest.json](round6/best-manifest.json). Stage prep/render cost 122.446 s / 6.752 GB and 6.62 s / 4.633 GB peak RSS; A0 source postprocess was 120.877 s / 32.447 GB; A1 exact-geometry rebake/split/export was 5.826 s / 3.172 GB. The [raw|budget contact sheet](round6/contact-sheet-raw-budget.png) and [bezel](round6/crops/bezel/), [corner/column/base/caster](round6/crops/corners-column-base-casters/), and [front-panel](round6/crops/front-panel/) crops use the frozen camera.
