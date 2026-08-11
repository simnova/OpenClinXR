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
- **Do not hyperoptimize for the metric.** Meta Quest 3 class capacity is **~1.3–1.8M tris/scene** (native Unity guidance). ≤40k is a multi-prop *share*, not the device limit. Prefer the first rung that **grades as the intended prop** under the preferred band; never destroy silhouette to clear 25k.

## Quest 3 / WebXR budget context (research 2026-08-11)

Sources: Meta Horizon “Testing and performance analysis” (triangle + draw-call tables); Meta WebXR performance best practices + optimization workflow.

| Layer | Guidance | Implication for this factory |
|-------|----------|------------------------------|
| Quest 3 / 3S **scene** tris (native) | **1.3M–1.8M** | One prop at 80–120k is tiny; full multi-actor stations need a *station* budget, not prop-as-scene |
| Quest 3 draw calls | ~200–300 busy / 400–600 medium / 700–1000 light | Draw calls + materials often kill WebXR before raw tris |
| WebXR vs native | Small browser overhead; slow apps usually unoptimized | Optimize materials, multiview, KTX2, batching *before* chasing another −15k tris |
| Typical WebXR bottleneck | **Fragment / fill-rate** more than vertex | PBR everywhere, overdraw, shadows > one denser hard-surface cart |
| three.js / R3F / Babylon | Multiview, instancing, meshopt, maturing WebGPU↔WebXR | Headroom on **CPU submit + stereo + delivery**, not a free pass for raw ~1M TRELLIS |

**One-liner policy:** Optimize until the prop is under **~60–80k** and grades as the intended object; chase **≤40k only when the station’s remaining budget (actors + room + other props) requires it**. Never ship raw TRELLIS. Never claim Quest readiness from triangle counts alone.

### Budgets (equipment props — reframed)

| Band | Tris | Use |
|------|-----:|-----|
| Prop share (optional pressure) | **≤ 40_000** | When many props + skinned actors compete; **not** a quality floor |
| Prop preferred (stop here) | **≤ 80_000** | **Default good enough** for a single static equipment prop after grade |
| Prop acceptable | **≤ 120_000** | OK if few props / simple materials and grade prefers density |
| Station skeleton hard | **≤ 180_000** | Early partial station / few props only — **not** full multi-actor exam envelope |
| Station WebXR planning (documented) | **~500k–800k** | Planning envelope until worn-device profile; actors + room + equipment |
| Device class ceiling (Meta native Q3) | **1.3M–1.8M** | Whole scene; never a per-prop target |

**Champion selection (anti-hyperopt):** among survival-ok rungs, prefer the **highest triangle count still ≤ prop preferred (80k)**; else max ≤ acceptable (120k); else max ≤ skeleton hard (180k). Do **not** force 25k or “lowest under 40k” when a 60–80k rung already grades.

**Optimize order (more headroom than another −15k tris):** (1) draw calls / merge materials (2) cheaper secondary materials (3) KTX2 textures (4) multiview / FFR / framebuffer scale (5) then triangle count on worst offenders.

## Measured findings (2026-08-10/11, ECG cart)

| Input style | Multi-view bake raw tris | Post-opt floor (chain ratios) | ≤180k skeleton | ≤80k preferred | Visual |
|-------------|--------------------------:|------------------------------:|:--------------:|:--------------:|--------|
| Photoreal product pack | ~998k | ~186k | miss / edge | miss | Detailed cracked/dirty clinical unit |
| Hard-surface / low-poly pack | ~974k | **~59k** (chain) / **34k** (high-error) | **pass** | **pass** | Boxy cart; cleaner structure; grade front may show rear |

Additional:

