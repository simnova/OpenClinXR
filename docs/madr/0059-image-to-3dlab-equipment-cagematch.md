# 0059 — image-to-3dlab equipment cagematch

- Status: **proposed**
- Date: 2026-10-01
- Deciders: coordinator native-pixel grade pending
- Relates to: MADR 0046 (territory/revenue gates), MADR 0049 (third-party model posture), ECG-cart cagematch plan dated 2026-08-31

## Context

The pinned Apache-2.0 `image-to-3dlab` collection was tested on the M1 Max 64 GB against the fixed ECG-cart control: 973,639-triangle raw TRELLIS, 34,443-triangle meshopt control, fixed Imagine oracle, and frozen Blender EEVEE camera/lights. The worker produced measurements and pixels but does not grade visual quality.

## Evidence

| backend | result | wall | peak RSS | raw tris | optimized tris | decoded texture | silhouette IoU raw / optimized | reproducible? |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Control TRELLIS | fixed baseline | — | — | 973,639 | 34,443 | — | 0.714060 / — | fixed hashes |
| Pixal3D | gradeable | 467.64 s | 4,862.4 MiB | 987,666 | 73,790 | 128 MiB | 0.726054 / 0.725203 | replayed manifest; not byte-identical |
| Hunyuan3D-MLX 2.0 | gradeable | 889.46 s | 9,609.1 MiB | 300,000 | 80,000 | 128 MiB | 0.786432 / 0.786464 | not selected for replay |
| Stable Fast 3D | access-blocked | — | — | — | — | — | — | gated weights |
| TRELLIS.2 | access-blocked | 133.90 s failed probe | 19,876.5 MiB | — | — | — | — | gated DINOv3 |

The grade pack is `docs/openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/`: native raw and optimized contact sheets, individual 1280 px stills, raw/optimized GLBs, provenance, exact hashes, optimizer reports, and `results.json`. Stable Fast 3D and TRELLIS.2 have explicit blocked provenance rather than synthetic or substituted output.

Hunyuan3D-MLX used the Xiong full pipeline 2.0 variant. Every retained Hunyuan-derived asset carries the MADR 0046 territory flag: **US-hosted deployment only; blocked from EU, UK, and South Korea**.

## Decision

Coordinator grade, 2026-10-01, native 2560 px contact sheets (MY GRADE) against the Imagine oracle `docs/assets/factory-pipeline/01-imagine-image.png`:

- **Not adopted now. TRELLIS control stays.** No backend replaces it in this round.
- **Pixal3D: rejected.** The raw (987,666 tris) and optimized (73,790) meshes lose the subject: a blank grey slab with an oval recess, no screen, no buttons, no connectors.
- **Hunyuan3D-MLX 2.0: promising challenger, not adopted.** Its geometry is the crispest of the set: a clean screen bezel, separated buttons, ring connectors, column, base and casters. But the body albedo is white where the oracle and control are mid-grey; the connector colours are mostly red and blue (the oracle's yellow is missing); and its optimized output is 80,000 tris against control's 34,443, with 128 MiB decoded textures. A single equipment item cannot carry 128 MiB when a whole room is budgeted at 56 MiB. It took 889 s, and its weights are territory-limited (US-hosted only, MADR 0046).
- **Stable Fast 3D and TRELLIS.2: no verdict.** Both are blocked on gated Hugging Face weights (Stable Fast 3D; DINOv3 for TRELLIS.2). Unblocking needs the operator to accept those model licences on Hugging Face.

Follow-up worth one more round: Hunyuan3D-MLX with its paint stage constrained to the oracle's grey, optimized to <= 40k tris and <= 16 MiB textures, re-graded against control.

## Consequences if accepted

The coordinator must grade the native raw and optimized stills against the Imagine oracle and fixed control before selecting, rejecting, or promoting a backend. Silhouette IoU is supporting shape evidence, not the decision. An access-blocked backend has no quality verdict. No result here is Quest, clinical-validity, or runtime-adoption evidence.
