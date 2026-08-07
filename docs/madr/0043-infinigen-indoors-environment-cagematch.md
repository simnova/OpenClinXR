# MADR 0043: Infinigen Indoors Environment Cagematch — Reject for Direct Runtime Use

Status: Accepted
Date: 2026-08-07
Issue: #130
Lane: C (cagematch — decision with evidence, not working product code)

## Context

Operator request 2026-08-07: try a room created with Infinigen Indoors and compare it to a
hand-made OpenClinXR station shell. The environment lane still has no generator registered for
clinical stations; shells come from `buildStationEnvironment` + `environment-descriptors.ts`
(`ed_exam_bay_v1`, `inpatient_ward_room_v1`, …).

#71 established licence/hardware viability only (BSD-3-Clause, Apple Silicon, no CUDA for indoors).
#77 / MADR 0036 already declined Infinigen for `buildStationEnvironment` on triangle count and
wall-clock; #130 re-runs the cagematch with an explicit same-renderer comparison duty, named
measurement fields, and a hand-made visual baseline.

## Decision

**`verdict: reject_measured`** — do **not** adopt Infinigen Indoors as a direct environment source
for the ui-xr learner runtime or as an `environmentId`-driven factory generator.

A negative measured result is a successful cagematch close. Adopting Infinigen is a separate
decision this issue does not make.

### Measured fields (probe-report.json)

| Field | Infinigen Indoors (DiningRoom, seed 0, fast_solve + singleroom) | Hand-made baseline |
| --- | --- | --- |
| `triangleCount` | **15,476,539** | `ed_exam_bay_v1`: **204**; `inpatient_ward_room_v1`: **84** |
| `materialCount` | **176** | 17 / 7 |
| `textureBytes` | ~95 MB estimate (image buffers in blend) | 0 (procedural colors) |
| `generationWallClockSeconds` | **1377.98** (~23 min) from `#77` run log `MAIN TOTAL finished in 0:22:57.977913` | <1 s (runtime build) |
| `parameterisable` | **false** for clinical factory | **true** via `environmentId` |
| `gltfExportPath` | `~/.openclinxr-tools/infinigen/exports/dining-room-seed0.glb` (**1.0 GB**, export ~14 s) | n/a (built in three.js) |
| `provenance` | BSD-3-Clause source; **no** MADR 0016 runtime asset manifest on the export | Shell descriptors in registry |

Quest posture (`packages/openclinxr/asset-registry/src/index.ts` quest3 budgets):

- `maxTriangles` per asset: **60,000** → Infinigen is **~258×** over
- `maxVisibleTriangles` per station: **180,000** → Infinigen is **~86×** over

### Parameterisation (factory-killer on its own)

Infinigen Indoors is driven by **seed + gin configs + residential room Semantics**
(`DiningRoom`, `Bedroom`, … via `restrict_parent_rooms`). It does **not** accept OpenClinXR
`environmentId` values (`ed_exam_bay_v1`, `inpatient_ward_room_v1`). Seed 0 is reproducible for
the same residential type, but that is random-residential sampling, not “emit this clinical bay
from the case blueprint.” A blueprint-driven encounter factory needs the latter.

### Same-renderer comparison

- Hand-made: `tools/openclinxr/evidence/ui-xr-environment-room-capture.ts` (reuses
  `spawnPortlessDevServer` + `buildRoomCaptureUrl`) → three.js scene-overview PNG of
  `ed_exam_bay_v1` under `ed_chest_pain_priority_v1`.
- Infinigen: GLB **1.0 GB / 15.5M tris** refused **before** `GLTFLoader` parse under a 200 MB
  WebXR soft cap written in the probe (`threejs-load-attempt.json`). It therefore **cannot** be
  loaded into the ui-xr scene for a same-instrument screenshot.
- Blender Workbench stills of the DiningRoom are stored and labelled
  **`not-the-same-instrument`**.

`CONTRACT_MET_VISUAL: not_comparable:infinigen_cannot_load_into_ui_xr_threejs_1GB_glb_15M_tris`

### IN-SCOPE VISUAL (filled)

- **infinigen room:** Blender Workbench interior (not three.js) — detailed paneled door with
  handle/casing, residential shell mass, flat gray coarse-stage materials.
- **hand-made room:** ui-xr three.js ED exam bay — colored walls/floor, stretcher, three cast
  humanoids, doorway placard, clinical UI chrome.
- **what the generated one has that ours lacks:** dense architectural mesh detail and multi-million-triangle
  furniture/window assemblies; photoreal research-scene ambition.
- **what ours has that it lacks:** clinical station semantics (`environmentId`, stretcher fixture,
  actor slots, EHR/dialogue UI), WebXR-loadable triangle budget (~10² vs ~10⁷ tris), factory
  parameterisation by scenario.

### OUT-OF-SCOPE WRONGNESS

- Hand-made ED cast humanoids still show torn/jagged garment edges (pre-existing; not this
  cagematch subject).
- Infinigen Workbench still understates material richness vs a Cycles beauty pass — Cycles would
  still be the wrong comparison instrument against three.js.

## Consequences

Positive:

- Environment generator question for **direct** runtime use is closed with numbers, images, and a
  machine-checkable probe (`--validate-latest`).
- Confirms parametric shells remain the correct learner-path posture at current budgets.
- Install hygiene documented outside the repo; nothing vendored.

Negative / residual:

- **Decimation / LOD as an offline authoring source** is still unevaluated. meshopt is already
  accepted by MADR 0016; whether Infinigen → aggressive simplify → clinical remapping could ever
  pay off is a **separate** cagematch.
- No clinical station Semantics exist in Infinigen Indoors; even a decimated pipeline would need a
  mapping layer from `environmentId` / case blueprint → room program.
