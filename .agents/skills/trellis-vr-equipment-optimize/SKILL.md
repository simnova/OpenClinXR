---
name: trellis-vr-equipment-optimize
description: Use when optimizing TRELLIS Metal equipment GLBs for WebXR/Quest budgets, multi-view Grok packs, factory:trellis:bake, or post-opt ladders. Codifies measured findings (photoreal vs hard-surface packs, meshopt plateaus, multi-view conditioning) and the proven iteration loop for VR prop budgets.
---

# TRELLIS VR Equipment Optimize

Use this skill for OpenClinXR **equipment** generation via TRELLIS Metal → meshopt/post-opt → grade, when the goal is a **learner-visible prop under station budgets**, not photoreal product photography.

## Hard gates (do not claim)

- Not Quest worn-headset readiness, clinical accuracy, exam equivalence, or production `environmentId` adoption.
- Triangle counts alone never prove visual quality — grade **lit + structure** (`pnpm asset:model-vetting:glb-grade --glb …`).
- DeepSeek models are **text-only**; multi-view pack generation uses **Grok Imagine** (`image_gen` / `image_edit`).

## Measured findings (2026-08-10/11, ECG cart)

| Input style | Multi-view bake raw tris | Post-opt floor (chain ratios) | Hard ≤180k | Soft ≤40–60k | Visual |
|-------------|--------------------------:|------------------------------:|:----------:|:------------:|--------|
| Photoreal product pack | ~998k | ~186k | miss | miss | Detailed cracked/dirty clinical unit |
| Hard-surface / low-poly pack | ~974k | **~59k** | **pass** | near miss | Boxy cart; cleaner structure; grade front may show rear |

Additional:

