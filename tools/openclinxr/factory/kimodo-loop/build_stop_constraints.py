#!/usr/bin/env python3
"""Build a walk-then-decelerate-then-hold `Root2DConstraintSet` JSON for `kimodo_gen
--constraints`, from a small (walk-speed, walk/decel/hold durations, heading) spec.

Same JSON shape as build_walk_constraints.py (read from `nv-tlabs/kimodo`'s source, not
guessed): `frame_indices` dense (every frame), `smooth_root_2d` as an (x=0, y=distance)
path, `global_root_heading` constant [cos(heading), sin(heading)] for every frame.

Path profile, y(t) at 30 fps:
- walk part (T_w seconds): constant speed v  ->  y = v * t
- decel part (T_d seconds): cosine ease v -> 0  ->  velocity v/2 * (1 + cos(pi * tau / T_d)),
  which covers exactly v * T_d / 2 meters
- hold part (T_h seconds, >= 1.0 s): constant  ->  y flat

Total distance D = v * T_w + v * T_d / 2. The runtime would trigger the one-shot stop at D.
"""
import argparse
import json
import math


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--walk-speed-mps", type=float, required=True)
    ap.add_argument("--walk-seconds", type=float, default=2.0)
    ap.add_argument("--decel-seconds", type=float, default=1.2)
    ap.add_argument("--hold-seconds", type=float, default=1.2)
    ap.add_argument("--fps", type=float, default=30.0)
    ap.add_argument("--heading-radians", type=float, default=0.0)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    v, t_w, t_d, t_h = args.walk_speed_mps, args.walk_seconds, args.decel_seconds, args.hold_seconds
    if t_h < 1.0:
        print(f"REFUSE hold_too_short: {t_h}s < 1.0s", flush=True)
        return 2
    duration = t_w + t_d + t_h
    num_frames = int(round(duration * args.fps))
    if num_frames < 2:
        print(f"REFUSE too_few_frames: {duration}s at {args.fps}fps", flush=True)
        return 2

    y_walk_end = v * t_w
    y_decel_end = y_walk_end + v * t_d / 2.0

    smooth_root_2d = []
    for i in range(num_frames):
        t = i / args.fps
        if t <= t_w:
            y = v * t
        elif t <= t_w + t_d:
            tau = t - t_w
            y = y_walk_end + (v / 2.0) * (tau + (t_d / math.pi) * math.sin(math.pi * tau / t_d))
        else:
            y = y_decel_end
        smooth_root_2d.append([0.0, y])

    heading = [math.cos(args.heading_radians), math.sin(args.heading_radians)]
    constraint = {
        "type": "root2d",
        "frame_indices": list(range(num_frames)),
        "smooth_root_2d": smooth_root_2d,
        "global_root_heading": [heading for _ in range(num_frames)],
    }
    with open(args.out, "w") as fh:
        json.dump([constraint], fh)
    print(
        f"wrote {args.out}: {num_frames} frames, walk {v} m/s x {t_w}s + "
        f"decel {t_d}s + hold {t_h}s, total {y_decel_end:.3f} m"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(__import__("sys").argv[1:]))
