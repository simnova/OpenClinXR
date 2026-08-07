# MADR 0047: hm08 rig-carry cagematch — bake-first gate on MakeClothes runtime path

Status: Accepted  
Date: 2026-08-07  
Issue: #134  
Evidence:

- `.openclinxr/evidence/issue-134/pre-fix.json` (done_when)
- `.openclinxr/evidence/issue-134/probe-report.json`
- Probe: `tools/openclinxr/evidence/hm08-rig-carry-cagematch.ts`
- Contract: `tools/openclinxr/evidence/hm08-rig-carry-cagematch.test.ts`

Related: MADR 0044 (`adopt_mh_body` for MakeClothes fit), MADR 0037 (topology fork), #131, #151

## Context

#131 established that MakeClothes works on MakeHuman `hm08` topology (CC-BY Scrub Shirt, ~12.6 ms, 9 384 tris) and that proximity transfer onto Anny shatters the garment. Operator framing asked how far the factory can go deterministically before craft/LLM shape judgement.

#134 asked the residual: **can hm08 carry everything the runtime already needs** (23 joints as three.js sees them, weights, painted regions, morphs, triangle budget) — or is migration blocked?

Separately, #134 recorded an **unmeasured claim**: raw `*.anny_base.obj` looks better (clean shoulders/deltoids/neck) than the GLBs baked from them. A peer round required measuring that **before** any MPFB2 work: if the bake is the defect, hm08 does not fix it.

Licence: MPFB2 is GPL-3 and deferred (MADR 0044 posture). This MADR does not resolve that.

## Decision

**`verdict: reject_measured`**

**Do not attempt an hm08 rig-carry candidate until the Anny bake path stops subtracting body-mesh surface integrity.**

Contract (1) ended the slice successfully. No MPFB2 export was run (0 attempts; stop rule allows at most 2). No shipped asset was touched. Nothing was promoted to `generated-humanoids/`.

### Measured numbers (six shipped humanoids)

Measure: **`body_mesh_connected_components`** on the body shell only (`*anny_base*` mesh vs tracked `*.anny_base.obj`).

| asset | base OBJ tris | body GLB tris | base components | body components | bake degrades |
| --- | ---: | ---: | ---: | ---: | --- |
| `ed_chest_pain_adult_cast.glb` | 26 692 | 26 692 | **1** | **14** | yes |
| `ed_chest_pain_nurse_adult.glb` | 26 692 | 26 692 | **1** | **14** | yes |
| `ed_chest_pain_spouse_adult.glb` | 26 692 | 26 692 | **1** | **14** | yes |
| `peds_anxious_parent.glb` | 26 692 | 26 692 | **1** | **14** | yes |
| `peds_nurse_kevin.glb` | 26 692 | 26 692 | **1** | **14** | yes |
| `peds_patient_child.glb` | 27 420 | 27 420 | **4** | **20** | yes |

Supporting observations (not the contract measure):

- Body triangle count is **preserved** (OBJ quads triangulate to the same face count as the baked body shell). Height classes match issue inventory (~1.76 / 1.66 / 1.25 m).
- Body primitives after bake: adults `primComps ≈ [7,1,2,4]` (four material-split primitives, already multi-island). Export + multi-material paint is the likely splitter — same class as SOLIDIFY rim micro-islands (#121 / §6t), not a missing hm08 joint.
- Blender-side non-manifold edge count on evaluated body: **0 → ~1050** (adults); components **1 → 14**. Shoulder P95 dihedral was **not** worse on the GLB body alone — the visual “worse than base” grade is consistent with **surface continuity / wardrobe overlay**, not smoother-or-rougher shoulder angles on the body shell.
- Runtime joints on all six GLBs: **23 / 23** canonical names as three.js sees them (`thighL`, `upper_armL`, …). `weightSource` remains position-painted heuristics (`ensure_deterministic_skinning_fallback`), not MPFB heat weights.
- Morph targets on body: **100** slots per body mesh (plus garment morphs in total document). Material/region surface count: **5–6 materials + declared/garment meshes**.

### Closed visual checklist

| slot | value |
| --- | --- |
| `base_obj_vs_shipped_glb` | `base_better` |
| `where_they_differ` | body surface continuity (multi-material islands after bake export); not stature |
| `hm08_candidate_loads` | `not_attempted` |
| `hm08_figure_intact` | `not_attempted` |

Observable capture requirement **lapsed** with contract (1) — no candidate was built.

## Consequences

Positive:

- The unmeasured #134 claim is now measured: **the bake path degrades body surface integrity** relative to the tracked base OBJ on every shipped humanoid.
- MakeClothes / hm08 migration is **correctly deprioritized** until bake continuity is fixed — avoids a multi-week retarget that would not address the learner-visible defect class.
- Pre-fix inventory is durable and re-runnable (`pnpm exec tsx tools/openclinxr/evidence/hm08-rig-carry-cagematch.ts`).
- MPFB2 GPL posture unchanged; no promotion risk.

Negative / residuals (NOT DETERMINED):

- Whether fixing multi-material / glTF split on the Anny bake restores pixel parity with base renders (shoulder/deltoid appearance) without hm08.
- Whether an hm08 body with a freshly named 23-bone armature + auto-weight would then clear the runtime bind surface (posture maps, seated/supine).
- Morph/viseme parity cost on hm08 (deliberately out of scope; gap not closed).
- Real weight quality of MPFB vs position paint (#126 residual).
- Whether a correspondence-class transfer (not proximity) can ever put MakeClothes garments on Anny without adopting hm08.
- Operator licence decision for MPFB2 / community garments.

## Redirect (next product slice)

Repair **Anny bake export continuity** (body mesh connected components / non-manifold after multi-material paint) so the shipped GLB body remains a single connected surface matching the base OBJ — then reopen hm08 rig-carry if MakeClothes is still the garment strategy.

## Compliance

- `claimScope`: local bake-first cagematch; evidence path only.
- `notEvidenceFor`: production readiness, Quest, clinical realism, GPL resolution, garment fit, morph parity, adoption.
- No `generated-humanoids/` writes. No MPFB2 candidate file.

## Probe entrypoint

```bash
pnpm exec tsx tools/openclinxr/evidence/hm08-rig-carry-cagematch.ts
pnpm exec tsx tools/openclinxr/openclaw/assert-contract-live.ts \
  tools/openclinxr/evidence/hm08-rig-carry-cagematch.test.ts \
  "the bake is compared against its own base before any MPFB2 work" \
  "the bake-off reached a recorded verdict" \
  "no shipped asset was touched and nothing was promoted (COUNTERWEIGHT)"
```