1. **Factory CLI multi-view** (`trellis-bake-cli.ts`): all existing pack PNGs → repeated `--input-image`; N>1 uses sequence-concat embeddings in `run_bake_isolated.py` (#255).
2. **Process isolation** (#237): one OS process per subject or MPS OOM cascades.
3. **Chain meshopt ratios plateau** — after first ~0.1 cut, further 0.05…0.005 barely move tris (error bound stops simplification).
4. **Photoreal inputs defeat post-opt** — high-frequency detail forces dense reconstruction; optimize the **prompt**, not only the ladder.
5. **MADR 0050** is still correct: never reject the generator on raw tris; judge after optimization. Prefer **hard-surface packs** so post-opt can succeed.

## Preferred pipeline (proven order)

```text
1) VR hard-surface multi-view Grok packs (not photoreal)
2) pnpm factory:trellis:bake --subject <id>   # multi-view when 4 files exist
3) pnpm factory:trellis:optimize --input raw.glb --out <dir>   # high-error targets → champion
4) pnpm factory:trellis:pack --input champion.glb --out champion-meshopt.glb --compress
5) glb-grade lit + structure; three_quarter often better than front for carts
6) Record raw + best tris + paths in evidence/
```

**meshoptimizer (zeux):** already the post-opt engine (`MeshoptSimplifier` + optional **gltfpack** delivery).  
`factory:trellis:pack` wraps `gltfpack` for GPU-friendly quantize/cache + `-cc` compression. Do not use `-sa -se 1` (can zero the mesh).

### Pack layout

```text
.openclinxr/evidence/<packs-root>/<subject>/
  front.png
  side.png
  three_quarter_left.png
  three_quarter_right.png
```

Env: `OPENCLINXR_TRELLIS_PACKS`, `OPENCLINXR_TRELLIS_OUT`.

### Hard-surface pack prompt (front) — use this first

```text
Low-poly game-ready medical ECG monitor cart prop for WebXR / Quest.
Hard-surface stylized, NOT photoreal. Clean boxy forms only.
Wheeled base: simple rectangular platform, four chunky caster cylinders (no spokes).
Upright column: simple rectangular prism.
Main unit: rectangular box + large flat matte black screen (no glass, no waveform, no text).
Control strip: 6–8 large square button pads as raised blocks.
Ports: at most 6 large circular jacks in one row (red/blue/yellow/black), no multi-pin clutter.
NO free cables. NO logos, labels, text, brand marks.
Materials: single matte grey plastic, flat black screen, no dirt/weathering.
Studio light grey background, centered, even soft light, no floor shadow.
Maximize large flat planes for 3D reconstruction. Camera: three-quarter front elevated.
```

Other views: **same object**, only camera (side / ±40° ¾). Prefer `image_edit` from front for consistency.

## Proven optimization technique (3 iterations)

Run after a multi-view bake. Script:  
`pnpm exec tsx tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts --input <raw.glb> --out <dir>`

| Iter | Technique | Why |
|------|-----------|-----|
| **1** | **Direct target ratio from raw** with **high error** (`error: 1`) to force ~60k / ~40k / ~25k | Chain ratios + default error **plateau**; absolute targets from raw are the first fix |
| **2** | **Weld** (position merge) then same high-error targets | MADR 0050 step 3; removes split verts that inflate counts |
| **3** | Best of 1–2 → **quantize + meshopt compress delivery** (optional second high-error pass if still over soft) | Delivery size; do not claim topology win without grade |

Record each iter’s tris, bytes, AABB volume ratio (collapse guard), and grade paths.

### Budgets (equipment props)

| Band | Tris | Use |
|------|-----:|-----|
| Soft single-prop | **≤ 40_000** | Prefer for Quest-class prop |
| Soft station-share | **≤ 60_000** | #239/#250 language |
| Hard station | **≤ 180_000** | Multi-prop room envelope |

## Grade checklist

```bash
pnpm asset:model-vetting:glb-grade --glb <raw.glb> --glb <best.glb>
# Prefer three_quarter_lit for monitor carts (front may show rear shell)
```

| Slot | Grade |
|------|--------|
| Reads as intended prop | yes/no |
| Flat panels / hard edges | yes/no |
| Interior soup / cracked screen | yes/no |
| Buttons/ports readable | yes/no |
| Tris under soft/hard | numbers |

## Anchors in repo

- `tools/openclinxr/asset-pipeline/trellis/trellis-bake-cli.ts` — multi-view factory bake
- `tools/openclinxr/evidence/blender/run_bake_isolated.py` — isolated Metal + multi-view cond
- `tools/openclinxr/asset-pipeline/trellis/vr-postopt-ladder.ts` — chain ladder (baseline)
- `tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts` — **proven 3-iter technique** (`factory:trellis:optimize`)
- `tools/openclinxr/asset-pipeline/trellis/trellis-pack-cli.ts` — **gltfpack delivery** (`factory:trellis:pack`)
- `tools/openclinxr/asset-pipeline/trellis/MULTIVIEW-GROK-PACKS.md` — pack operator spec
- `tools/openclinxr/evidence/trellis-monitor-decimation.ts` — exterior strip / deeper instruments (#250)
- Evidence examples: `.openclinxr/evidence/trellis-bake/` (photoreal), `trellis-bake-vr-hard/` (hard-surface)

## Anti-patterns

- Photoreal “product photo” packs when budget matters
- Same-process multi-subject TRELLIS (MPS OOM)
- Endless chain ratios below 0.02 expecting VR soft targets
- Claiming VR readiness from post-opt alone without hard-surface inputs + grade
- Feeding collaged multi-view as a single image

## Done when a prop is “good enough to iterate in UI-XR”

- Multi-view bake exported with `viewCount ≥ 2` preferred
- Proven iter report with ≥1 rung under hard ceiling and survival ok
- Lit + structure grade reviewed (three_quarter if front is rear)
- claimScope / notEvidenceFor recorded; no readiness booleans flipped


## Measured iteration results (ECG cart, VR hard-surface raw ~974k, 2026-08-11)

| Iter | Technique | Target | Result tris | Survival |
|------|-----------|-------:|------------:|:--------:|
| 0 | raw multi-view TRELLIS | — | 973,639 | ok |
| 1 | direct high-error ratio from raw | 180k | **179,999** | ok |
| 1 | direct high-error | 60k | **60,000** | ok |
| 1 | direct high-error | 40k | **39,999** | ok |
| 1 | direct high-error | 25k | **34,443** (floor near target) | ok |
| 2 | weld + high-error | 40k | **39,999** | ok |
| 2 | weld + high-error | 25k | **34,494** | ok |
| 3 | quantize from best | — | 34,443 | ok |

**Champion:** `direct_high_error_soft25k` → **34,443 tris** — under soft 40k, station 60k, and hard 180k.

**Vs chain ladder** on same raw: floor **~59k** with default error. **High-error direct targets unlock soft band.**

```bash
pnpm exec tsx tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts \
  --input .openclinxr/evidence/trellis-bake-vr-hard/ecg-cart/ecg-cart.glb \
  --out .openclinxr/evidence/trellis-vr-optimize-iterations/<subject>
```

Evidence: `.openclinxr/evidence/trellis-vr-optimize-iterations/ecg-cart-vr-hard/iteration-report.json` + `champion.glb`.
