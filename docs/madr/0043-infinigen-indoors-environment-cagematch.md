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

---

## EMPTY-SHELL MEASURE 2026-08-08 (#135) — Decision unchanged

**`verdict: reject_measured`** for the furniture-free shell as a Quest/WebXR station shell.
**0043's Decision above is unchanged** — Infinigen is still not adopted as an `environmentId`-driven
source for the learner runtime. This section only closes the `unevaluated_promising` empty-shell row
from the 2026-08-07 correction with numbers.

### Method

- Install resolved by `realpath`: `~/.openclinxr-tools/infinigen/source` →
  `/private/tmp/ocxr77_tools/infinigen-indoors` (**under `/tmp` — not durable**).
  Same trap as mesh2motion; `installIsUnderTmp: true`.
- Gin present: `infinigen_examples/configs_indoor/disable/no_objects.gin`
  (`solve_{large,medium,small}_enabled = False`).
- Furniture disabled **at config time** (not post-hoc strip).
- HelloRoom's documented `-g no_objects.gin overhead.gin` **crashes** on this 1.14.0-dev checkout:
  `pose_cameras_enabled=False` → `run_stage` returns `None` → unpack `TypeError` at
  `generate_indoors.py:262`. Working command:

  ```bash
  python -m infinigen_examples.generate_indoors --seed 0 --task coarse \
    --output_folder ~/.openclinxr-tools/infinigen/outputs/empty_shell_no_objects \
    -g no_objects.gin -p compose_indoors.terrain_enabled=False
  ```

  Wall clock: **~43.1 s** (`[MAIN TOTAL] finished in 0:00:43.129422`).
- Export: Blender `export_scene.gltf` hop (Infinigen has no native glTF; same as 0043).
- Evidence: `.openclinxr/evidence/issue-135/shell-measure.json`, `empty-shell.glb`,
  `polycounts.txt`, `solve_state.json` (layout graph).

### Measured fields (furniture-free multi-room floorplan)

| Field | Empty shell (`no_objects.gin`) | Hand-made baseline | Full dining (0043) |
| --- | ---: | ---: | ---: |
| `triangleCount` | **203,136** | 204 / 84 | 15,476,539 |
| `meshCount` | 118 | 17 / 7 | 159 |
| `materialCount` | 88 | 17 / 7 | 176 |
| `textureCount` | **0** (coarse stage) | 0 | 14 |
| `exportBytes` | **11,363,496** (~11 MB) | n/a (runtime build) | ~1.09 GB |
| `generationWallClockSeconds` | **43.1** | <1 | ~1378 |
| structure | floor ✓, ceiling ✓, 20 wall meshes, doors ✓ | yes | yes |

Calibration (from this export + Quest station frame, not invented thresholds):

