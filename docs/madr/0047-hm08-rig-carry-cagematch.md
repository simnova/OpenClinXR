# MADR 0047: hm08 rig-carry cagematch — bake surface intact; rig carries under freeze

Status: Accepted (corrected 2026-08-07)  
Date: 2026-08-07  
Issue: #134  
Evidence:

- `.openclinxr/evidence/issue-134/pre-fix.json` (done_when)
- `.openclinxr/evidence/issue-134/probe-report.json`
- `.openclinxr/evidence/issue-134/hm08-rig-carry-candidate.glb` (evidence path only)
- `.openclinxr/evidence/issue-134/hm08-export-attempt-{1,2}.json`
- Probe: `tools/openclinxr/evidence/hm08-rig-carry-cagematch.ts`
- Blender stage: `tools/openclinxr/evidence/blender/hm08_rig_carry_stage.py`
- Contract: `tools/openclinxr/evidence/hm08-rig-carry-cagematch.test.ts`

Related: MADR 0044 (`adopt_mh_body` for MakeClothes fit), MADR 0037, #131, #151, #121 / §6t

## Decision (CORRECTED)

**`verdict: adopt_hm08`** — for **runtime rig carry on an evidence-path candidate only**.

1. **Bake does not degrade body surface continuity** when measured correctly (position-merged components across multi-material primitives).
2. **hm08 can carry the 23 canonical joints** as three.js sees them (`thighL`, `upper_armL`, …): fresh bounds-driven armature + auto-weight export, all 23 names resolve, skinned mesh, **36 972 tris** (under 60 000).
3. **Not production adoption.** Candidate stays under `.openclinxr/evidence/issue-134/`. Nothing promoted to `generated-humanoids/`. MPFB2 GPL-3 remains deferred. Morph/viseme count on candidate = **0** (gap recorded, not closed).

Withdrawn: earlier `reject_measured` that treated index-based multi-material islands as bake degradation — false; fence only.

## Contract (1) re-measure — index vs position-merged

Measure that answers “does the bake degrade the body surface”:

| asset | base verts | unique pos (5dp) | base comps | **index-based body comps** | **position-merged comps** | bake degrades? |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `ed_chest_pain_adult_cast` | 13 348 | 13 348 | 1 | 14 | **1** | no |
| `ed_chest_pain_nurse_adult` | 13 348 | 13 348 | 1 | 14 | **1** | no |
| `ed_chest_pain_spouse_adult` | 13 348 | 13 348 | 1 | 14 | **1** | no |
| `peds_anxious_parent` | 13 348 | 13 348 | 1 | 14 | **1** | no |
| `peds_nurse_kevin` | 13 348 | 13 348 | 1 | 14 | **1** | no |
| `peds_patient_child` | 13 718 | 13 718 | 4 | 20 | **4** | no |

Primary measure name: `body_mesh_position_merged_connected_components`.

**Why the numbers differed:** a multi-material glTF mesh is one primitive per material with independent index buffers; material-boundary vertices are duplicated (same position, new index). Summing per-primitive index connectivity reports material islands as disconnected even when the surface is continuous. Independent check (orchestrator): `peds_nurse_kevin` → `uniqueVertPositions=13348`, `COMPONENTS=1` after position merge — matches base OBJ vertex count exactly.

**Blender non-manifold 0→~1050 (withdrawn as degradation):** on `peds_nurse_kevin`, raw import reports ~1056 non-manifold edges and 14 index components; after `remove_doubles` at 1e-5 → **0 non-manifold, 1 component, 13 348 verts**. That figure measured material-split duplicates, not holes in the surface. §6t: authoring/import topology reports are not automatically claims about continuous geometry.

What position-merge **cannot** see: UV seams, normal discontinuities, weight quality, pixel-grade shoulder appearance under wardrobe overlays, or whether multi-material encoding causes consumer bugs unrelated to surface connectivity.

## Rig-carry result (hard freeze)

In scope only: name 23 canonical joints on hm08, auto-weight, export, inspect.

| item | result |
| --- | --- |
| Attempt 1 | `ARMATURE_AUTO` — **failed** (23 vertex groups created, 0 groups with non-zero weights under the stage’s check) |
| Attempt 2 | `ARMATURE_ENVELOPE` — **ok** (23/23 weighted groups); stop rule respected (no third attempt) |
| File-side bone names | full dotted set (`upper_arm.L`, …) |
| As three.js sees them | all 23 undotted names present; extra `neutral_bone` from exporter |
| Candidate tris | 36 972 ≤ 60 000 |
| Morph targets | **0** (gap number; out of scope to close) |
| Path | `.openclinxr/evidence/issue-134/hm08-rig-carry-candidate.glb` — **not** under `generated-humanoids/` |
| Shipped assets | untouched |

### Still true from first pass (undisputed)

- Shipped humanoids: **23/23** canonical joints as three.js sees them.
- `weightSource` on shipped assets: position-painted heuristics (`ensure_deterministic_skinning_fallback`), not MPFB heat weights.
- Body morph slots on shipped anny_base meshes: **100** (plus garment morphs in full document).
- Height classes ~1.76 / 1.66 / 1.25 m; three content classes per #151 inventory.
- `phenotype.bmi` does not move vertices (#151).

## Closed visual checklist

| slot | value |
| --- | --- |
| `base_obj_vs_shipped_glb` | `same` (under position-merged continuity) |
| `where_they_differ` | none under that measure; index-based multi-material split is export encoding |
| `hm08_candidate_loads` | `yes` (NodeIO + skin + 23 joints; Workbench PNG under evidence path) |
| `hm08_figure_intact` | `yes` (continuous hm08 body mesh in Workbench; not a shattered transfer) |

Ui-xr room capture of the candidate was **not** wired (would require promotion or scenario cast changes — out of freeze). Load proof is glTF-transform skin/joints + Blender re-import/render of the evidence GLB.

## Consequences

Positive:

- MakeClothes path is no longer blocked by a false “bake destroys the body” gate.
- hm08 + 23-name armature + weights is a measured, exportable evidence candidate.
- Correct continuity metric is codified (position-merge across primitives).

Negative / residuals (NOT DETERMINED):

- Whether envelope weights are good enough for clinical-idle / seated / supine maps (bind quality not graded beyond name resolution + skin presence).
- Why `ARMATURE_AUTO` produced empty weights on this mesh/Blender 5.1.1 (first attempt failed for real under the stage’s weight check).
- Morph/viseme/gaze parity cost on hm08.
- Full migration cost (wardrobe paint, seated maps, captures, UI-XR default).
- Operator licence decision for MPFB2 / community garments.
- Whether pixel “base looks better than shipped” under wardrobe overlays is still real for other reasons (lighting, garments, paint) even though body surface continuity holds.

## Compliance

- `claimScope`: bake-first position-merged measure + evidence-path hm08 rig-carry only.
- `notEvidenceFor`: production readiness, Quest, clinical realism, GPL resolution, garment fit, morph parity, adoption into orchestrate_character.
- No `generated-humanoids/` writes.

## Probe entrypoint

```bash
pnpm exec tsx tools/openclinxr/evidence/hm08-rig-carry-cagematch.ts
pnpm exec tsx tools/openclinxr/openclaw/assert-contract-live.ts \
  tools/openclinxr/evidence/hm08-rig-carry-cagematch.test.ts \
  "the bake is compared against its own base before any MPFB2 work" \
  "the bake-off reached a recorded verdict" \
  "no shipped asset was touched and nothing was promoted (COUNTERWEIGHT)"
```
