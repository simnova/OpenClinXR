#!/usr/bin/env python3
"""Build a straight, constant-heading calm-walk `Root2DConstraintSet` JSON for `kimodo_gen
--constraints`, from a small (distance, duration, heading) constraint spec.

Promoted from the kimodo cagematch's own scratch `build_straight_walk_constraints.py` (round 10,
docs/openclinxr/kimodo-mlx-bedside-approach-cagematch-2026-09-26.md) into the
`kimodo-walk-loop-station.py` factory pipeline, unchanged in method: a straight-line, constant-
heading calm walk (no turn baked in), matching `kimodo.constraints.Root2DConstraintSet`'s own
documented JSON shape exactly (read from `nv-tlabs/kimodo`'s source, not guessed) --
`frame_indices` dense (every frame), `smooth_root_2d` linearly interpolated, `global_root_heading`
constant `[cos(heading), sin(heading)]` for every frame.

Why a straight, no-turn walk, not a scripted approach: this station produces LOOPING WALK CYCLE
clips (round 9's finding that the runtime treats a locomotion clip as a repeating stride, not a
one-shot performance) -- a whole-approach clip's own measured "forward" is skewed by a turn baked
into it (round 9), a category mismatch this design avoids at the source.
"""
import argparse
import json
import math
import sys


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--distance-meters", type=float, required=True)
    ap.add_argument("--duration-seconds", type=float, required=True)
    ap.add_argument("--fps", type=float, default=30.0)
    ap.add_argument("--heading-radians", type=float, default=0.0)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    num_frames = int(args.duration_seconds * args.fps)
    if num_frames < 2:
        print(f"REFUSE too_few_frames: duration {args.duration_seconds}s at {args.fps}fps gives {num_frames} frames", file=sys.stderr)
        return 2

    frame_indices = list(range(num_frames))
    smooth_root_2d = [[0.0, args.distance_meters * (i / (num_frames - 1))] for i in range(num_frames)]
    heading = [math.cos(args.heading_radians), math.sin(args.heading_radians)]
    global_root_heading = [heading for _ in range(num_frames)]

    constraint = {
        "type": "root2d",
        "frame_indices": frame_indices,
        "smooth_root_2d": smooth_root_2d,
        "global_root_heading": global_root_heading,
    }
    with open(args.out, "w") as fh:
        json.dump([constraint], fh)
    print(
        f"wrote {args.out}: {num_frames} frames, {args.distance_meters} m straight, "
        f"heading {math.degrees(args.heading_radians):.2f} deg"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
