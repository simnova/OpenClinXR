#!/usr/bin/env python3
# Copyright (C) 2026 OpenClinXR. Fixed-footprint generation driver.
# Promoted from /Volumes/files/src/openclinxr-wt/infinigen-room
# tools/openclinxr/asset-pipeline/environment/infinigen-patches/run_fixed_footprint.py
# and GENERALIZED: footprint dimensions, door wall, and door offset are CLI
# flags (defaults reproduce the room-dimensions-fix reference: 4.3 x 3.9 m
# interior, door on +y at x=+0.25).
#
# Bypasses FloorPlanSolver annealing: monkeypatches Solver.solve_rooms to
# hand-build the single-room pre-solidify State (fixed_footprint_state) and
# run it through the REAL BlueprintSolidifier, so all downstream stages
# (doors, skirting, materials) consume the genuine post-solidify shape.
#
# WHY patch solve_rooms (option b) rather than room_solver_fn (option a):
# room_solver_fn must return an object whose .solve() yields the
# (state, unique_roomtypes, dimensions) triple, forcing dummy x/y values
# downstream never reads; patching solve_rooms is one assignment that sets
# self.state and returns it, with no invented return slots.
#
# Usage (from the Infinigen source dir; all gin bindings on ONE -p flag --
# argparse has no action="append", so a repeated -p keeps only the last):
#   PYTHONPATH=<this-dir> ../venv/bin/python -m run_fixed_footprint \
#     --output_folder <out> -s 203 \
#     -g singleroom disable/clinical_single_furnished \
#     --interior-width 4.3 --interior-depth 3.9 \
#     --door-wall +y --door-offset 0.25 \
#     [--door-style lite] \
#     -p compose_indoors.terrain_enabled=False compose_indoors.room_windows_enabled=False compose_indoors.solve_large_enabled=False compose_indoors.solve_medium_enabled=False compose_indoors.solve_small_enabled=False populate_doors.n_doors=3 \
#     -t coarse
#
# Gin bindings the driver appends itself (so callers pass metres, not ratios):
#   RoomConstants.global_params.wall_thickness=<--wall-thickness> (REQUIRED
#     pin: the polygon is grown by wt/2 per side, so the binding must match
#     or the interior clear floor drifts by the mismatch per axis),
#   RoomConstants.global_params.wall_height=<--wall-height> (only when given),
#   door_params.door_width_ratio=<widthM/(SEGMENT_MARGIN-wt)> (only when
#     --door-width-m is given; SEGMENT_MARGIN=1.4 is the global_params
#     default, kept by every config on this path),
#   door_params.door_size=<--door-height-m> (only when given; default
#     bindings otherwise reproduce the proven 0.95 x 2.10 m leaf sizing via
#     the 0002 gin-configurable patch, which the tool install carries).

import argparse
import os
from pathlib import Path

