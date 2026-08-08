# 0050 — Optimize generated assets before judging them, and measure feature survival per part

- Status: **proposed**
- Date: 2026-08-07
- Deciders: Patrick (operator) — *"Don't rule out anything's output because it crosses a threshold; we can add optimization afterwards and then evaluate"*
- Relates to: MADR 0016 (provenance), 0049 (third-party asset licence posture)
- Issues: #164 (TRELLIS.2 cagematch), #179 (no CC0/CC-BY articulating bed)

## Context

I rejected generated output on triangle count. Twice — Meshy and the local Apple-Silicon TRELLIS
path — I used "~800K triangles against a 60,000 ceiling" as an argument against the generator, in
#164, on #179, and in MADR 0049.

**The ceiling gates the shipped asset, not the generator.** There is an entire optimization stage
between them and I was arguing as though it were absent. Worse, the tooling was already installed:
`meshoptimizer@1.0.1` and `draco3d` are pinned at the root, and
`tools/openclinxr/evidence/review-glb-optimization-benchmark.ts` already uses gltf-transform's
`prune`/`dedup`/`quantize`/`meshopt` — **for delivery compression, not geometry simplification.**

## Decision

**Never reject a generator on triangle count. Run the optimization pipeline first and judge what comes
out the far end.** The disqualifying condition is **feature survival**, not size — and feature survival
is measurable per part rather than assumable.

## Why this is not "just decimate"

The subjects are hard-surface clinical props: crash cart with casters, IV pole, monitor bezel, bed
rails. **Thin, topologically-thin, high-curvature features are both where image-to-3D generation fails
and where naive quadric decimation fails.** The same features, twice. A 13× reduction that eats the
casters leaves a box, and a parametric box already exists at 288 triangles with exact dimensions and
no licence.

## What the tooling actually offers — verified against live docs

**`simplify` respects topology; `simplifySloppy` does not.** Sloppy *"can merge a caster into the cart
body because they are near in space."* It is for distant LODs and must-hit-target cases, never for the
primary clinical silhouette.

**gltf-transform's `simplify()` exposes four options only** — `ratio`, `error`, `lockBorder`,
`simplifier`. It does **not** expose `simplifyWithAttributes`, attribute weights, `vertex_lock`,
`Prune`, `Regularize`, `ErrorAbsolute`, `simplifyPrune` or `simplifyWithUpdate`. For feature-critical
props the simplify pass must call **meshoptimizer directly**, per primitive, with per-part budgets.
gltf-transform remains the right document layer for weld, multi-primitive handling and glTF I/O.

**`Prune` drops isolated components** under topological restrictions — dangerous exactly when a caster
is a small disconnected shell, which is when it "vanishes as noise". Keep it off until interior
stripping has classified components.

**`LockBorder` is not feature locking.** It pins topological border vertices for chunk stitching. The
real mechanism for preserving a bezel ring or a pole end is `vertex_lock` or **part-wise simplify**.

**Version gate:** the repo pins `meshoptimizer@1.0.1`; npm is at **1.2.0**, and several of the flags
above are 1.2-era. Confirm exports before relying on them.

## The pipeline, ordered, with what each step silently destroys

| # | step | tool | silent destruction |
|---|---|---|---|
| 0 | inventory — per-mesh triangles, component sizes, AABBs, ROI occupancy baseline | `@gltf-transform/core` | none, measure only |
| 1 | drop NaN / zero-area triangles | Blender headless or Node | epsilon too large eats bezels |
| 2 | **strip interior / hidden shells** | custom | prune threshold deletes casters; "keep largest" deletes IV-pole hooks |
| 3 | position weld, epsilon ~1e-4…1e-5 × scale | gltf-transform `weld` | over-weld softens hard edges, merges UV islands |
| 4 | **feature-aware simplify, per part** | **meshoptimizer direct** | global ratio; `Prune`; sloppy on the whole asset; error so tight it "succeeds" at 200K |
| 5 | hard-edge restore by normal angle | — | over-split inflates count |
| 6 | UV re-atlas if seams destroyed | xatlas / Blender | re-atlas without re-bake → texture swimming |
| 7 | texture resize + KTX2 | gltf-transform `textureCompress` | sRGB normal maps, 4K everywhere, missing mips |
| 8 | delivery: dedup → prune → quantize → meshopt | existing path | quantize too aggressive makes small props jitter |
| 9 | **gates, after optimization only** | — | — |
| 10 | fallback: replace failed parts with the parametric kit | — | shipping melted geometry as "optimized" |

**Step 2 is the highest-leverage and least obvious.** Generative meshes bury budget in interior shells
and double walls that a decimator will happily spend on.

## Measuring feature survival — and every metric's blind spot

This repo has recorded **five geometric gates that passed on figures a human graded as wrong**, so the
blind spots are the important half:

| metric | blind to |
|---|---|
| global triangle count | *a 60K box with no casters* |
| Hausdorff / RMS | melts thin parts while body error stays small |
| connected-component count alone | one stray triangle keeps a "caster" alive |
| silhouette IoU only | a fat feature with the same outline |
| AABB occupancy only | a solid filled volume with no structure |
| name-based mesh filters | part renamed or fused |
| bake quality | looks detailed, geometry is a capsule |

**The gate that is not blind in the ways above:** authored **part ROIs** in the asset frame — left-front
caster, pole top, bezel plane — with triangle count and surface area inside each ROI recorded pre and
post, failing when the count drops below a floor, when the extent collapses, or when a previously
separate component has **merged** into the body. Silhouette IoU from three or four fixed views is a
useful secondary. Global Hausdorff alone is not acceptable.

ROIs must be **authored**, not inferred from the generated mesh — inferring them from the thing being
judged is how a gate greens on its own defect.

## Texture budget for props

KTX2 / Basis Universal is Meta's recommended path for Quest — smaller GPU memory even where disk size
is not smaller. Albedo 512–1024 (1024 only for a hero interactable), normal 512–1024 in **UASTC**
(normals hate ETC1S blocking), packed ORM at 512, emissive 256–512. One material per prop where
possible. **No 2K or 4K per prop** at station density. `textureCompress` plus the `KHR_texture_basisu`
path covers this.

## Consequences

- **#164's `reject_measured` verdict stands on its own terms** — TRELLIS.2 could not execute at all on
  this machine, which is a different failure from producing too many triangles. Nothing about this
  record revives it; the Apple-Silicon fork is what might.
- The bake-off's binary questions move downstream: do the casters exist as separate readable geometry
  **at 60K**, is the pole continuous **at 60K**, does the bezel survive **at 60K**.
- Step 10 is a real answer, not a consolation. A generated body with parametric casters is a
  legitimate hybrid and is better than either alone.

## NOT DETERMINED

- whether interior-shell stripping can be done reliably without part labels on a generative mesh
- what the silhouette IoU threshold should be — it needs calibrating once against a known-good and a
  known-bad, not picking
- whether `meshoptimizer` 1.2's `simplifyWithUpdate` is worth the upgrade for this case

## Claim scope

An engineering posture for optimizing generated props. Says nothing about whether any generator
produces usable clinical equipment — that is what the bake-off decides — and nothing about Quest
performance, which has never been measured on device.
