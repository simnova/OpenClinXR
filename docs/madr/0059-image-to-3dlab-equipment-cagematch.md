# 0059 — image-to-3dlab equipment cagematch

- Status: **decided: TRELLIS.2 adopted for the ECG cart (round 5b: round-3 seed + R5-BEST pipeline); factory wiring follows**
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

## Round 2 evidence

2026-10-01; coordinator re-grade pending. The Decision above is unchanged. Same conditioning image and frozen camera/lights; ≤40k triangles and ≤16 MiB decoded textures for all available challengers.

| backend | wall | raw tris | budget tris | decoded MiB | IoU raw / budget |
|---|---:|---:|---:|---:|---:|
| Hunyuan3D-MLX 2.0 | 889.46 s (round-one mesh reused) | 300,000 | 40,000 | 8 | 0.786432 / 0.786460 |
| Stable Fast 3D (CPU) | 42.80 s | 29,108 | 29,108 | 8 | 0.705130 / 0.705130 |
| TRELLIS.2 | pending Meta approval | — | — | — | — |

Hunyuan's pinned paint stage exposes no body-colour or text-prompt control, so paint was not rerun. The existing 40k optimize-station rung now has two 1024² PBR maps; its territory flag remains US-hosted only. SF3D completed through the supported CPU path after a 445.84 s MPS attempt was terminated while waiting on Metal SVD. CPU peak RSS was 11,114,381,312 B; raw geometry already fits the budget, and PBR maps/factors were retained. Both outputs use 10.67 MiB including full mip chains.

DINOv3 returned 403 at **16:09:06.328497 UTC** and **16:20:43.449277 UTC**, 2026-10-01: **pending Meta approval**. Exactly two authenticated probes; no TRELLIS.2 inference attempt.

Evidence: `docs/openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round2/`; native-tile contact sheets are `renders/contact-sheet-raw.png` and `renders/contact-sheet-budget.png`. Full measurements and provenance are in the parent `results.json` Round 2 object and sidecars. No worker visual grade or adoption decision is added.

### Round 2 coordinator grade (2026-10-01, native 5120 px budget sheet, MY GRADE)

- **Stable Fast 3D: rejected.** Fast (42.8 s, CPU) and in budget (29,108 tris, 8 MiB), but the result is a lumpy untextured blob: no screen, buttons, connectors or casters (IoU 0.705).
- **Hunyuan3D-MLX at the common budget (40,000 tris, 8 MiB, IoU 0.786): still not adopted.** Budgeting kept its detail, so the size objection is resolved. Three remain: the body is white against the oracle's grey, the tool exposes no colour or prompt control to fix it (the paint stage cannot be steered, so a fix would be hand-recolouring, which D1 forbids); coloured blobs are smeared across the base plate; and its weights are US-only (MADR 0046).
- **TRELLIS.2: still no verdict.** DINOv3 returned 403 at 16:09 and 16:20 UTC after the operator requested access; Meta approval pending.

Decision unchanged: **TRELLIS control stays.** Re-open only when TRELLIS.2 access is granted (one run, same budget), or if a Hunyuan release exposes paint conditioning.

## Round 3 evidence

2026-10-01. DINOv3 access worked after the coordinator's 16:54 UTC confirmation. Same conditioning image, frozen camera/lights and ≤40k / ≤16 MiB common budget. The Decision above is unchanged; coordinator grade pending.

| backend / export variant | job wall total | peak RSS | raw tris | budget tris | decoded MiB | IoU raw / budget |
|---|---:|---:|---:|---:|---:|---:|
| TRELLIS.2 clean Apple Space port, CPU-pre-cap recovery | 1,395.77 s | 41,961,652,224 B | 297,289 | 38,697 | 8 (10.67 with mips) | 0.781307 / 0.781238 |

