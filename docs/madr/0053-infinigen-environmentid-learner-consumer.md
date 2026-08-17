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

- **Asset.** `apps/ui-xr/public/xr-assets/environment/infinigen-ed-exam-bay.glb` (2,184,544 bytes,
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

## FIXED (#342b) — the product's own camera, and how small the room can be generated

Two halves, both measured. `#342` had fixed only the CAPTURE camera; the product's default
camera was still outside the closed shell, and nobody had probed the room area downward.

### Half 1 — the learner's camera stood outside a closed room (product decision)

Measured with the scene-graph dump run with the capture mode OFF, which is new: it had always
forced `openclinxrCaptureMode=scene-overview`, so no instrument in the repo had ever measured
the camera a learner actually gets.

| | measured |
| --- | --- |
| product default camera, world | `[0, 1.48, 4.73]`, fov 55, `wide_clean_dynamic_encounter_room_review_three_actor_context` |
| room interior, world | `z -4.025 .. 2.3505` |
| exterior hull, world | `z -4.025 .. 2.4750` (176 tris, **no material**) |
| camera beyond the +Z interior face | **2.379 m** |
| viewport | **flat grey field** — every sample a uniform neutral grey (145,145,145) |

Three options; the two rejected were rejected by measurement, not taste:

- **Move the room** — a >= +2.4 m shift puts the far wall at `z >= -1.63`, inside the measured
  `ed_environment` extent (`z -2.09`) and 1.0 m behind the patient (`z -0.62`). Furniture and
  cast would intersect the wall.
- **Open the shell** — there is no +Z wall to hide. `gltf-transform` reports four
  single-primitive meshes (`wall` 190 tris / `floor` 44 / `ceiling` 30 / `exterior` 176); all
  four walls are ONE mesh, so opening it means deleting faces from a baked mesh by hand, per
  bake (D1).
- **Move the camera — CHOSEN.** The product already calls this offset
  `desktopPreviewCameraOffsetZ` (`main.ts:3157`): it is a flat-preview pull-back, not the
  learner's position. The locomotion rig, which IS the learner, already stands at the origin
  inside the room, and in an XR session three.js drives the camera from the headset pose so the
  offset never applies. The defect is scoped to the flat desktop preview.

`deriveInteriorPreviewCamera` now lives in the PRODUCT (`infinigen-station-environment.ts`,
unit-tested) rather than only in the capture harness's untested browser IIFE — the split that
let "the capture works" and "the learner sees grey" both be true. Only the product's own wide
default framing is re-derived; the capture framings target a specific subject and are untouched.
Post-fix the eye lands at `[-3.001, 1.466, 2.102]`, inside the interior, 2.0 m from the nearest
actor, and the viewport shows floor, walls, doorway, wall board, stretcher and all three actors.

**A change measured and REVERTED, recorded so nobody re-derives it:** hiding the untextured
exterior hull. Justified as removing the residual grey and as making "camera outside the room"
fail loudly instead of as a confident grey render. Both false — from inside the viewport was
byte-identical, and from outside, hiding the hull merely exposes the wall's outer face, so the
blank field went from (145,145,145) to (229,228,222) and stayed just as confident.

**Residual, named:** warm-grey wedges at the top-left and right frame edges. NOT the hull
(control/treatment above). They are the room's own plaster walls at grazing incidence — sampled
(154,152,142) against the same wall's face-on (229,228,222), a uniform 0.67x of the same hue,
i.e. less light on the same material, not a hole. The eye stands 0.1245 m from two walls. This
is framing quality and is present identically in the landed #342 capture.

### Half 2 — the room CAN be generated much smaller, and the limit is the band's upper edge

#339 measured `[36,48]` m2 feasible and `[78,84]` infeasible. Probing DOWNWARD (17 runs, seed 0
+ `clinical_bay.gin`, coarse, ~2 min each; footprint re-measured from each `scene.blend`):

| area bound | aspect bound | anneal | measured | satisfied |
| --- | --- | --- | --- | --- |
| [30,40] | [1.2,1.7] | explores 4.1e5 -> 279 | 38.50 (7.0 x 5.5) | yes |
| [32,38] | [1.2,1.7] | explores -> 236 | 32.50 (6.5 x 5.0) | yes |
| **[12,38]** | **[1.2,1.7]** | **explores -> 227** | **19.25 (5.5 x 3.5), aspect 1.571** | **yes** |
| [12,38] rerun | [1.2,1.7] | -> 227 | 19.25, identical | yes (deterministic) |
| [30,36] / [26,34] / [24,32] / [22,27] / [12,30] / [12,24] / [12,18] | [1.2,1.7] | **FROZEN** | 44.0 (untouched initial) | no |
| [22,26] / [36,48] / [12,38] | **[1.9,2.2]** | **FROZEN** | 44.0 | no |

