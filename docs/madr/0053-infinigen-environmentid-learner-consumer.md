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