Default export failed after 1,343.430 s on the M1's unsupported float atomic operation in Metal `propagate_cost_kernel`. A non-remeshing-only checkpoint retry failed identically (12.016 s). The same decoded checkpoint then exported successfully (40.327 s) with `remesh=False`, CPU pre-cap 300k and Metal target 400k, avoiding Metal simplification. No resampling or recolouring. The wall total includes all three jobs; end-to-end elapsed time including diagnosis gaps was 1,495.136 s. Other heavy compute-slot holders were 0/0 at every boundary. This is a documented recovery variant, not a successful default export or an independent replay.

The standard optimize-station ladder plateaued above 88k. Installed meshoptimizer's attribute-aware `Permissive` seam relaxation reached 38,697 triangles; two WebP PBR maps were downsized from 2048² to 1024², keeping bindings/factors. No visual-survival claim is inferred from meeting budget or IoU. DINOv3 revision: `ea8dc2863c51be0a264bab82070e3e8836b02d51`; lab commit remains `5ed8e9850d23515c424abc62fbca498e6da52f27`.

Evidence: `docs/openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round3/` contains raw/budget GLBs, stills, masks, attempt logs, timing receipts, exact recovery/optimization scripts and provenance. `renders/contact-sheet-budget.png` fills the TRELLIS.2 column and is also copied to the Round 2 budget-sheet path; the other three columns remain pixel-identical. Mixed-sheet provenance retains the Hunyuan US-hosted-only territory flag. Full numbers and caveats are in REPORT.md and results.json Round 3. No worker grade is added.

### Round 3 coordinator grade (2026-10-01, native 5120 px budget sheet, MY GRADE)

- **TRELLIS.2 (via image-to-3dlab, budget 38,697 tris, 8 MiB, IoU 0.781): the strongest challenger, not adopted yet.** Its front panel is the closest match to the oracle of any candidate, control included. It has all seven buttons in the oracle's teal, purple and orange; all six ring connectors in the oracle's red, blue, YELLOW and black order (control and Hunyuan both lose yellow); a grey body; and a black screen. Against it: its column and base carry dark mottled texture corruption and streaks, and the casters are noisy. It took 1,396 s of compute and 39 GiB peak RSS, so on this 64 GB machine it cannot share the GPU slot with other heavy work. Licence: MIT plus DINOv3 (commercial use permitted, MADR 0049), with no territory limit.

