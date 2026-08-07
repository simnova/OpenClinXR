# MADR 0037: Humanoid base topology fork — MakeHuman viable for garment factory; Anny stays shipped until migration epic

Status: Accepted  
Date: 2026-08-07  
Issue: #90  
Evidence: `.openclinxr/evidence/makehuman-base/probe-report.json`

## Context

#78 closed cleanly: no local AI path produces fitted garment geometry on **Anny** topology.
MakeClothes/MPFB `ClothesService` succeeds on a MakeHuman basemesh (~0.03 s control) and
refuses Anny with `ValueError: The provided object is not a basemesh` (19,158 vs 13,686 verts).
The operator direction is factory approach, not hand-tuned garment literals in
`automate_blender.py`.

That left an explicit fork nobody had closed:

| Keep Anny as sole base | Switch garment basemesh to MakeHuman |
| --- | --- |
| Every shipped humanoid already derives from Anny (Apache-2.0 parametric path) | Unlocks MakeClothes + community `.mhclo` library |
| Hand-authored garment geometry indefinitely | Touches generation, rig, captures if fully migrated |
| No factory clothing path | Licence discipline (MADR 0016 outputs-only; CC0 preferred) |

Peer round before this slice already settled two unknowns (recorded in the planted header):

1. **Skeleton is not the barrier.** `runtime_bone_map.json` already uses MakeHuman-style labels;
   all map primaries/weight sources are a subset of MPFB `rig.default` (163 bones) with zero missing.
2. **Fit-on-MH → transfer-to-Anny is a project**, not a flag (SMPLitex correspondence class).

The remaining measurement was whether **licensable clinical wear** exists at all for MH.
#78 never fitted a real garment (UV sphere control only).

## Decision

**MakeHuman basemesh topology is the viable factory target for garment fit.
Do not regenerate or replace shipped Anny humanoids in this slice.**

More precisely:

1. **Garment-fit basemesh = MakeHuman (hm08 / MPFB basemesh).** Real clinical scrub top
   (`WojackOWL` Medical Scrubs Kit, **CC-BY**) downloads as `.mhclo`+`.obj` and fits via
   `ClothesService.fit_clothes_to_human` in **~0.014 s** on the local MPFB `base.obj`
   (19,158 verts → fitted clothes 4,688 verts / 9,384 tris). See probe report.
2. **Runtime bone map already collapses** MH `rig.default` → the same 23 runtime joints
   Anny ships (`missingFromMakeHuman: []`). Rig is not a blocker for a future MH-based body.
3. **Shipped Anny GLBs are untouched** (counterweight): parent / nurse / ED cast remain 23-joint.
   `peds_patient_child.glb` remains a pre-existing 17-joint lean outlier and was not modified.
4. **Not adopted this slice:** no change to `orchestrate_character` defaults, no re-bake of
   shipped humanoids, no wiring of MakeClothes into the production generator, no promotion
   of community CC-BY assets into runtime paths.

### Catalogue measurement (clinical wear)

| Asset | Licence (from its own distribution) | Role | Result |
| --- | --- | --- | --- |
| Scrubs Shirt (WojackOWL) | **CC-BY** (page + `# license: CC-BY` in `.mhclo`) | clinical body | **fitted** with measurements |
| Scrub Pants / Surgical Mask / Gloves / Cap | **CC-BY** (page License field) | clinical kit / PPE | catalogued; same kit |
| `joepal_medical_mouth_protection` (masks01) | **CC0** | clinical accessory | catalogued only |
| Hospital / patient gown | — | clinical body | **not found** (clothes pages 0–22; dress packs are fashion; `crude_gown` is CC0 fashion) |
| `makehuman-assets` core `base/clothes` | CC0 claim | core library | casual/work suits only — no clinical |

So the catalogue is **not empty** for clinical body wear, but the usable scrub kit is **CC-BY**,
not CC0. Pure CC0 clinical *body* garments were not found; CC0 clinical coverage is accessory-class
today. **Redistribution / allowlist of CC-BY community assets remains Patrick's licence call**
(MADR 0016 + `mpfb-makehuman-garment-license-intake`); this MADR does not approve shipping them.

## Consequences

Positive:

- The fork is closed as a **measured technical decision**, not a default-by-inertia.
- Factory clothing on MH basemesh is proven with a **real scrub `.mhclo`**, not a sphere.
- Rig interop risk for a future MH body is de-risked against the live map and live MPFB rig file.
- Hand-authored garment path is no longer the only coherent long-term option.

Negative / residuals:

- **Full base migration cost is unmeasured** (regenerate all roles, captures, seated maps, garment paint).
- **CC-BY scrub kit** needs an allowlist entry before any committed runtime materialization.
- **Hospital gown** still missing from the free catalogue — patient exam clothing may still need
  authoring or a different source even on MH topology.
- **Proxy transfer MH→Anny** remains out of scope (correspondence project).
- Registry still lists `makehuman_outputs` with `preferredForInitialBuild: false`; updating that
  field is a follow-on once a migration epic is scheduled.

## Compliance and boundaries

- No MakeHuman/MPFB **source** embedded or shipped (AGPL/GPL authoring tools only).
- No cloud/paid APIs. Downloads were community HTTP assets whose licence fields were read first.
- `claimScope`: catalogue survey + local MakeClothes fit + rig map collapse + joint counts.
- `notEvidenceFor`: clinical appropriateness, visual readiness, Quest/production promotion,
  migration wall-clock, CC-BY redistribution approval.

## Related

- MADR 0016 — OSS-first asset pipeline (outputs-only MakeHuman posture)
- #78 clothing-factory cagematch (Anny refusal / MH control sphere)
- `tools/openclinxr/evidence/makehuman-base-viability.ts`
- `tools/openclinxr/asset-pipeline/anny/runtime_bone_map.json`
- `docs/openclinxr/mpfb-makehuman-garment-license-intake-2026-05-27.json`