# Must match RoomConstants.global_params segment_margin default (1.4),
# which no config on this generation path overrides. door_width =
# (segment_margin - wall_thickness) * door_width_ratio.
SEGMENT_MARGIN = 1.4


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output_folder", type=Path)
    parser.add_argument("-s", "--seed", default=None)
    parser.add_argument("-t", "--task", nargs="+", default=["coarse"])
    parser.add_argument("-g", "--configs", nargs="+", default=[])
    # action="append" + flatten: upstream generate_indoors.py uses bare
    # nargs="+" (no append), so a repeated -p silently keeps only the last
    # binding. Accept both spellings here.
    parser.add_argument("-p", "--overrides", nargs="+", action="append", default=[])
    parser.add_argument("--task_uniqname", default=None)
    parser.add_argument("--interior-width", type=float, default=4.3)
    parser.add_argument("--interior-depth", type=float, default=3.9)
    parser.add_argument("--wall-thickness", type=float, default=0.22)
    parser.add_argument("--door-wall", default="+y")
    parser.add_argument("--door-offset", type=float, default=0.25)
    parser.add_argument("--wall-height", type=float, default=None)
    parser.add_argument("--door-width-m", type=float, default=None)
    parser.add_argument("--door-height-m", type=float, default=None)
    # Optional door-factory pin. Absent keeps the upstream random draw
    # (random_door_factory weights [4,2,3,3]); present bypasses it.
    # "lite" is the vision-lite leaf the Imagine reference shows.
    parser.add_argument(
        "--door-style",
        choices=["panel", "glass_panel", "louver", "lite"],
        default=None,
    )
    # Ward-door pins (all deterministic constants, no RNG draws; each joins
    # the room_chain stage cache key via the driver file hash plus the
    # verbatim stage params in generate.ts/run.ts). Absent keeps upstream
    # behaviour. Pins require --door-style (applying them to a random-draw
    # factory would pin only half the draw).
    #
    # Infinigen-first audit (ward door defect, seed-205 chain):
    # - style lite: LiteDoorFactory selectable (doors/lite.py) -- TAKEN.
    # - handle lever: BaseDoorFactory.handle_type draws
    #   choice(["knob","lever","pull"]) (doors/base.py:56) with no gin
    #   binding -- pinned here via subclass override -- TAKEN.
    # - flush leaf: every factory routes through PanelDoorFactory.bevel
    #   (doors/panel.py), whose recess depth is bevel_width,
    #   uniform(0.005, 0.01) (doors/base.py:46), not gin-configurable --
    #   pinned here to 2.5 mm so the lite-frame step stays inside the
    #   3 mm DONE-WHEN band -- TAKEN.
    # - narrow vision lite: LiteDoorFactory dims draw uniform() branches
    #   (doors/lite.py) with no parameter -- pinned here to the ref
    #   fractions (about 0.12 m wide x 0.55 m tall, upper handle-opposite
    #   half) -- TAKEN.
    # - casing 50-60 mm: DoorCasingFactory.margin is a fixed 0.11
    #   (doors/casing.py:32), surface random metal/wood (casing.py:35) --
    #   margin pinned here; surface bake lands in shell_bake_trim and the
    #   finish repaints the casing to the specced light frame -- TAKEN.
    # - hinges / lock cylinder: no Infinigen hinge or lock class exists
    #   (no "hinge" symbol anywhere under assets/objects/elements/doors/)
    #   -- NOT FOUND in Infinigen; hinges are finish-added geometry,
    #   the cylinder is skipped (handle x is unrecoverable post-merge).
    # - vision glass: LiteDoorFactory cuts the opening and assigns a glass
    #   selection, but bake_shell_materials.assign_role_material clears
    #   every slot into one shell_bake_trim material, so the lite bakes
    #   and reads as wood -- NOT FOUND in Infinigen-through-our-bake;
    #   the finish adds the glass pane plus its steel frame.
    parser.add_argument(
        "--door-handle",
        choices=["knob", "lever", "pull"],
        default=None,
    )
    parser.add_argument("--door-lite-rect", default=None,
                        help='"xmin,xmax,ymin,ymax" leaf fractions, e.g. "0.64,0.80,0.58,0.87"')
    parser.add_argument("--door-bevel-mm", type=float, default=None)
    parser.add_argument("--door-casing-margin-m", type=float, default=None)
    args = parser.parse_args()
    args.overrides = [b for group in args.overrides for b in group]

    # S4 shell contract: this driver only serves the ward chain, so default
    # the realism pin on here too. An explicit caller env still wins
    # (setdefault), and generate.ts always sets it on the spawn env.
    os.environ.setdefault("OPENCLINXR_ROOM_REALISM", "1")

    import fixed_footprint_state as ffs

    ffs.configure(
        interior_width=args.interior_width,
        interior_depth=args.interior_depth,
        wall_thickness=args.wall_thickness,
        door_wall=args.door_wall,
        door_offset=args.door_offset,
    )

    # Pin wall_thickness in gin (polygon math depends on it) plus the
    # optional metric bindings; caller -p bindings ride alongside on one list.
    gin_extra = [
        f"RoomConstants.global_params.wall_thickness={args.wall_thickness}",
    ]
    if args.wall_height is not None:
        gin_extra.append(f"RoomConstants.global_params.wall_height={args.wall_height}")
    if args.door_width_m is not None:
        ratio = args.door_width_m / (SEGMENT_MARGIN - args.wall_thickness)
        if not (0 < ratio < 1):
            raise SystemExit(
                f"--door-width-m {args.door_width_m} gives door_width_ratio "
                f"{ratio:.4f} outside (0, 1) with segment_margin {SEGMENT_MARGIN} "
                f"and wall_thickness {args.wall_thickness}"
            )
        gin_extra.append(f"door_params.door_width_ratio={ratio}")
    if args.door_height_m is not None:
        gin_extra.append(f"door_params.door_size={args.door_height_m}")
    args.overrides = gin_extra + args.overrides

    from infinigen.core import init, execute_tasks
    from infinigen.core.constraints.example_solver.room.solidifier import (
        BlueprintSolidifier,
    )
    from infinigen.core.constraints.example_solver.solve import Solver
    from infinigen_examples.generate_indoors import compose_indoors

    # Option (b): skip room_solver_fn entirely; hand-build the pre-solidify
    # State and solidify it with the real BlueprintSolidifier (gin injects
    # enable_open=False from singleroom.gin at this call site, same as the
    # FloorPlanSolver path). ContourFactory.decorate is NOT run: it perturbs
    # polygons and would move the exact footprint.
    # solve.py:134-136 replaced in full:
    #   def solve_rooms(self, scene_seed, consgraph, filter):
    #       self.state, _, _ = self.room_solver_fn(scene_seed, consgraph).solve()
    #       return self.state
    def _fixed_solve_rooms(self, scene_seed, consgraph, filter):
        pre, graph = ffs.build_fixed_pre_state(consgraph)
        solidifier = BlueprintSolidifier(consgraph, graph, 0)
        post, _rooms_meshed = solidifier.solidify(pre)
        self.state = post
        print(
            "[fixed_footprint] solve_rooms injected: "
            f"{list(post.objs)}",
            flush=True,
        )
        return self.state

    Solver.solve_rooms = _fixed_solve_rooms
    print("[fixed_footprint] patched Solver.solve_rooms (option b)", flush=True)

    # Suppress window boolean CUTTERS at the source. room_windows_enabled=False
    # only gates populate_windows (the factory objects); the wall cutters are
    # made unconditionally by BlueprintSolidifier.make_exterior_cutters
    # (solidifier.py:488-513): the entrance room is skipped in the window loop
    # (:493-494) but the second loop (:504-512) always builds window cutters
    # on the wall remainder after the entrance cutter, and make_window_cutter
    # (:584-586) emits one cutter per wall segment longer than door_width with
    # no probability gate (window_rooms at :146 and wall_cut_prob at :157 are
    # defined but never referenced anywhere in infinigen/ -- dead code,
    # verified by grep). Overriding the single cutter factory keeps
    # door/entrance/open cutters untouched (this room has no shared interior
    # edges, so no interior window/panoramic cutters exist to lose).
    def _no_window_cutters(self, mls, is_panoramic):
        print(
            "[fixed_footprint] window cutter suppressed "
            f"(is_panoramic={is_panoramic})",
            flush=True,
        )
        return []

    BlueprintSolidifier.make_window_cutter = _no_window_cutters
    print("[fixed_footprint] patched BlueprintSolidifier.make_window_cutter (-> [])", flush=True)

    # Deterministic door pin, generalized to any of the four walls. Upstream
    # make_exterior_cutters takes max_mls (the LONGEST wall) and
    # make_entrance_cutter draws lam = uniform(m/length, 1-m/length), so the
    # door center moved per seed AND could never sit on a short wall. This
    # override replicates the upstream exterior-cutter body except the wall
    # segment comes from select_wall_segment (the configured door wall, fail
    # closed when absent) instead of max_mls; window cutters on the remainder
    # are suppressed (same as _no_window_cutters above).
    def _fixed_exterior_cutters(self, exterior_edges, exterior):
        from collections import defaultdict
        from infinigen.core.constraints.example_solver.room.solidifier import split_mls

        window_cutters = defaultdict(list)
        entrance_cutters = defaultdict(list)
        entrance = self.graph.entrance
        for k, mls in exterior_edges.items():
            if k == entrance and self.level == 0:
                segments = list(split_mls(mls))
                x, y, x_, y_ = ffs.select_wall_segment(segments)
                from shapely.geometry import LineString

                ls = LineString([(x, y), (x_, y_)])
                cutter = self.make_entrance_cutter(ls)
                entrance_cutters[k].append(cutter)
            # Non-entrance rooms (none in the single-room graph) and the wall
            # remainder get no window cutters: suppressed at the source.
        return window_cutters, entrance_cutters

    BlueprintSolidifier.make_exterior_cutters = _fixed_exterior_cutters
    print("[fixed_footprint] patched BlueprintSolidifier.make_exterior_cutters (door-wall select)", flush=True)

    # Pinned entrance cutter, axis-aware. Replicates the upstream body exactly
    # except lam is derived from the configured door wall + offset (no RNG
    # draw remains). Rotation convention is unchanged, so the downstream leaf /
    # casing parent frame stays factory-native, only deterministic.
    def _pinned_entrance_cutter(self, mls):
        import numpy as np
        from infinigen.assets.utils.object import new_cube
        from infinigen.core import tags as t
        from infinigen.core.constraints.example_solver.room.solidifier import (
            _snap,
            max_mls,
        )
        from infinigen.core.util import blender as butil

        wall, center = ffs.door_target()
        x, y, x_, y_ = max_mls(mls)
        c = ffs.wall_coordinate(wall)
        if wall in ("+y", "-y"):
            if abs(y - c) > 1e-3 or abs(y_ - c) > 1e-3:
                raise RuntimeError(
                    "[fixed_footprint] pinned door wall mismatch: "
                    f"segment y {y:.4f}->{y_:.4f} != {wall} face {c:.4f}"
                )
            lam = (center - x_) / (x - x_)
        else:
            if abs(x - c) > 1e-3 or abs(x_ - c) > 1e-3:
                raise RuntimeError(
                    "[fixed_footprint] pinned door wall mismatch: "
                    f"segment x {x:.4f}->{x_:.4f} != {wall} face {c:.4f}"
                )
            lam = (center - y_) / (y - y_)
        length = np.linalg.norm([y_ - y, x_ - x])
        m = self.constants.door_margin + self.constants.door_width / 2
        if not (m / length <= lam <= 1 - m / length):
            raise RuntimeError(
                "[fixed_footprint] door offset out of cutter range: "
                f"lam={lam:.4f}, allowed [{m / length:.4f}, {1 - m / length:.4f}]"
            )
        wt = self.constants.wall_thickness
        cutter = new_cube()
        cutter.scale = (
            self.constants.door_width / 2,
            self.constants.door_width / 2 + wt,
            self.constants.door_size / 2 - _snap / 2,
        )
        cutter.location[-1] += _snap / 2
        butil.apply_transform(cutter, True)
        cutter.location = (
            lam * x + (1 - lam) * x_,
            lam * y + (1 - lam) * y_,
            self.constants.door_size / 2 + wt / 2,
        )
        cutter.rotation_euler = 0, 0, np.arctan2(y_ - y, x_ - x)
        cutter.name = t.Semantics.Entrance.value
        self.tag(cutter)
        print(
            "[fixed_footprint] pinned entrance cutter "
            f"x={cutter.location[0]:.4f} y={cutter.location[1]:.4f} (lam={lam:.4f})",
            flush=True,
        )
        return cutter

    BlueprintSolidifier.make_entrance_cutter = _pinned_entrance_cutter
    print("[fixed_footprint] patched BlueprintSolidifier.make_entrance_cutter (pinned)", flush=True)

    scene_seed = init.apply_scene_seed(args.seed)
    # Optional door-style pin (Task: door.style). Upstream populate_doors
    # builds its factories via random_door_factory() (weights [4,2,3,3]),
    # imported by name into the decorate namespace -- so BOTH bindings are
    # patched to return the requested class. decorate.populate_doors then
    # draws the pinned factory for every door without further changes.
    # Absent --door-style leaves both bindings untouched (random draw).
    if args.door_style is not None:
        from infinigen.assets.objects.elements import doors as doors_mod
        from infinigen.assets.objects.elements.doors.lite import LiteDoorFactory
        from infinigen.assets.objects.elements.doors.louver import LouverDoorFactory
        from infinigen.assets.objects.elements.doors.panel import (
            GlassPanelDoorFactory,
            PanelDoorFactory,
        )
        from infinigen.core.constraints.example_solver.room import decorate as room_decorate

        pinned = {
            "panel": PanelDoorFactory,
            "glass_panel": GlassPanelDoorFactory,
            "louver": LouverDoorFactory,
            "lite": LiteDoorFactory,
        }[args.door_style]

        def _pinned_door_factory():
            return pinned

        doors_mod.random_door_factory = _pinned_door_factory
        room_decorate.random_door_factory = _pinned_door_factory
        print(f"[fixed_footprint] pinned door factory to {pinned.__name__}", flush=True)

    # Ward-door detail pins (require --door-style; see the flag help above
    # for the Infinigen-first audit). All constants replace post-draw
    # values, so no RNG sequence downstream shifts.
    ward_pins = (
        args.door_handle is not None
        or args.door_lite_rect is not None
        or args.door_bevel_mm is not None
        or args.door_casing_margin_m is not None
    )
    if ward_pins and args.door_style is None:
        raise SystemExit("run_fixed_footprint: door detail pins require --door-style")
    lite_rect = None
    if args.door_lite_rect is not None:
        try:
            lite_rect = tuple(float(v) for v in args.door_lite_rect.split(","))
        except ValueError:
            raise SystemExit("run_fixed_footprint: --door-lite-rect must be xmin,xmax,ymin,ymax numbers")
        if len(lite_rect) != 4 or not all(0.0 <= v <= 1.0 for v in lite_rect):
            raise SystemExit("run_fixed_footprint: --door-lite-rect fractions must be 4 numbers in [0, 1]")
        if not (lite_rect[0] < lite_rect[1] and lite_rect[2] < lite_rect[3]):
            raise SystemExit("run_fixed_footprint: --door-lite-rect needs xmin<xmax and ymin<ymax")
    if args.door_bevel_mm is not None and args.door_bevel_mm <= 0:
        raise SystemExit("run_fixed_footprint: --door-bevel-mm must be positive")
    if args.door_casing_margin_m is not None and args.door_casing_margin_m <= 0:
        raise SystemExit("run_fixed_footprint: --door-casing-margin-m must be positive")
    if ward_pins:
        from infinigen.assets.objects.elements import doors as doors_mod
        from infinigen.assets.objects.elements.doors.lite import LiteDoorFactory
        from infinigen.assets.objects.elements.doors.louver import LouverDoorFactory
        from infinigen.assets.objects.elements.doors.panel import (
            GlassPanelDoorFactory,
            PanelDoorFactory,
        )
        from infinigen.core.constraints.example_solver.room import decorate as room_decorate

        _ward_base = {
            "panel": PanelDoorFactory,
            "glass_panel": GlassPanelDoorFactory,
            "louver": LouverDoorFactory,
            "lite": LiteDoorFactory,
        }[args.door_style]
        _handle = args.door_handle
        _bevel_m = args.door_bevel_mm / 1000.0 if args.door_bevel_mm is not None else None

        class _WardDoorFactory(_ward_base):  # type: ignore[valid-type,misc]
            def __init__(self, factory_seed, coarse=False, constants=None):
                super().__init__(factory_seed, coarse, constants)
                if _handle is not None:
                    self.handle_type = _handle
                if lite_rect is not None and hasattr(self, "x_min"):
                    self.x_min, self.x_max, self.y_min, self.y_max = lite_rect
                    self.x_subdivisions = 1
                    self.y_subdivisions = 1
                if _bevel_m is not None:
                    self.bevel_width = _bevel_m

        def _pinned_ward_factory():
            return _WardDoorFactory

        # Spawned Blender object names embed the factory class __name__
        # (factory.py spawn_asset: obj.name = f"{repr(self)}.spawn_asset({i})"
        # with repr from __class__.__name__). Downstream matchers key on
        # those names -- strip_room_shell_placeholders.py leaf_re/casing_re
        # and probe_door.py is_leaf/is_casing -- so the subclass names must
        # still match: "DoorCasingFactory(...)" exactly for the casing,
        # "*DoorFactory(...)" (not preceded by "Casing") for the leaf.
        _WardDoorFactory.__name__ = "WardDoorFactory"

        doors_mod.random_door_factory = _pinned_ward_factory
        room_decorate.random_door_factory = _pinned_ward_factory
        print(
            "[fixed_footprint] ward door pins: handle=%s lite=%s bevel_m=%s casing_margin_m=%s" % (
                _handle, lite_rect, _bevel_m, args.door_casing_margin_m),
            flush=True,
        )
        if args.door_casing_margin_m is not None:
            import infinigen.assets.objects.elements as elements_pkg
            from infinigen.assets.objects.elements.doors import base as doors_base_mod

            _orig_casing = elements_pkg.DoorCasingFactory
            _casing_margin = float(args.door_casing_margin_m)

            class _WardCasing(_orig_casing):  # type: ignore[valid-type,misc]
                def __init__(self, factory_seed, coarse=False, constants=None):
                    super().__init__(factory_seed, coarse, constants)
                    self.margin = _casing_margin

            # BaseDoorFactory.casing_factory imports DoorCasingFactory from
            # the elements package at call time, so patching the package
            # attribute redirects it (verified: base.py casing_factory
            # property does "from infinigen.assets.objects.elements import
            # DoorCasingFactory" inside the property body).
            elements_pkg.DoorCasingFactory = _WardCasing
            doors_base_mod.DoorCasingFactory = _WardCasing
            # Same spawn-name contract as the leaf above: the strip keep_re
            # and the probe is_casing match "DoorCasingFactory(...)" exactly.
            _WardCasing.__name__ = "DoorCasingFactory"
            print(
                "[fixed_footprint] ward casing margin=%.3f" % _casing_margin,
                flush=True,
            )

    init.apply_gin_configs(
        configs=["base_indoors.gin"] + args.configs,
        overrides=args.overrides,
        config_folders=[
            "infinigen_examples/configs_indoor",
            "infinigen_examples/configs_nature",
        ],
    )
    execute_tasks.main(
        compose_scene_func=compose_indoors,
        populate_scene_func=None,
        input_folder=None,
        output_folder=args.output_folder,
        task=args.task,
        task_uniqname=args.task_uniqname,
        scene_seed=scene_seed,
    )


if __name__ == "__main__":
    main()