Decision after three rounds: **TRELLIS control stays for now.** Next step, if pursued: a TRELLIS.2 round aimed at the column/base texture corruption (its texture-bake resolution and remesh settings, through our own `~/.openclinxr-tools/trellis2-apple` station so it runs inside the factory's compute slots). Adopt it if the corruption clears while the front-panel likeness holds.

## Round 4 evidence

2026-10-01; coordinator grade pending. **The Decision above is unchanged.** A four-way raw-textured/raw-clay/budget-textured/budget-clay isolation names the fault stage: the severe column/base streaks are absent from both clay renders and from the raw source texture, then appear in the Round-3 budget texture. They were introduced by Round 3's permissive meshopt UV-seam relaxation, not by TRELLIS geometry generation or its texture model. Evidence: `docs/openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round4/diagnosis-stage-sheet.png`.

That diagnosis constrained the bounded treatment sweep to the implicated optimizer UV weights. All four results meet ≤40k triangles and ≤16 MiB decoded texture memory:

| treatment | UV weight | texture | wall | peak RSS | tris | decoded MiB | budget IoU |
|---|---:|---:|---:|---:|---:|---:|---:|
| T1 | 4 | 1024² | 3.262 s | 620,150,784 B | 38,477 | 8 | 0.781202 |
| T2 | 16 | 1024² | 2.393 s | 604,520,448 B | 39,627 | 8 | 0.781336 |
| T3 | 64 | 1024² | 2.416 s | 619,970,560 B | 39,860 | 8 | 0.781297 |
| T4 memory | 64 | 512² | 2.018 s | 582,483,968 B | 39,860 | 2 | 0.781297 |

T3 and T4 remove the severe column/base streaks while preserving the seven-button/six-ring front-panel read; the raw-source caster noise remains. T4 is the evidence recommendation because the 512² maps preserve T3's geometry and IoU while cutting decoded texture memory 75%, with slight softening visible at native pixels. Grade the [two-row contact sheet](../openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round4/contact-sheet-raw-budget.png) and the [column/base crop sheet](../openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round4/column-base-crops-budget.png); individual crops are 2× NEAREST from the same `(300,690,1010,1260)` box. Exact reproduction parameters and revisions are in `round4/recommended-manifest.json`. No Decision text was changed.

### Round 4 coordinator grade (2026-10-01, native sheets, MY GRADE)

- **Diagnosis confirmed from the stage sheet.** The raw TRELLIS.2 texture and the clay geometry are clean. The column/base corruption appears only after OUR optimize station's decimation, whose permissive UV-seam weights let collapses tear texture islands. So round 3's corruption was our defect, not TRELLIS.2's.
- **T3 (UV weights 64/64, 1024 px) and T4 (64/64, 512 px) clear the column streaking** and keep the full front panel: seven buttons, six connectors including yellow, black screen. Residuals: light edge speckle on the cabinet corners, noisy casters, and a faint diagonal sheen on the screen. All are minor at learner distance. T4 holds the panel at 512 px for 2 MiB (39,860 tris, IoU 0.781).

**Decision: ADOPT TRELLIS.2 + optimize UV weights 64/64 + 512 px textures (round 4 T4, `round4/recommended-manifest.json`) for the ECG cart, replacing the TRELLIS control.** Generation costs about 1,400 s and 39 GiB peak RSS on the `gpu` slot, which is acceptable because D9 does not constrain duration.

Follow-ups: (1) wire the T4 manifest into the factory's trellis bake station so the cart is regenerated by the factory, not by this cagematch; (2) the UV-seam weight is an OPTIMIZER defect that likely affects every TRELLIS-derived asset: measure the fleet at the current vs 64/64 weights before changing the station default.

### Rounds 5 and 5b coordinator grade (2026-10-01, native crops, MY GRADE)

- **Round 5 R5-BEST pipeline** (CPU fill-holes -> guarded island filter (10% multi-part rule) -> decimate BEFORE UV unwrap -> 512 px bake) gives the cleanest surfaces of any run: no column/base streaks, clean casters, crisp panel. CPU remesh (R5-D) is not runnable (the installed remesher is cumesh Metal-only). The seed-7 generation it ran on lost likeness: red middle buttons instead of purple, a hexagonal column, IoU 0.741.
- **Round 5b = round-3 seed + R5-BEST pipeline:** 37,462 tris, 2 MiB, IoU 0.781. It restores the oracle panel (seven buttons with purple, six connectors with yellow) and the square column, and keeps the clean column, base and casters. Residuals: light speckle on the bezel border and slightly rounded edges. 47 welded components (largest share 82%) and 5,152 boundary edges. CORRECTION (2026-10-01): an earlier version of this line blamed the 10% multi-part rule. That was wrong. `round5b/recommended-manifest.json` shows the island filter left ONE component (18 -> 1, guard not triggered), so the 47 components and the boundary edges are created later by `to_glb`'s cumesh decimate/repair. Visually there are no floaters.

**Decision (supersedes round 4 T4): ADOPT round 5b for the ECG cart.** That is TRELLIS.2 at the round-3 seed and sampler settings, plus the R5-BEST post-generation pipeline (`round5b/` manifest). About 1,218 s of generation + 123 s of processing; 30 GiB peak RSS on the `gpu` slot.

Follow-ups: (1) make the R5-BEST pipeline the factory's TRELLIS post-generation stage (it is the general fix for fragments and seam tearing, not cart-specific), with the T4 UV-weight path retired for TRELLIS.2 outputs; (2) measure the existing TRELLIS fleet through it before switching the default; (3) the bezel-border speckle is the next target.

## Consequences if accepted

The coordinator must grade the native raw and optimized stills against the Imagine oracle and fixed control before selecting, rejecting, or promoting a backend. Silhouette IoU is supporting shape evidence, not the decision. An access-blocked backend has no quality verdict. No result here is Quest, clinical-validity, or runtime-adoption evidence.

## Round 5 evidence — decision unchanged

Round 5 tested pre-bake decimation, guarded island filtering, CPU hole fill, CPU-remesh availability, and seed/sampler selection against the same conditioning image and frozen camera/lights. The adopted decision remains Round-4 T4 pending coordinator grade of these new native-pixel inputs.

Seed 7 won the mechanical screen (9 welded components, 1,393 boundary edges). Seed 42 default measured 44/4,971; seed 123 default 75/7,402; seed-42 fast-6 75/4,299. Fast-6 reduced wall time but did not reduce component count. The guarded filter reduced the full-resolution mesh from 25 to four retained components before export, preserving the 94.16% body and three ~1.9% structural parts while dropping 21 components no larger than 408 faces. No non-main component reached the ≥10% amputation guard.

CPU fill reduced full-resolution boundary edges 32,048→31,686. CPU remesh could not be executed: this installation exposes only the cumesh Metal remesher and no CPU fallback; Round 3 already established that the relevant Metal path fails on M1 float atomics, so no inner-shell verdict exists. R5-BEST uses C→B→A and produces 38,621 triangles, 2 MiB decoded textures, 8 welded components, 91.68% largest share, 1,419 boundary edges and IoU 0.740757. This is a coordinator-grade candidate, not an adoption change. Evidence and exact manifest: `docs/openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round5/`.

### Round 5 coordinator grade (native crops, MY GRADE)

The coordinator grades the R5-BEST pipeline as a clear surface-quality win: clean column, base and casters without streaks or speckle, and a crisp panel. The seed-7 generation loses likeness: its two middle buttons are red instead of the oracle's purple, and its column is a tapered hexagonal prism instead of the oracle/Round-3 square column. IoU fell from 0.781 to 0.741. This motivates Round 5b: reproduce the Round-3 generation and apply the R5-BEST post-generation pipeline. This grade does not change the adopted Round-4 T4 decision.

## Round 5b evidence — Decision unchanged

The Round-3 seed-42 generation was rerun with its exact sampler settings, 1024 cascade, SDPA backend, alpha-preserving preprocessing and pinned source/weight revisions; the unchanged R5-BEST pipeline then applied CPU fill → guarded island filtering → pre-bake 40k decimation → UV unwrap → 512 px bake. The fresh decode is not byte-identical to the old checkpoint, and no exact replay claim is made.

R5b restores IoU to **0.781192** (T4 0.781297; seed-7 R5-BEST 0.740757) at **37,462 triangles / 2 MiB decoded textures**. It has **47 welded components, 81.995% largest share and 5,152 boundary edges**. Full-resolution CPU fill reduced boundaries 48,874→48,117; filtering retained the main part and dropped 17 fragments of 225 faces or fewer. Generation took 1,218.154 s / 20,837,892,096 B peak RSS; BEST processing took 123.035 s / 32,447,135,744 B. All heavy runs used the compute facade.

Worker feature inspection confirms seven buttons with the middle two purple and six connectors including yellow. The Round-3 column form is recovered, with sampled widths within 0.15%; its corners remain rounded/bevelled rather than an exact geometric square. Cabinet-rim/base-edge patches and small caster notches remain, and topology counts exceed seed-7 BEST. These are measurements and requested feature checks; coordinator overall grading is pending.

Grade the [four-column raw/budget sheet](../openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round5b/contact-sheet-raw-budget.png), [column/base/caster crops](../openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round5b/column-base-caster-crops-budget.png), and [front-panel crops](../openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/round5b/front-panel-crops-budget.png). Reproduction: `round5b/recommended-manifest.json`. The adopted Round-4 T4 Decision is unchanged.