- MADR 0036 already declined; this MADR supersedes only the comparison/visual duty of #130 and
  re-affirms reject with stronger same-renderer evidence.

## Compliance and boundaries

- No cloud/paid APIs; no vendoring; install under `~/.openclinxr-tools/infinigen` (and/or
  `/tmp/ocxr77_tools` from #77).
- `claimScope`: local generate-or-reuse, structural measure, three.js load refusal, budget compare.
- `notEvidenceFor`: clinical appropriateness of any room, Quest worn readiness, decimation
  viability, production promotion.

## Evidence paths

```
.openclinxr/evidence/infinigen-indoors-cagematch/latest/probe-report.json
.openclinxr/evidence/infinigen-indoors-cagematch/latest/threejs-load-attempt.json
.openclinxr/evidence/infinigen-indoors-cagematch/latest/hand-made-ed_exam_bay_v1-room.png
.openclinxr/evidence/infinigen-indoors-cagematch/latest/infinigen-dining-room-blender-workbench.png
tools/openclinxr/evidence/infinigen-indoors-cagematch-probe.ts
```

Validate:

```bash
pnpm exec tsx tools/openclinxr/evidence/infinigen-indoors-cagematch-probe.ts --validate-latest
```

## Reversal trigger

Revisit only if a measured pipeline produces a glTF that (1) clears `maxVisibleTriangles` 180k
per station after LOD, (2) loads in ui-xr three.js at a comparable camera, (3) is driven by
`environmentId` / case blueprint fields, and (4) carries a MADR 0016 asset manifest. Until then,
keep hand-made parametric shells.

---

## CORRECTION 2026-08-07 — the decision holds, two of its stated reasons do not

Added after an operator-directed research consult over the full Infinigen API surface and the local
`indoors-stable` checkout. **The Decision above is unchanged** for the question it answers — whole
generated rooms are not an environment source for this runtime. Two supporting claims were wrong and
are corrected here rather than left standing.

### 1. The 15,476,539 triangles were FURNITURE, not architecture

From the probe's own `infinigen-polycounts.txt`, broken out:

| collection | faces |
|---|---:|
| `unique_assets` (furniture, plants, trinkets) | **11,362,518** |
| `unique_assets:windows` | 29,854 |
| `skirting` | 12,574 |
| `unique_assets:doors` | 8,515 |
| `room_wall` + exterior + floor + ceiling | **~2,528** |

The architectural shell is roughly **2.5k faces**. Furniture is ~212× the architectural mass. Rejecting
the *shell* because the *dining-room furniture* blew the budget is a category error, and the original
write-up made it.

### 2. `parameterisable: false` was too strong

Correct as *"there is no shipped clinical-station vocabulary and no `environmentId` mapping"*. Wrong as
*"the semantics are closed residential-only"*. The constraint DSL is a documented extension point:

- `infinigen/core/tags.py` — `class Semantics(EnumTag)` already carries `Office`, `MeetingRoom`,
  `OpenOffice`, `BreakRoom`, `Warehouse`, `Restroom`, which exist as tags with **no furniture program**
  and are therefore empty-ish by design
- `infinigen_examples/constraints/home.py` — `home_room_constraints()` / `home_furniture_constraints()`
- `infinigen_examples/constraints/semantics.py` — `home_asset_usage()`, whose docstring invites adding
  your own Semantics
- `generate_indoors.py:166-172` carries upstream's own TODO: *"Only these roomtypes have constraints
  written in home_furniture_constraints. Others will be empty-ish… TODO: add constraints for garages,
  offices, balconies"*

Defining an `ExamRoom` is a program you write inside a ~1,500-line residential constraint file, not a
gin flag — but it is a supported extension, not a fork.

**Corrected field values:**

| field | was | should read |
|---|---|---|
| full room → runtime | `reject_measured` | `reject_measured` (unchanged) |
| `parameterisable` | `false` | `extensible_with_custom_constraints` |
| empty shell / layout | not evaluated | `unevaluated_promising` |
| stock furniture populate | — | `reject_for_quest` |

### 3. The levers that were not used

- `-g no_objects.gin` (`configs_indoor/disable/no_objects.gin`) disables
  `solve_{large,medium,small}_enabled` — documented in `HelloRoom.md` at **~34 seconds**
- `compose_indoors.{stage}_enabled=False` is systematic across `room_doors`, `room_windows`,
  `skirting_floor`, `skirting_ceiling`, `room_pillars`, `populate_assets`, …
- windows are the second tax: ~30k faces and **5m19s** of the 23-minute run
- `restrict_solving.restrict_child_primary` / `consgraph_filters` restrict object classes
- `real_geometry.gin` **increases** room mesh cost — do not use it here

**No in-pipeline LOD or decimation stage exists**, and `infinigen.tools.export` `FORMAT_CHOICES` is
`fbx, obj, usdc, usda, stl, ply` — **no glTF**. The 1.09 GB `.glb` came from a Blender export, not the
supported path. Both remain real objections to the full-room route.

### 4. The slice that may be worth more than any mesh

`state.to_json` (`generate_indoors.py:412`) writes `solve_state.json` — the probe's dining run produced
**69 objects with tags, relations, polygons and DOF constraints**. That is a *layout and category graph*,
not geometry. Against a hand-authored ED bay of 17 boxes, a solved floorplan is blueprint-adjacent in a
way a photoreal mesh is not.

### What this changes

Nothing about the decision. It reopens a narrow, measured follow-up: the empty architectural shell and
the layout JSON, neither of which this cagematch evaluated. Tracked separately.

**Provenance:** operator-directed consult, 2026-08-07, over the local `indoors-stable` checkout
(1.14.0-dev) plus upstream docs. Claims above cite files in that checkout and the probe's own artifacts.
The original measurements are unretracted — only the inferences drawn from them.
