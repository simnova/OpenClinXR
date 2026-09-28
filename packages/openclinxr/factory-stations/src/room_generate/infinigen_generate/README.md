# room_generate Infinigen GENERATE step (fixed-footprint)

Promoted, generalized evidence from the sibling stage-2 work
(`wt/infinigen-room`, `infinigen-patches/`): the fixed-footprint State
injection that bypasses `FloorPlanSolver` annealing and runs the REAL
`BlueprintSolidifier`, proven to land an 8.77 x 7.77 m interior clear floor
within 1 mm. The stage-2 door pin was hardcoded to the +y wall at x=+0.50;
here the wall and along-wall offset are parameters (`--door-wall`,
`--door-offset`).

## Files

- `run_fixed_footprint.py` — generation driver (`python -m
  run_fixed_footprint` from the Infinigen source dir, `PYTHONPATH` pointing
  here). Monkeypatches `Solver.solve_rooms` (hand-built pre-solidify State),
  suppresses window boolean cutters at the source, and pins the
  entrance/door cutter on the REQUESTED wall (upstream `make_exterior_cutters`
  takes the longest wall via `max_mls`, so short-wall doors need the
  `_fixed_exterior_cutters` override, not just a cutter override).
- `fixed_footprint_state.py` — parametric pre-solidify State builder.
  `configure(interior_width, interior_depth, wall_thickness, door_wall,
  door_offset)`; defaults reproduce the stage-2 reference exactly.
- `strip_room_shell_placeholders.py` — verbatim promotion of the stage-2
  extract pre-pass: deletes the uncut shell placeholders from a COPY of the
  generation blend so the extract exports only wall/floor/ceiling/exterior.
- `probe_door.py` — reads the generated scene.blend and reports the interior
  floor AABB plus door leaf / casing / entrance-cutter locations as JSON
  (door-placement evidence; the shell-only extract drops door objects by
  production convention).
- `0001-room-walls-concrete-vertical-kwarg.patch` — versioned Infinigen source
  patch (widens the upstream Brick guard to `("Brick", "Concrete")` in
  `room_walls`, `decorate.py`). Target revision `b11700eb` (v1.14.0).
- `0003-room-walls-plaster-floors-rug-realism-env.patch` — versioned
  Infinigen source patch (pins `room_walls` to Plaster, pins that Plaster
  draw to neutral `plaster_colored=False` via `kwargs` -- `Plaster` takes
  no constructor args, the flag rides `generate()`/`apply()` only --
  skips the wainscot/alternative pass, and pins `room_floors` to Rug when
  `OPENCLINXR_ROOM_REALISM=1`, `decorate.py`). Same target revision.
  The floor pin to Rug is a placeholder S5 replaces with vinyl; the wall
  pin to Plaster is the S4 contract. Applies after 0001 (its
  Plaster-branch hunk builds on 0001's Brick/Concrete guard, so
  `apply-patches.sh` applies the files sequentially, not in one call).
- `apply-patches.sh` — applies the patches to a fresh tool install.

## Fresh Infinigen install

```sh
git -C ~/.openclinxr-tools/infinigen/source rev-parse HEAD  # expect b11700eb
sh packages/openclinxr/factory-stations/src/room_generate/infinigen_generate/apply-patches.sh
# dry run first: sh apply-patches.sh --check-only
```

The current tool install already carries these fixes live (plus unrelated
live-only edits that stay out of these patches: the casing bevel-weight fix,
the terrain `__init__` re-export).
The driver additionally needs the `door_params` / `window_params` /
`populate_windows` `@gin.configurable` bindings (sibling `0002` patch),
which the tool install also carries live; the driver fails closed with the
gin error if a fresh install lacks them.

## Conventions

- Door offset is measured from the wall midpoint along the wall tangent:
  toward +x for `+y` / `-y` walls, toward +y for `+x` / `-x` walls.
  `+y` at +0.50 reproduces the stage-2 pin (door east of wall center).
- Hinge side is recorded in the station report only; the cutter is
  symmetric and leaf posing is a separate future card (no door animation
  here).
- `widthM` maps to `door_params.door_width_ratio` via
  `widthM / (1.4 - wall_thickness)` (1.4 is the `segment_margin` default
  every config on this path keeps); `heightM` maps to `door_size`
  directly. Absent, the driver passes no binding and Infinigen defaults
  apply.
- Determinism: `wall_thickness` is always pinned in gin (the polygon is
  grown by wt/2 per side, so the binding must match); `seed` flows straight
  through (`-s`); the entrance cutter performs no RNG draw.
- Ceiling compensation: the station passes
  `--wall-height = ceilingHeight + wall_thickness`, because the interior
  clear height is `wall_height - wall_thickness` (measured seed 203:
  floor-slab top at +wt/2, ceiling plane at wall_height - wt/2).
