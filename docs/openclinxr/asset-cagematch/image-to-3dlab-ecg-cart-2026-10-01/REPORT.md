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
