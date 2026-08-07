# MADR 0044: MakeClothes with Anny as proportional reference — cagematch decision

Status: Accepted  
Date: 2026-08-07  
Issue: #131  
Evidence: `.openclinxr/evidence/makeclothes-anny-reference/latest/probe-report.json`  
Related: MADR 0037 (MH basemesh is the viable garment-fit topology; Anny stays shipped until a migration epic)

## Context

Operator direction (2026-08-07): *create a humanoid with anny then use that as a reference for creating a humanoid with MPFB or other alternative, so that anny becomes the reference but you can leverage the clothing options from makeclothes.*

MakeClothes garments are authored against MakeHuman (hm08) topology. They cannot be fitted to an arbitrary mesh (`ClothesService` refuses non-basemesh inputs — measured in #78). Procedural garment slices have repeatedly passed machine gates while looking wrong. This cagematch asks whether the MakeClothes path is reachable **from this machine** with Anny as the proportional reference, and what that implies for the runtime mesh.

Anny package import is unavailable on this machine (`import anny` raises). The six tracked `*.anny_base.obj` under `apps/ui-xr/public/generated-humanoids/` **are** the Anny reference — that half of the operator request was already done.

## Decision

**`verdict: adopt_mh_body`**

Adopting MakeClothes means adopting the MakeHuman/MPFB hm08 basemesh as the **garment-fit and practical runtime body**. Anny remains the **proportional reference** for stature/identity targets during authoring, not a MakeClothes basemesh and not a drop-in receiver for fitted `.mhclo` assets via naive proximity transfer.

More precisely:

1. **MPFB2 loads in Blender 5.1.1.** Installed extension `bl_ext.user_default.mpfb` v2.0.15 enables cleanly. Manifest `blender_version_min = "4.2.0"`. SPDX from `blender_manifest.toml`: **`GPL-3.0-or-later`**. MPFB is **out-of-repo authoring only** — never vendored, never imported by repo code, never shipped. Meshes it outputs are not derivative works of the addon.

2. **MH body can be stature-matched to an Anny base — measured, not eyeballed.** After uniform scale + foot/center align, NodeIO on exported glTF reports (adult `ed_chest_pain_adult_cast.anny_base.obj` vs MPFB `base.obj`):

   | metric | value |
   | --- | --- |
   | `annyStatureMeters` | 1.760 |
   | `mhStatureMeters` | 1.760 |
   | `meanVertexDeviationMeters` | **0.0229** (~2.3 cm) |
   | `maxVertexDeviationMeters` | **0.1826** (~18 cm) |
   | method | sampled nearest-neighbour MH→Anny on exported glTF (NodeIO), not Blender's own report |

   Mean surface agreement after stature match is usable for proportional targeting. Max deviation (~18 cm) shows residual shape mismatch (extremities / volume) — the bodies are not interchangeable topology.

3. **A real MakeClothes garment fits the MH basemesh.** Garment: **Scrub Shirt** (WojackOWL Medical Scrubs Kit). Licence from the asset's own `.mhclo` header: **`CC-BY`** (author WojackOWL; page http://www.makehumancommunity.org/clothes/scrubs_shirt.html). Clearly permissive — recorded, not assumed. Fit via `ClothesService.fit_clothes_to_human` on MPFB `data/3dobjs/base.obj` in **~0.013 s**. **Important path detail:** fit on `mpfb.create_human()` meter-scaled mesh places the same `.mhclo` off-body; the working path is **base.obj + Basemesh tag** (same as #90).

4. **Proximity transfer back onto Anny is not a substitute for native MH fit.** Transfer method `proximity_normal_offset_transfer` exported successfully and reported near-zero mean source offset / max ~1.2 cm, but **Workbench pixels show a shattered scrub** — floating triangular fragments across the torso and shoulders, bare midriff, torn shoulder region. Metric agreement without visual integrity is the same failure class as prior garment gates. **Native MakeClothes fidelity exists only on the MH body.**

5. **Triangle cost is within budget.** Fitted scrub: **9,384 tris** vs `maxTriangles: 60000` per asset (`asset-registry/src/index.ts` quest3AssetBudget). Within budget by a wide margin.

### Closed-vocabulary verdict

| field | value |
| --- | --- |
| `verdict` | `adopt_mh_body` |
| free text | MPFB2 loads (GPL-3.0-or-later, authoring-only). Real CC-BY Scrub Shirt fits MH base.obj. Stature match mean ~2.3 cm / max ~18 cm. Transfer exports but **visually fragments**. Runtime path for MakeClothes = MH body; Anny = proportional reference only. |

Escape values `other` / `inconclusive_blocked` were not needed — the probe completed all five questions.

## Consequences

Positive:

- MakeClothes is **reachable** on this machine under Blender 5.1.1 without building Blender from source.
- Licence boundary for MPFB is recorded as SPDX **GPL-3.0-or-later** (not GitHub's NOASSERTION guess).
- One real clinical-looking garment (CC-BY Scrub Shirt) is fitted with measured tris and wall-clock.
- The operator question is closed with numbers: MH can track Anny stature; transfer does not rescue Anny as the MakeClothes runtime mesh.

Negative / residuals:

- **No production adoption this slice.** Shipped Anny humanoids untouched. No wiring into `orchestrate_character`.
- **CC-BY scrub kit** still needs an explicit allowlist decision before any committed runtime materialization (MADR 0016 + prior #90 note).
- **Full Anny→MH migration cost** (rig, captures, seated maps, wardrobe paint) remains unmeasured — same residual as MADR 0037.
- **Correspondence-class transfer** (SMPL / cage / barycentric surface maps) is not evaluated; only proximity/normal-offset was tried and visually failed.
- Installed MPFB version on this machine is **2.0.15** (manifest); GitHub may list newer — not re-downloaded this slice.

## IN-SCOPE VISUAL (Workbench + glTF)

| slot | grade |
| --- | --- |
| MH body vs Anny reference | Stature-aligned; greyscale Workbench flattens materials — rely on NodeIO deviations + `aligned-*-body.glb` |
| Fitted garment on MH body | Coherent torso scrub AABB on MH (`garment-only-on-mh.glb`, Y≈0.98–1.51 m) |
| Garment after transfer | **Shattered fragments** on Anny (`render-garment-after-transfer-with-anny.png`) |
| vs procedural garment | Native MH MakeClothes is a real authored mesh; transfer result is **clearly worse** than procedural shells |

`CONTRACT_MET_VISUAL: clearly_worse` (for the transfer-to-Anny path a learner would see). Native MH fit is a different authoring class and was not pixel-composited against procedural captures in this probe.

Renderer: **Blender 5.1.1 BLENDER_WORKBENCH** (PNG) + **glTF-Transform NodeIO** (metrics).

## Compliance and boundaries

- MPFB install path (outside repo): `~/Library/Application Support/Blender/5.1/extensions/user_default/mpfb`
- Removal: disable/remove the Blender extension; no repo files vendor MPFB.
- Garment staging under `.openclinxr/evidence/makeclothes-anny-reference/latest/staging/` (gitignored evidence).
- `claimScope`: local MPFB authoring-tool probe + glTF-measured body match + MakeClothes fit + proximity transfer attempt on one adult Anny base.
- `notEvidenceFor`: clinical appropriateness, production readiness, Quest readiness, B+ realism, shipping GPL code, full migration cost, adoption into orchestrate_character.

## Probe entrypoints

```bash
pnpm exec tsx tools/openclinxr/evidence/makeclothes-anny-reference-probe.ts
pnpm exec tsx tools/openclinxr/evidence/makeclothes-anny-reference-probe.ts --validate-latest
```

Blender stage: `tools/openclinxr/evidence/blender/makeclothes_anny_reference_stage.py`  
Land path: `.openclinxr/evidence/makeclothes-anny-reference/latest/probe-report.json`