- **Reachable minimum: 19.25 m2 (5.5 x 3.5 x 2.65)** — 2.1x smaller than the shipped 40.66 m2,
  and its 3.5 m depth is within 0.05 m of the authored bay's 3.45 m. Deterministic on rerun.
- **The band's UPPER edge is the gate, not the lower one.** Every band with an upper edge <= 36
  froze at the initial 44.0 m2 (7 runs); every band with an upper edge >= 38 explored (6 runs).
  Boundary bracketed between 36 and 38 — the anneal accepts only zero-violation states, so it
  must be able to reach the band from the random initial segmentation.
- **Once admissible, the lower edge pulls.** Upper held at 38: lower 26 -> 38.5, lower 20 ->
  38.5, lower 12 -> 19.25. `in_range` is flat inside the band, so where it settles is set by the
  shipped soft objective (`home.py:354-382`, DiningRoom at 20 m2 with a `hinge(0,0.4)` dead zone
  spanning 13.4-29.8 m2) — which is why the deepest band lands at 19.25.
- **The authored aspect 2.029 is unreachable at every area tried.** `[1.9,2.2]` froze at
  `[22,26]`, at the proven-feasible `[36,48]`, and at the reachable-minimum `[12,38]`. Aspect is
  a harder blocker than area: the authored `ed_exam_bay_v1` 7 x 3.45 bay (24.15 m2, aspect 2.029,
  `environment-descriptors.ts:136-142`) fails on BOTH axes.
- **The shipped config sets no area bound at all.** `clinical_bay.gin` carries `wall_height`,
  `wall_thickness` and `aspect_ratio_range` only, so the one proven control is unused.

The smaller room is **not baked into the product here.** A 5.5 m-wide room spans `x +-2.75`; the
authored ED fixtures are placed for the 7.0 m parametric box, with the wall board at `x -3.99`
and a door leaf reaching `x 3.52` — both would fall outside the new walls. Fixture re-placement
is the gating next slice, not a tail-end addition.

CLAIM: the product's default flat-preview camera now stands inside the generated room and draws
the encounter for `ed_chest_pain_priority_v1`; and the generated room's footprint is reachable
down to a deterministic 19.25 m2 when the hard area band's upper edge stays within reach of the
initial segmentation.

NOT TESTED: the capture-mode framings (face detail, actor close, actor pose, generated scene
overview), still authored for the open parametric box and deliberately unchanged; any
`environmentId` other than `ed_exam_bay_v1`; XR-worn behaviour (in a session three.js drives the
camera from the headset pose, so this path does not run); clinical realism of any footprint; a
second seed (every run is seed 0); areas below 19.25 m2 by another route (longer anneal
schedule, `solve_steps`, or a custom `SegmentMaker` were not tried); the 36/38 reachability
boundary at finer resolution.

## FIXED (#342 final, 2026-08-14) — the aspect declaration is measured, and it is unreachable on the shipped path

The planted RED (`the-shipped-room-matches-its-declared-shape.test.ts`) asserts the shipped
room's floor aspect falls inside the declared `aspect_ratio_range=(2.0,2.1)` — and it fails
today (floor aspect 1.000). The header hypothesised three explanations. All three are now
measured against the shipped config chain (`base_indoors.gin` + `disable/clinical_bay.gin`,
seed 0, overrides `compose_indoors.terrain_enabled=False`), by instrumenting the solver
directly:

| hypothesis | measured verdict | evidence |
| --- | --- | --- |
| (1) aspect unbound — never reaches the solver | **FALSE** | `RoomConstants.aspect_ratio_range = (2.0, 2.1)` after gin; `suggest_dimensions` (graph.py:273-289) computes contour **24.5 × 12.0 (aspect 2.04)** |
| (2) unbindable — not `@gin.configurable` | **FALSE** | it is a constructor arg of `@gin.configurable RoomConstants` (constants.py:22-48) and binds |
| (3) binds the floorplan; extraction discards it | **TRUE, with a correction to the mechanism** | the knob binds the floorplan's **initial contour only**. The room anneal reshapes rooms freely (`fixed_contour=False`, home.py:63), and the shipped program's soft objective `aspect_ratio().log()` at weight 50 (home.py:385-391) drives kitchen/bedroom/living/dining rooms to aspect 1.0. The extraction (mesh-name selection, #236) then picks dining-room_0 — square because the anneal *made* it square, not because the extraction dropped a bound the room had honoured |

**The declared aspect is unreachable on the shipped path.** Seed sweep (0-3, same config chain,
floorplan solve only, ~36 s each): dining-room aspect **1.00 / 1.10 / 1.00 / 1.00** — square in
every seed; the only elongated rooms (seed 3: garage 8.0 × 4.0 aspect 2.00, hallway 3.0 × 7.5
aspect 2.50) are not the extract target and are not clinically plausible. The existing seed-0
floorplan contains **no room in [2.0, 2.1]** (closet_0 at aspect 3.83 is the only ≥2.0 room,
outside the band). So the extraction-picking fix is impossible without regeneration, and
regeneration on the shipped path cannot produce it — the aspect knob never reaches the room
level.

**The config's own declared target is a hard measured ceiling.** `clinical_bay.gin`'s header
states the target: `ed_exam_bay_v1 (7.0 x 3.45 x 2.65 m)` — 24.15 m2 at aspect 2.03. Probed via
the constraint-language surface (#339's API) with hard bounds area **[24,25]** + aspect
**[2.0,2.1]**: the anneal **froze at 4.25e5 — zero acceptances in 2000 proposals** (2197/2197
progress lines at the initial score), dining room stuck at 7.0 × 9.0 (aspect 1.286, area 63).
This is the exact #339 `[78,84]` failure mode, probed downward at the config's own target: the
authored bay fails on BOTH axes, confirming #342b's conclusion with the direct [24,25] probe.

**Refinement to #342b's blanket "aspect 2.029 unreachable at every area tried":** the aspect
bound alone is NOT the blocker. With a generous area band **[10,60]** + aspect **[2.0,2.1]**, the
anneal EXPLORED (4.25e5 → 236) and landed the dining room at **4.5 × 9.0, aspect 2.000** (area
40.5). The blocker is the COMBINED area+aspect target: a tight area band freezes the anneal
before the aspect reshape can complete (the anneal accepts only zero-violation states, solver
acceptance rule floor_plan.py:164). #342b's probes all used upper edges ≤ 48, which is why
they all froze.

**Under this measured outcome nothing in the product changes; the RED documents the mismatch.**
The shipped room does not match its declared aspect, the declaration is not rewritten (the test's
clause (3) refuses it — it is the only surviving statement of intent), and the room stays the
deterministic 6.5 × 6.5 seed-0 bake. The issue's product fix (bake the reachable 19.25 m2 room +
re-place the authored fixtures) remains #342b's named gating next slice.

CLAIM: on the shipped path, `aspect_ratio_range` binds the floorplan contour (24.5 × 12.0) and
never the rooms — the soft square objective (home.py:385-391) makes the extracted dining room
square in every seed, so the declared [2.0,2.1] is unreachable; and the config's own 24.15 m2
target freezes the constraint-language anneal (0/2000 acceptances), the #339 ceiling probed
downward.

NOT TESTED: a second seed sweep beyond 0-3 on the full coarse pipeline (mesh + bake); a longer
anneal schedule reaching [24,25] (e.g. `solve_steps` increases); baking the 19.25 m2 room and
re-placing fixtures (the named gating slice); any `environmentId` other than `ed_exam_bay_v1`.

---

## CORRECTION 2026-08-17 — "the hull contributes nothing from inside" is FALSE for a second room

`infinigen-station-environment.ts` §342b records hull-hiding as **MEASURED AND REJECTED**, on the
grounds that *"from inside, the hull is back-face culled and contributes nothing — byte-identical at
every sampled point."*

**That measurement is correct for `infinigen-ed-exam-bay` and was written as a property of hulls in
general. It does not generalise.** On `infinigen-pediatric-urgent-care-bay` (#405 → #406 → #407) the
hull occludes the interior view completely.

Measured live at the derived interior camera `(-2.42, 1.70, 1.90)`, viewport non-black share:

| state | non-black | mean luma |
|---|---|---|
| baseline, hull visible | **0.3 %** | 0.5 |
| **hull hidden** | **97.4 %** | 44.6 |
| hull restored | 0.3 % | 0.5 |
| every material forced `DoubleSide` | 0.3 % | 0.5 |

The toggle reverses cleanly, so this is a controlled result. Forcing `DoubleSide` changes nothing, so
it is **not** a face-winding / back-face-culling question — the hull is drawn opaque in front of the
camera in this room and is not in the ED bay.

**NOT DETERMINED: why the two rooms differ.** Both carry hull vertices inside the interior volume in
similar proportion (peds 7/162, ED 6/184), so "the hull intrudes" does not discriminate them.

Twelve hypotheses were tested for the peds black frame — camera placement, world→local rig conversion,
projection near/far, frustum occupancy, frame-loop overwrite, materials, lighting, room presence,
corridor aspect, canvas read-back, hull intrusion, face winding. **Hiding the hull is the only one that
moved the pixels.**

**This does NOT re-authorise hiding the hull.** That is a runtime workaround and the right layer may be
the extraction that produces the hull. What it retires is the belief, held in the source since #342,
that hull visibility cannot affect an interior view. It can, and that belief cost several cycles of
looking elsewhere (§6e: a correct instrument on one subject does not bound the class).

**Detection is already gated:** `a-station-capture-is-not-a-black-frame.test.ts` (`ac668cfb`) fails
mechanically when a station's viewport goes black, so this condition cannot ship green again.