- `triangleCeiling` = **180,000** (`maxVisibleTriangles` per station)
- `byteCeiling` = **209,715,200** (200 MB WebXR soft load cap, same order as #130)

### Polycount breakout (`polycounts.txt`)

| collection | faces |
| --- | ---: |
| `unique_assets:room_wall` | 1,950 |
| `unique_assets:room_floor` | 424 |
| `unique_assets:room_ceiling` | 320 |
| `unique_assets:room_exterior` | 1,592 |
| **architecture-only sum** | **~4,286** |
| `unique_assets:windows` | **45,168** |
| `unique_assets:doors` | **15,493** |
| `skirting` | **25,122** |
| total tris (blend measure) | **203,136** |

So the correction's ~2.5k architectural core is real for wall/floor/ceiling mass, but
`no_objects.gin` still emits **windows + doors + skirting** (not furniture solves). Those non-furniture
taxes dominate and push the multi-room floorplan **~1.13× over** the 180k station budget.

Bytes and textures are fine: **11 MB, zero textures** — the failure mode is geometry count on a
whole-apartment shell, not a texture bomb.

### Layout JSON

`solve_state.json` (~67 KB) is present with room neighbour graph, tags, and relations — the
"blueprint-adjacent layout graph" called out in the correction. Not consumed by the runtime in this
slice (measure-only).

### What this does **not** change

- **Decision:** still `reject_measured` for adopting Infinigen as a direct environment source.
- **No** wiring into `apps/ui-xr`.
- **No** claim of Quest worn readiness or clinical validity.
- Reversal trigger in the Decision section still requires: (1) glTF under 180k after LOD,
  (2) ui-xr load, (3) `environmentId` / case blueprint drive, (4) MADR 0016 manifest.

### Residual (NOT TESTED this slice)

- Single-room restriction (`singleroom.gin` + `restrict_parent_rooms`) under `no_objects` —
  may drop under 180k; not measured.
- Disabling `room_windows` / `skirting_*` / `room_doors` stages for a pure wall/floor/ceiling shell.
- Durable re-home of the install off `/tmp` (unlocked; not done — measured under `/private/tmp/...`).
- Decimation / meshopt of this 11 MB shell toward hand-made budgets.

**Evidence module:** `tools/openclinxr/evidence/infinigen-empty-shell.ts` + planted contracts in
`infinigen-empty-shell.test.ts`.

---

## TRIM-OVERRIDE MEASURE 2026-08-08 (#229) — shell under ceiling, Decision unchanged

**`verdict: shell_under_ceiling`** — with furniture and trim disabled at config time, the
architectural shell clears the 180k triangle ceiling by a factor of 16 (10,984 tris, 6.1%).
**0043's Decision above is unchanged** — Infinigen is still not adopted as an `environmentId`-driven
source for the learner runtime.

### What #135's reject_measured actually is

#135 returned `reject_measured` at 203,136 triangles — a **13% miss on the raw intermediate**
caused by doors, windows and skirting (joinery, not architecture). Per MADR 0050, a raw
intermediate triangle count is not a generator disqualification: the pipeline should optimize
first and judge the post-opt output. The empty-shell path is **unblocked** for harness + offline
experiments.

### Method

- **`no_trim.gin`** created at install: includes `no_objects.gin` and adds:

  ```
  compose_indoors.room_doors_enabled    = False
  compose_indoors.room_windows_enabled  = False
  compose_indoors.skirting_floor_enabled = False
  compose_indoors.skirting_ceiling_enabled = False
  ```

  The gin config FILE approach is required — `-p` command-line overrides do not reliably bind
  `compose_indoors.*` parameters into the `RandomStageExecutor` params dictionary.
- Furniture disabled at config time (`no_objects.gin` — `solve_{large,medium,small}_enabled=False`).
- `compose_indoors.terrain_enabled=False`.
- Generate: same seed 0, same `--task coarse`, ~38 s wall clock (faster than #135's 43 s because
  trim stages are skipped).
- Door opening survival measured by **Euler characteristic** on wall meshes: negative Euler
  (V − E + F < 2) = holes. 18 of 20 wall/exterior meshes show negative Euler; 8 door aperture
  cutters present in `placeholders:portal_cutters` collection.

### Measured fields

| Field | Trimmed shell (`no_trim.gin`) | #135 baseline (`no_objects`) |
| --- | ---: | ---: |
| `triangleCount` | **10,984** | 203,136 |
| `meshCount` | 89 | 118 |
| `materialCount` | 33 | 88 |
| `textureCount` | **0** | 0 |
| `exportBytes` | **7,344,372** (~7 MB) | 11,363,496 (~11 MB) |
| `generationWallClockSeconds` | **38.2** | 43.1 |
| structure | floor ✓, ceiling ✓, 20 walls, door apertures ✓ | floor ✓, ceiling ✓, 20 walls, doors ✓ |
| architecture-only sum | **~4,280** (walls 2,068 + floor 424 + ceiling 320 + exterior 1,592) | ~4,286 |

| `rawTriangleCount` | `postOptTriangleCount` | `optPass` | `featureSurvival` |
| ---: | --- | --- | --- |
| 10,984 | `null` | not run — raw already under ceiling | floor, ≥2 walls, ceiling, door aperture, no furniture |

### The decisive question answered

**`doorOpeningSurvives: true`.** The `placeholders:portal_cutters` collection contains 8 door
aperture cutters with the same dimensions and positions as #135's output. The wall meshes show
negative Euler characteristic (holes from boolean DIFFERENCE cuts baked into the mesh during
solidification). Disabling `room_doors_enabled`, `room_windows_enabled`, and
`skirting_floor/ceiling_enabled` removes the LEAF geometry (door panels, window frames, skirting
extrusions) while preserving the APERTURES in the walls. A learner can enter.

The portal cutters are created in the solidifier stage (`solidify()` in
`infinigen/core/constraints/example_solver/room/solidifier.py`) independently of the decoration
stages (`room_doors`, `room_windows`, etc.) controlled by the `compose_indoors.*_enabled` flags.
This architectural separation is what makes partial trim override possible.

### Trim savings breakdown

| collection | #135 (w/ trim) | #229 (trim off) | saved |
| --- | ---: | ---: | ---: |
| doors | 15,493 | **0** | 15,493 |
| windows | 45,168 | **0** | 45,168 |
| skirting | 25,122 | **0** | 25,122 |
| architecture | ~4,286 | ~4,280 | ~6 |
| **total** | **203,136** | **10,984** | **192,152** |

Architecture-only is nearly identical (~4,280 vs ~4,286), confirming the trim override did not
damage the structural shell.

### What this does **not** change

- **Decision:** Infinigen is still NOT adopted as a `environmentId`-driven runtime source.
- **No** wiring into `apps/ui-xr`.
- **No** claim of Quest worn readiness or clinical validity.
- **No** overturn of MADR 0043's Decision or reversal-trigger checklist.
- Room scope is still multi-room (20 wall meshes; singleroom solve proved too slow, ~12+ min with
  `BlueprintSolidifier.enable_open=False` in `singleroom.gin`).

### Residual (NOT TESTED this slice)

- Single-room restriction (`-p restrict_solving.solve_max_rooms=1` without `singleroom.gin`'s
  `enable_open=False` side effect) — may produce a clinical-shaped room at even lower tri count;
  singleroom solve was slower than expected and deferred.
- Durable re-home of the install off `/tmp` (install still under `/private/tmp/...`).
- Decimation / meshopt LOD pipeline (MADR 0050's post-opt column; `null` here because raw is
  already under ceiling).
- glTF-native export (1.14.0-dev's `FORMAT_CHOICES` still lists only `fbx, obj, usdc, usda, stl,
  ply`; the `.glb` comes from a Blender export hop).

**Evidence module:** `tools/openclinxr/evidence/infinigen-shell-trim-override.ts` + planted
contracts in `infinigen-shell-trim-override.test.ts`. Artifacts under
`.openclinxr/evidence/issue-229/`.

CLAIM: a furniture-free Infinigen shell with trim disabled clears the 180k ceiling by 94%,
preserves door apertures, and is a measurable room — but is not adopted for runtime use.

NOT TESTED: single-room solve; decimation; `/tmp` re-home; glTF-native export; any ui-xr wiring.