1. **Factory CLI multi-view** (`trellis-bake-cli.ts`): all existing pack PNGs → repeated `--input-image`; N>1 uses sequence-concat embeddings in `run_bake_isolated.py` (#255).
2. **Process isolation** (#237): one OS process per subject or MPS OOM cascades.
3. **Chain meshopt ratios plateau** — after first ~0.1 cut, further 0.05…0.005 barely move tris (error bound stops simplification).
4. **Photoreal inputs defeat post-opt** — high-frequency detail forces dense reconstruction; optimize the **prompt**, not only the ladder.
5. **MADR 0050** is still correct: never reject the generator on raw tris; judge after optimization. Prefer **hard-surface packs** so post-opt can succeed.
6. **Hyperoptimize trap** — forcing 25k when 60k already reads as the prop wastes silhouette for a number Quest 3 does not require per-prop.

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
| **1** | **Direct target ratio from raw** with **high error** (`error: 1`) toward ~180k / ~120k / ~80k / ~60k / ~40k | Chain ratios + default error **plateau**; absolute targets from raw are the first fix. **25k is optional stretch only**, not champion default |
| **2** | **Weld** (position merge) then same high-error targets | MADR 0050 step 3; removes split verts that inflate counts |
| **3** | Best quality-preserving survivor → **quantize + meshopt compress delivery** (retarget ≤40k **only** if over preferred and station share pressure) | Delivery size; do not claim topology win without grade |

Record each iter’s tris, bytes, AABB volume ratio (collapse guard), and grade paths.

Constants live in `iterate-optimize.ts` (`PROP_SHARE` / `PROP_PREFERRED` / `PROP_ACCEPTABLE` / `HARD`) — keep skill and CLI aligned.

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
| Tris under preferred (80k) / acceptable (120k) / skeleton hard (180k) | numbers |
| Hyperopt check | if ≤40k but grade worse than ≤80k sibling, **prefer denser sibling** |

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
- **Treating ≤40k as Quest 3’s limit** and destroying prop readability for the number
- Treating **180k station skeleton hard** as a full multi-actor exam-room budget
- Picking **lowest** tri count under 40k when a 60–80k rung grades better

## Done when a prop is “good enough to iterate in UI-XR”

- Multi-view bake exported with `viewCount ≥ 2` preferred
- Proven iter report with ≥1 rung under **prop preferred (80k)** or documented acceptable (120k), survival ok
- Lit + structure grade reviewed (three_quarter if front is rear); hyperopt check passed
- claimScope / notEvidenceFor recorded; no readiness booleans flipped


## Measured iteration results (ECG cart, VR hard-surface raw ~974k, 2026-08-11)

| Iter | Technique | Target | Result tris | Survival |
|------|-----------|-------:|------------:|:--------:|
| 0 | raw multi-view TRELLIS | — | 973,639 | ok |
| 1 | direct high-error ratio from raw | 180k | **179,999** | ok |
| 1 | direct high-error | 60k | **60,000** | ok |
| 1 | direct high-error | 40k | **39,999** | ok |
| 1 | direct high-error | 25k | **34,443** (stretch floor) | ok |
| 2 | weld + high-error | 40k | **39,999** | ok |
| 2 | weld + high-error | 25k | **34,494** | ok |
| 3 | quantize from best | — | 34,443 | ok |

**Historical champion (pre anti-hyperopt selection):** `direct_high_error_soft25k` → **34,443 tris**. Still valid under prop share and preferred bands.

**Policy after budget reframe:** a **~60k** rung (chain or high-error station target) is also a legitimate champion when grade prefers it — do not auto-prefer 34k solely because it is smaller. Site evidence still shows 34k as a measured ladder outcome, not as “Quest requires ≤40k.”

**Vs chain ladder** on same raw: floor **~59k** with default error. **High-error direct targets unlock share band when needed.**

```bash
pnpm exec tsx tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts \
  --input .openclinxr/evidence/trellis-bake-vr-hard/ecg-cart/ecg-cart.glb \
  --out .openclinxr/evidence/trellis-vr-optimize-iterations/<subject>
```

Evidence: `.openclinxr/evidence/trellis-vr-optimize-iterations/ecg-cart-vr-hard/iteration-report.json` + `champion.glb`.
