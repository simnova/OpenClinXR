# MADR 0053: Infinigen Room as an `environmentId`-Keyed Learner Environment — First Consumer

Status: Accepted
Date: 2026-08-11
Issue: #336
Lane: A (learner-facing / XR)

## Context

Six Infinigen probe slices (#130, #135, #229, #234, #236, #271) produced evidence and no
consumer: `grep -rn "infinigen" apps/ui-xr/src/*.ts` returned ZERO matches. #71 listed the open
questions: can rooms be parameterised by `environmentId`; export path into
`apps/ui-xr/public/`; generation wall-clock; provenance. The goal of #336 is a learner opening a
station in UI-XR standing inside a generated Infinigen room, selected by `environmentId`,
reproducibly — instead of the procedural box built by `buildStationEnvironment`.

MADR 0043's Decision (`reject_measured` for Infinigen as a direct runtime environment source) was
reached on a 15.5M-triangle furniture run and was already corrected in-place: the architectural
shell is ~2.5k faces, and `parameterisable: false` was corrected to
`extensible_with_custom_constraints`. #271 then split the parameterisation trigger by axis and
measured the HEIGHT axis met, the FOOTPRINT and DOOR-PLACEMENT axes not met. #336 does not relitigate
those measurements; it closes the consumer gap on what #271 left open ("a post-process extract (#236)
parameterised on a target footprint" / "a measured pipeline that produces a glTF that loads in
ui-xr three.js").

## Parameterisation question — answered by measurement

**Reproducibility: MET.** Two independent `clinical_bay.gin` seed-0 runs (the original #271 run and
a fresh #336 run) produced identical floorplan footprints: scene AABB `25.609 × 18.0 × 3.851 m`,
identical room sizes (dining-room 6.5×6.5×2.65, kitchen 6.5×6.5×2.65, living-room 8×8, etc.), 20 wall
meshes, 36 portal cutters. Same seed + same gin config → same room. Wall-clock for the fresh run:
**33.7 s** (`MAIN TOTAL finished in 0:00:33.682489`, task coarse).

**Height: MET.** `RoomConstants.global_params.wall_height` is an exact gin input (2.65 → 2.65 m shell;
#271 measured 3.6 → 3.6).

**Footprint: NOT an input.** Absolute width × depth cannot be specified; area is a soft per-room-type
objective (`home.py:354-382` via `graph.py:273-289`) and the aspect knob is damped.

**Door placement: NOT an input.** Aperture positions are uniform-random on shared edges
(`solidifier.py:549/565`).

**Clinical semantics: not available.** The floorplan room set is residential (balcony, bathroom,
bedroom, closet, dining-room, kitchen, living-room). A clinical-station vocabulary would be a custom
constraint program, not a gin flag.

So the factory contract that fits is: **one reproducible room per `environmentId`** (fixed seed +
config + post-process single-room extract), not "emit this exact bay from the case". The room is a
deterministic baked asset; clinical identity comes from the parametric fixtures the runtime already
places (the hybrid posture MADR 0050 step 10 and #271 both describe).

## Decision

Adopt a **first consumer**: `ed_exam_bay_v1` now loads a generated Infinigen room GLB in the ui-xr
station environment path, keyed by `environmentId`. The procedural `buildStationEnvironment` box is
kept as the fallback (unmapped ids and GLB load failures leave it visible; no deletion per §6p).

Concretely:

- **Asset.** `apps/ui-xr/public/xr-assets/environment/infinigen-ed-exam-bay.glb` (24,944 bytes,
  SHA-256 `1bddb589715d6ef4fb6cdeff2d72414daef81b42b154a7999e53a712bb990ba1`), baked from
  `clinical_bay.gin` seed 0 → single `dining-room_0` extracted post-process via mesh-name selection
  (the #236 technique) → Blender glTF export with floor top at y=0 and room centered at origin.
- **Measured room.** World bounds `[-3.25, -0.124, -3.25]..[3.25, 2.526, 3.25]` → 6.5 × 6.5 × 2.65 m.
  Wall mesh Euler characteristic −4 (door apertures survive). Blender-side: 1,128 tris, 3 materials;
  exported GLB: 4 meshes, 440 tris, 3 materials, 0 textures.
- **Runtime.** New module `apps/ui-xr/src/infinigen-station-environment.ts`: an
  `environmentId → asset` map, a loader that positions the room (floor top derived from the room's
  own `.floor` mesh, centered on the shell floor), hides the 6 procedural shell meshes on success,
  and reports status. `main.ts` calls it for the active `environmentId` after
  `scene.add(stationEnvironment)`.
- **Evidence.** Live runtime probe (`infinigen-runtime-probe.json`): status `loaded`, room present,
  6.5×2.65×6.5 m, 6 shell meshes hidden, procedural box retained. Room capture:
  `ed_chest_pain_priority_v1-room.png` (102 KB) under the same scenario's `scene-overview` mode.

## Measured fields

| Field | Value |
| --- | --- |
| generation wall-clock (`clinical_bay.gin` seed 0, coarse) | **33.7 s** (fresh #336 run; #271 reported 35–38 s) |
| reproducibility | identical footprint + room set across two independent seed-0 runs |
| room footprint (dining-room) | 6.5 × 6.5 m |
| room height | 2.65 m (wall_height pin) |
| wall aperture (Euler) | −4 (door openings baked into wall mesh) |
| room triangles (Blender measure) | 1,128 |
| room triangles (exported GLB) | 440 |
| GLB meshes / materials / textures | 4 / 3 / 0 |
| GLB size | 24,944 bytes |
| extract wall-clock | ~2 s (Blender mesh-name selection + export) |
| runtime load status | `loaded` (live probe) |
| procedural shell meshes hidden on load | 6 (floor, back/left/right walls, ceiling, trim) |

## Consequences

Positive:

- The six-slice "proven and unconsumed" gap (#71's named failure) is closed for one environment.
- The factory contract is honest: deterministic bake per `environmentId`, reproducible by
  seed+config, measured bounds, provenance recorded (PROVENANCE.md + this MADR).
- The procedural box remains the fallback, so no scenario regresses on GLB failure or unmapped ids.
- Triangle count is not a gate (operator standing direction; meshoptimizer runs later in the
  pipeline per MADR 0016/0050).

Negative / residual:

- **Only one environmentId** is wired; the asset map is a single row. More rooms = one bake + one
  map row each (the extract/#236 path generalises to any room in the deterministic floorplan).
- Footprint and door placement are still **not generator inputs**; the room is what seed 0 produced.
  A station needing a specific bay size still relies on the parametric shell or a custom constraint
  program (open, not this MADR).
- The extracted room is a **residential-scale dining-room**, not a clinically-authored bay; clinical
  identity is carried by the existing parametric fixtures.
- The GLB's wall/exterior mesh extends ~0.12 m below the floor slab; runtime places the floor top at
  y=0 and the below-slab part is hidden under the floor plane.

## Compliance and boundaries

- No cloud/paid APIs; no vendoring; Infinigen install remains under `~/.openclinxr-tools/infinigen`
  (BSD-3-Clause source; see licence ledger).
- `claimScope`: environmentId-keyed loading of a deterministic generated Infinigen room shell in the
  ui-xr station environment path, with the procedural box as fallback; reproducibility and bounds of
  that one room.
- `notEvidenceFor`: clinical room semantics, Quest worn readiness, clinical validity, exact-dimension
  parameterisation of the generator, scoring validity, production promotion.

## Evidence paths

```
.openclinxr/evidence/issue-336/infinigen-clinical-room.glb   (24,944 bytes; extracted dining-room)
.openclinxr/evidence/issue-336/infinigen-runtime-probe.json  (live load status)
.openclinxr/evidence/issue-336/ed_chest_pain_priority_v1-room.png  (scene-overview capture)
.openclinxr/evidence/issue-336/capture-manifest.json
apps/ui-xr/public/xr-assets/environment/infinigen-ed-exam-bay.glb  (shipped asset)
apps/ui-xr/public/xr-assets/environment/PROVENANCE.md
apps/ui-xr/src/infinigen-station-environment.ts  (+ .test.ts)
apps/ui-xr/src/main.ts  (loader call site)
```

Validate:

```bash
pnpm exec vitest run apps/ui-xr/src/infinigen-station-environment.test.ts
pnpm exec vitest run tools/openclinxr/evidence/infinigen-extract-single-room.test.ts
pnpm exec vitest run tools/openclinxr/evidence/infinigen-single-room-shell.test.ts
```

CLAIM: an Infinigen-generated room now reaches a learner in UI-XR, selected by `environmentId`
reproducibly (seed-0 bake, bounds measured), with the procedural box kept as the fallback.

NOT TESTED: a second environmentId row; live browser/WebXR worn-headset grading of the room;
decimation/LOD pass on the room; clinical-station vocabulary for Infinigen (custom constraint program).

## FIXED (#339) — constraint-language capability measured: bake-and-pin is the ceiling

#339 asked whether a CLINICAL room type can be authored with real constraints (footprint
bounds, door on a named wall) so `environmentId` drives GENERATION instead of seed selection.
Measured verdict: **NO as a factory input — reject_measured.** The constraint language is a real,
maintained authoring surface (seven test modules under `source/tests/constraints/` +
`source/tests/solver/`), but its measured limits are:

| axis | measured result | evidence |
| --- | --- | --- |
| Hard room-area bound | **expressible + enforced near the initial segmentation** | `cl.in_range` on a scalar (set_reasoning.py:92-105; evaluate.py:151-159 viol_count case). Dry probe: 5×5 m → viol 53 vs [78,84]; 9×9 m → viol 0. Feasible target [36,48] m² → dining room landed 41.25 m² in-bounds with anneal exploring (score 4.02e5→230). |
| Hard aspect-ratio bound | **expressible** (dry probe viol 0.4 for a square vs [1.4,1.6]) | `aspect_ratio` node (constraint_language/rooms.py:27-29); shipped program uses it softly (home.py:385-396) |
| Distant footprint target | **NOT satisfiable — anneal freezes** | hard [78,84] m² (2× shipped 42.25): score frozen at 4.25e5 across all 2000 proposals, ZERO acceptances, dining room stayed at the random initial 44.0 m². The anneal accepts only zero-violation states and move stride caps at 2.5 m (solver.py:28-33,77), so targets beyond one move from the random initial segmentation are unreachable through violated intermediates. Control: shipped program anneals normally (score 4.25e5→146). |
| Door on a named wall | **NOT expressible** | no wall/aperture node in the vocabulary; aperture position is uniform-random on the shared edge (solidifier.py:549/565); aperture type is a fixed room-pair probability table (solidifier.py:83-141). `RoomNeighbour` carries only `connector_types` (relations.py:124-170), set post-hoc. |
| Clinical room vocabulary | **not present** | `Semantics` enum (tags.py:32-72) is residential + office/warehouse; no exam-bay member; a custom tag is an install source edit. |
| `singleroom.gin` | **does NOT produce one room directly** | the config is `BlueprintSolidifier.enable_open=False` + `restrict_solving.solve_max_rooms=1`; `solve_max_rooms` limits object placement only (generate_indoors_util.py:220). #234 measured `multi_room_still` (20 wall meshes). Extraction remains necessary. |

So MADR 0043's corrected `extensible_with_custom_constraints` is itself corrected by measurement:
a custom constraint program can **reshape the footprint of a chosen seed** (area + aspect hard
bounds, when the target is near the random initial segmentation) but cannot **author a clinical
bay** — door placement is unexpressible and distant footprint targets freeze the annealer.
`environmentId` drives **selection** of a baked asset, never **generation**. The
bake-and-pin factory contract in this MADR stands, with constraint tweaks as an optional
per-seed refinement (e.g. forcing a non-square aspect on a fresh seed hunt).

Evidence: `.openclinxr/evidence/issue-339/constraint-language-capability.json` (dry probes,
two generation runs with hard bounds, shipped control; generation runs at seed 0 +
`clinical_bay.gin`, coarse, 35.8 s / 37.5 s vs the 33.7 s baseline).

CLAIM: the Infinigen constraint language can express hard room-area/aspect bounds that the
room annealer honours only near the random initial segmentation, cannot express door
placement, and `singleroom.gin` does not bypass extraction — bake-and-pin is the ceiling.

NOT TESTED: a longer/multi-move anneal schedule (e.g. `solve_steps` increases) reaching a
distant footprint target; editing the install to add a clinical `Semantics` member; a custom
`RoomGraphFactory`/`SegmentMaker` that sizes segments from the constraint program rather than
random subdivision.
